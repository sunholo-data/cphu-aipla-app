"""BENCH-1/2: do the seven tutors actually teach differently?

Scripted students (research/tutor-discrimination/scenarios.yaml) are run turn by
turn through the tutor for each of the seven teaching approaches, on each tutor
model; every transcript is then judged BLIND against all seven approaches on
the analysis model, plus the tone probe (every transcript) and the wrong-claim
sycophancy probe (where a scenario planted a wrong claim). The report leads with
the column-normalised metrics (own-column rank, column-z margin, column bias)
and keeps the strict argmax diagonal accuracy beside them for the record.

    make bench-tutors ARGS=--dry-run          # plan + call count + cost, ZERO model calls
    make bench-tutors ARGS=--go               # the real run (costs money; needs M's go-ahead)
    make bench-tutors ENV=dev ARGS="--go --tutor-models gemini-3.5-flash-lite"
    make bench-tutors ARGS="--report-only research/tutor-discrimination/<run>"   # re-score, ZERO calls

Without --go it refuses to call any model. Outputs go to
research/tutor-discrimination/<UTC timestamp>/ (gitignored): report.md,
transcripts.jsonl, raw_scores.jsonl. --report-only (alias --rescore-from)
recomputes the report from an existing run's raw_scores.jsonl and writes
report-rescored.md beside it (or into --out).

What the tutor runs on: ``tutor_preview.compose_approach_instruction`` — the
``concept-dialogue`` skill's instructions plus the approach's generated
instruction, read from the environment's Firestore exactly as a preview does.
It is NOT the full lesson prompt (no activity materials, ILOs, group history or
persona), and the report says so. Every tutor turn is logged under the
``preview:`` prefix with no content, so none of it can read as classroom
evidence.

Transient failures (429 / 5xx) on a tutor turn or a judge call are retried a
bounded number of times with exponential backoff, and every retry is logged
and counted; anything else fails that transcript (or abstains that read) with
the exception's status and message recorded, not just its class name.

--from-sessions (1.1.140 M3) judges REAL classroom sessions instead of scripted
students: it selects sessions from ``chat_logs.chat_turns`` on --env (default
prod, read-only), keeps only ``teaching_source = 'tutor'`` rows with a
framework (no previews, no persona-field turns, no teacher/preview groups), and
judges each session blind against every approach plus the tone probe. No tutor
is called. --dry-run runs only the selection query (no model calls); --go judges.
Outputs go to research/tutor-discrimination/sessions-<UTC>/ with group ids only
as a salted hash (ADR-001).

    make bench-tutor-sessions ARGS="--dry-run --since 2026-09-26 --until 2026-09-30"

--include-teacher-trials also selects teachers' "Try as student" sessions
(``preview-<code>`` groups, 1.1.133): the real lesson prompt, but a teacher as
the student. They are labelled "teacher trial" and reported in their own
section, never pooled into the classroom headline, matrix or n table.
``preview:`` tutor previews and content-free ``teacher:`` rows stay out.

Workbench scenarios (1.1.149 M5): a scenario may carry an inline ``activity:``
(a sim plus elements) and a planted ``probe.stuckTurn``. Its tutor is composed
per turn through the REAL ``create_agent`` (``compose_activity_turn``), so the
workbench block, referral rule and nudge are the ones a student gets, and each
transcript is graded by the deterministic referral probe
(``analytics/workbench_referral.py``) in its own report section. They live in
``research/workbench-referral/scenarios.yaml``, outside the BENCH-2 file, so the
discrimination baseline keeps its n:

    make bench-tutors ARGS="--dry-run --scenarios ../research/workbench-referral/scenarios.yaml"

``--from-sessions --referral-only`` counts referrals in real sessions with ZERO
model calls (1.1.149 M6).

Auth for a real run: Application Default Credentials with Vertex + Firestore
read on the chosen project (``gcloud auth application-default login``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[1]
BACKEND = REPO / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

DEFAULT_SCENARIOS = REPO / "research" / "tutor-discrimination" / "scenarios.yaml"
DEFAULT_OUT_ROOT = REPO / "research" / "tutor-discrimination"
BENCH_UID = "bench-tutor-discrimination"
RESCORED_REPORT = "report-rescored.md"

ComposeFn = Callable[[str], dict[str, Any]]
#: (framework_id, ActivityConfig, history so far, this student message) -> the
#: instruction for THIS turn (1.1.149 M5). Per turn, because the workbench block
#: and its nudge are composed per turn in a lesson too.
ActivityComposeFn = Callable[[str, Any, list[dict[str, str]], str], Awaitable[str]]
TutorTurnFn = Callable[..., Awaitable[dict[str, Any]]]
JudgeFn = Callable[[str, str], Awaitable[str]]
SleepFn = Callable[[float], Awaitable[None]]
QueryFn = Callable[[str, dict[str, Any]], list[Any]]


@dataclass
class Setup:
    scenarios: list[Any]
    frameworks: list[Any]
    tutor_models: list[str]
    judge_model: str


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    from analytics.model_retry import DEFAULT_ATTEMPTS

    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dry-run", action="store_true", help="print the plan, call count and cost; make no calls")
    p.add_argument("--go", action="store_true", help="actually call the models (costs money)")
    p.add_argument(
        "--report-only",
        "--rescore-from",
        dest="report_only",
        type=Path,
        default=None,
        metavar="RUN_DIR",
        help="recompute the report from RUN_DIR/raw_scores.jsonl; makes ZERO model calls",
    )
    p.add_argument("--scenarios", type=Path, default=DEFAULT_SCENARIOS)
    p.add_argument("--only-scenarios", default="", help="comma-separated scenario ids (default: all)")
    p.add_argument("--frameworks", default="", help="comma-separated framework ids (default: all seven)")
    p.add_argument(
        "--tutor-models", default="", help="comma-separated tutor model api names (default: default + smart tier)"
    )
    p.add_argument("--judge-model", default="", help="judge model api name (default: the analysis model)")
    p.add_argument(
        "--concurrency",
        type=int,
        default=4,
        help="transcripts run at once; judge calls per transcript likewise (so up to N*N in flight)",
    )
    p.add_argument(
        "--retry-attempts",
        type=int,
        default=DEFAULT_ATTEMPTS,
        help="total attempts per tutor turn / judge call on a 429 or 5xx (1 = no retry)",
    )
    p.add_argument("--out", type=Path, default=None, help="output dir (default: a timestamped dir)")
    g = p.add_argument_group("--from-sessions (1.1.140 M3): judge real classroom sessions, no tutor calls")
    g.add_argument("--from-sessions", action="store_true", help="judge real sessions from chat_turns")
    g.add_argument("--env", default="prod", choices=["dev", "test", "prod"], help="environment to read (read-only)")
    g.add_argument("--since", type=_date, default=None, help="first day, YYYY-MM-DD (UTC)")
    g.add_argument("--until", type=_date, default=None, help="last day INCLUSIVE, YYYY-MM-DD (UTC; default today)")
    g.add_argument("--min-turns", type=int, default=None, help="minimum tutor turns per session (default 6)")
    g.add_argument("--tutor", default="", help="comma-separated tutor ids to keep (default: all)")
    g.add_argument("--framework", default="", help="comma-separated assigned framework ids to keep (default: all)")
    g.add_argument("--max-sessions", type=int, default=None, help="cap on sessions judged (earliest first)")
    g.add_argument(
        "--include-teacher-trials",
        action="store_true",
        help="also judge teachers' Try-as-student sessions (preview- groups), reported separately, never pooled",
    )
    g.add_argument(
        "--referral-only",
        action="store_true",
        help="1.1.149: count workbench referrals in the selected sessions (deterministic, ZERO model calls; "
        "one more read-only BigQuery read for the transcripts). No --go needed",
    )
    return p.parse_args(argv)


def _date(s: str) -> Any:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _csv(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


def build_setup(args: argparse.Namespace) -> Setup:
    from analytics.framework_discrimination import load_scenarios
    from analytics.framework_fidelity import analysis_judge_model
    from config.models import default_model, model_api_names, smart_model
    from frameworks.loader import ready_frameworks

    scenarios = load_scenarios(args.scenarios)
    if args.only_scenarios:
        wanted = set(_csv(args.only_scenarios))
        scenarios = [s for s in scenarios if s.id in wanted]
        missing = wanted - {s.id for s in scenarios}
        if missing:
            raise SystemExit(f"unknown scenario id(s): {', '.join(sorted(missing))}")
    frameworks = ready_frameworks()
    if args.frameworks:
        wanted = _csv(args.frameworks)
        by_id = {f.id: f for f in frameworks}
        missing = [w for w in wanted if w not in by_id]
        if missing:
            raise SystemExit(f"unknown or placeholder framework id(s): {', '.join(missing)}")
        frameworks = [by_id[w] for w in wanted]
    tutor_models = _csv(args.tutor_models) or list(dict.fromkeys([default_model(), smart_model()]))
    judge_model = args.judge_model or analysis_judge_model()
    known = model_api_names()
    unknown = [m for m in [*tutor_models, judge_model] if m not in known]
    if unknown:
        raise SystemExit(f"model(s) not in the registry (config/models.yaml): {', '.join(unknown)}")
    return Setup(scenarios, frameworks, tutor_models, judge_model)


def _estimated_instruction_chars(framework_id: str) -> int:
    """Offline size of what the tutor will be told — the on-disk SKILL.md body
    plus the generated approach instruction. Firestore is not read in a dry run."""
    from analytics.tutor_preview import DEFAULT_PREVIEW_SKILL
    from frameworks.instruction import build_framework_instruction
    from frameworks.loader import load_framework

    skill_md = BACKEND / "skills" / "templates" / DEFAULT_PREVIEW_SKILL / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8") if skill_md.exists() else ""
    body = text.split("---", 2)[2] if text.startswith("---") and text.count("---") >= 2 else text
    return len(body) + len(build_framework_instruction(load_framework(framework_id)))


def render_plan(setup: Setup) -> tuple[str, Any]:
    from analytics.framework_discrimination import plan_calls

    plan = plan_calls(
        setup.scenarios,
        setup.frameworks,
        setup.tutor_models,
        judge_model=setup.judge_model,
        tutor_instruction_chars={f.id: _estimated_instruction_chars(f.id) for f in setup.frameworks},
    )
    costs = plan.cost_eur()
    n_transcripts = len(setup.scenarios) * len(setup.frameworks) * len(setup.tutor_models)
    n_probe = sum(1 for s in setup.scenarios if s.probe is not None)
    lines = [
        "BENCH tutor discrimination — plan",
        f"  scenarios     : {len(setup.scenarios)} ({', '.join(s.id for s in setup.scenarios)})",
        f"  planted claims: {n_probe} ({', '.join(s.id for s in setup.scenarios if s.probe is not None) or 'none'})",
        f"  approaches    : {len(setup.frameworks)} ({', '.join(f.id for f in setup.frameworks)})",
        f"  tutor models  : {', '.join(setup.tutor_models)}",
        f"  judge model   : {setup.judge_model} (blind; analysis model)",
        f"  transcripts   : {n_transcripts} = scenarios x approaches x tutor models"
        f" (n = {len(setup.scenarios)} per cell)",
        f"  tutor calls   : {plan.tutor_calls} (one per scripted student turn)",
        f"  fit calls     : {plan.fit_calls} (each transcript judged against every approach)",
        f"  tone          : {plan.tone_calls} (every transcript: unearned praise / flattery)",
        f"  sycophancy    : {plan.sycophancy_calls} (transcripts of scenarios with a planted wrong claim)",
        f"  TOTAL CALLS   : {plan.total_calls} (before any 429/5xx retries)",
        "  est. cost     : "
        + ", ".join(
            f"{m} EUR {c:.2f} ({plan.tokens[m][0]:,} in / {plan.tokens[m][1]:,} out tok)" for m, c in costs.items()
        ),
        f"  est. total    : EUR {sum(costs.values()):.2f}  (rough: chars/4 tokens, generous output sizes,"
        " rate card in analytics/rate_card.py — gemini-3.8-flash is marked PROVISIONAL there)",
    ]
    return "\n".join(lines), plan


# --- the report (pure over raw_scores rows; shared by a run and --report-only) -------


def _order_from_rows(rows: list[dict[str, Any]]) -> list[str]:
    """Approach order as the judge columns were written, else as producers appear."""
    for r in rows:
        if r.get("ok") and r.get("fit"):
            return list(r["fit"]["fits"].keys())
    return list(dict.fromkeys(r["producing"] for r in rows))


def build_report(
    rows: list[dict[str, Any]],
    *,
    order: list[str],
    tutor_models: list[str],
    title: str,
    provenance: list[str],
) -> str:
    """The whole report from raw_scores rows. Makes no calls, so a finished run
    can be re-read under new metrics (--report-only)."""
    from analytics.framework_discrimination import (
        LOW_SPREAD,
        TranscriptFit,
        render_headline_line,
        render_model_section,
    )

    has_tone = any("tone" in r for r in rows)
    sections, headline = [], []
    for m in tutor_models:
        rs = [r for r in rows if r["tutorModel"] == m and r.get("ok") and r.get("fit")]
        fits = [TranscriptFit(r["id"], r["producing"], {k: v["fit"] for k, v in r["fit"]["fits"].items()}) for r in rs]
        abstains = sum(1 for r in rs for v in r["fit"]["fits"].values() if v["abstained"])
        syco = [
            {"producing": r["producing"], "scenario": r["scenario"], **r["sycophancy"]}
            for r in rs
            if r.get("sycophancy") and not str(r["sycophancy"].get("abstainReason", "")).startswith("no wrong claim")
        ]
        tone = (
            [
                {"producing": r["producing"], "scenario": r["scenario"], **(r.get("tone") or {"abstained": True})}
                for r in rs
            ]
            if has_tone
            else None
        )
        headline.append(render_headline_line(m, fits, order))
        sections.append(render_model_section(m, fits, order, syco, abstains, tone))

    failed = [r for r in rows if not r.get("ok")]
    n = len(order)
    lines = [
        f"# {title}",
        "",
        "**The question (JB, 2026-09-29):** do the seven teaching approaches produce dialogues that fit their "
        "own approach better than the other six? And is any tutor sycophantic?",
        "",
        "## Headline (column-normalised)",
        "",
        *headline,
        "",
        "## How to read this",
        "",
        "- Each transcript is a scripted student (identical turns for every tutor) talking to one approach's tutor.",
        f"- Every transcript is judged **blind** against all {n} approaches with each approach's own generated "
        "criteria. **Fit** = mean construct band (absent 0 / partial 1 / strong 2) / 2, so 0-1; an uncited band "
        "counts as absent. The fits are independent and do not sum to anything.",
        "- **The headline reads DOWN a column.** Each approach's criteria are a different ruler, and the judge "
        "reads some rulers high for everyone (BENCH-1: ESRU) and some ~0 for everyone (CER). Within one column "
        "every tutor is measured with the same ruler, so that offset cancels. The question per column is: *does "
        "the POE tutor do more POE than the other tutors do?*",
        f"- **Own-column rank:** in how many columns the approach's own tutor is the top scorer (clear) or shares "
        f"the top (tied). Chance is about 1 of {n} clear.",
        "- **Column-z margin:** z-score each column across the producing tutors, take own z minus the mean of the "
        "others' z, average over columns. 0 = the own tutor is no different from the rest; positive = it does "
        f"more of its approach. **Column bias:** a column whose spread across tutors is under {LOW_SPREAD:.2f} "
        "cannot discriminate and is flagged; a ceiling or floor column measures the criteria, not the tutor.",
        f"- **Diagonal accuracy (strict argmax)** = share of transcripts whose best fit across ALL columns is "
        f"their own approach; a tie is a miss; chance 1/{n}. It compares different rulers, so a biased column "
        "(one that reads high for every dialogue) wins every argmax and defeats it. Kept for the record, not "
        "the headline.",
        "- **Tone probe:** every transcript, blind: unearned praise or flattery (stock 'great question!', praise "
        "of a wrong or empty answer), graded none / mild / marked with the tutor turns cited. **Sycophancy "
        "probe:** where a wrong claim was planted, does the tutor affirm or build on it?",
        "- Fit is not quality. A tutor can be faithfully ESRU and still unhelpful.",
        "",
        "## Provenance",
        "",
        *provenance,
    ]
    if failed:
        lines += ["", "### Failed transcripts", ""] + [
            f"- `{r['id']}`: {r.get('error') or 'no error recorded'}" for r in failed
        ]
    referral = render_referral_section(rows, order=order, tutor_models=tutor_models)
    if referral:
        sections.append(referral)
    return "\n".join(lines) + "\n\n" + "\n\n".join(sections) + "\n"


#: Acceptance criterion 4 of 1.1.149 (first guesses, design doc O5).
REFERRAL_FIRST_BY_TURN = 2
REFERRAL_FIRST_TARGET = 0.8
REFERRAL_STUCK_TARGET = 0.7
REFERRAL_SHARE_CEILING = 0.6


def _referral_line(label: str, refs: list[dict[str, Any]]) -> str:
    n = len(refs)
    early = sum(1 for r in refs if r.get("firstReferralTurn") and r["firstReferralTurn"] <= REFERRAL_FIRST_BY_TURN)
    stuck = [r for r in refs if r.get("afterStuck") is not None]
    stuck_ok = sum(1 for r in stuck if r["afterStuck"])
    shares = [r["share"] for r in refs if r.get("share") is not None]
    mean_share = sum(shares) / len(shares) if shares else None

    def pct(k: int, d: int) -> str:
        return f"{k / d:.0%} ({k}/{d})" if d else "n/a"

    return (
        f"| {label} | {n} | {pct(early, n)} | {pct(stuck_ok, len(stuck))} | "
        f"{'n/a' if mean_share is None else f'{mean_share:.2f}'} |"
    )


def render_referral_section(rows: list[dict[str, Any]], *, order: list[str], tutor_models: list[str]) -> str:
    """1.1.149 M5 — does the tutor send the student to the workbench? Deterministic
    (no judge), from ``analytics.workbench_referral``. ``""`` when no transcript
    had a workbench, so a BENCH-2 report is unchanged."""
    graded = [r for r in rows if r.get("ok") and r.get("referral")]
    if not graded:
        return ""
    out = [
        "## Workbench referral (1.1.149)",
        "",
        "Scenarios with a workbench only. A referral is a tutor turn the shared matcher counts "
        "(`analytics/workbench_referral.py` — the same one the runtime nudge fires on and the prod SQL uses). "
        f"Targets: first referral by tutor turn {REFERRAL_FIRST_BY_TURN} in >= {REFERRAL_FIRST_TARGET:.0%}; "
        f"a referral within two tutor turns of the planted stuck turn in >= {REFERRAL_STUCK_TARGET:.0%}; "
        f"referral share <= {REFERRAL_SHARE_CEILING} (no nagging).",
    ]
    for m in tutor_models:
        rs = [r for r in graded if r["tutorModel"] == m]
        if not rs:
            continue
        out += [
            "",
            f"### {m}",
            "",
            f"| Approach | n | first referral by turn {REFERRAL_FIRST_BY_TURN} | after the stuck turn | mean share |",
            "|---|---|---|---|---|",
        ]
        for fid in order:
            refs = [r["referral"] for r in rs if r["producing"] == fid]
            if refs:
                out.append(_referral_line(f"`{fid}`", refs))
        out.append(_referral_line("**all**", [r["referral"] for r in rs]))
    return "\n".join(out)


def report_only(run_dir: Path, out_dir: Path | None) -> tuple[Path, str]:
    """Re-score a finished run from its raw_scores.jsonl. ZERO model calls."""
    raw = run_dir / "raw_scores.jsonl"
    if not raw.exists():
        raise SystemExit(f"no raw_scores.jsonl in {run_dir}")
    rows = [json.loads(line) for line in raw.read_text(encoding="utf-8").splitlines() if line.strip()]
    # Older runs kept the failure reason only in transcripts.jsonl.
    errors: dict[str, str] = {}
    tpath = run_dir / "transcripts.jsonl"
    if tpath.exists():
        for line in tpath.read_text(encoding="utf-8").splitlines():
            if line.strip():
                t = json.loads(line)
                if t.get("error"):
                    errors[t["id"]] = t["error"]
    for r in rows:
        if not r.get("ok") and not r.get("error"):
            r["error"] = errors.get(r["id"], "")
    order = _order_from_rows(rows)
    tutor_models = list(dict.fromkeys(r["tutorModel"] for r in rows))
    ok_fits = [r["fit"] for r in rows if r.get("ok") and r.get("fit")]
    judge = ok_fits[0].get("model", "?") if ok_fits else "?"
    fit_pv = ok_fits[0].get("promptVersion", "?") if ok_fits else "?"
    revision = next((r.get("revision") for r in rows if r.get("revision")), None)
    provenance = [
        f"- **Re-scored** from `{run_dir.name}/raw_scores.jsonl` on {datetime.now(UTC).isoformat(timespec='seconds')}"
        " with ZERO model calls: the judge reads are the original run's, only the metrics are recomputed.",
        f"- Tutor models: {', '.join(f'`{m}`' for m in tutor_models)} · judge: `{judge}` · fit prompt `{fit_pv}` · "
        f"code revision of the run `{revision or 'unknown'}`",
        f"- Scenarios: {', '.join(f'`{s}`' for s in dict.fromkeys(r['scenario'] for r in rows))}",
        f"- Transcripts: {len(rows)} · failed (not judged): {sum(1 for r in rows if not r.get('ok'))}",
    ]
    report = build_report(
        rows,
        order=order,
        tutor_models=tutor_models,
        title=f"Tutor discrimination report — re-scored `{run_dir.name}`",
        provenance=provenance,
    )
    target_dir = out_dir or run_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / RESCORED_REPORT
    target.write_text(report, encoding="utf-8")
    return target, report


# --- the real run -------------------------------------------------------------------


def _git_revision() -> str | None:
    """The commit the tutors were composed from, or None when git cannot say."""
    import subprocess

    try:
        out = subprocess.run(
            ["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=5
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return (out.stdout.strip() or None) if out.returncode == 0 else None


async def _tutor_turn_with_retry(
    tutor_turn: TutorTurnFn,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    *,
    label: str,
    attempts: int,
    sleep: SleepFn,
    on_retry: Callable[[int, str], None],
) -> dict[str, Any]:
    """The tutor seam returns ``{"ok": False, "status": 429, ...}`` rather than
    raising, so its retry reads the status off the result."""
    from analytics.model_retry import DEFAULT_BASE_DELAY, backoff_delay, is_retryable, logger

    out: dict[str, Any] = {}
    for attempt in range(1, max(1, attempts) + 1):
        out = await tutor_turn(*args, **kwargs)
        if out.get("ok") or attempt >= attempts or not is_retryable(out.get("status")):
            return out
        delay = backoff_delay(attempt, DEFAULT_BASE_DELAY)
        logger.warning("%s: %s — retry %d/%d in %.1fs", label, out.get("error"), attempt, attempts - 1, delay)
        on_retry(attempt, str(out.get("error")))
        await sleep(delay)
    return out


async def _run_transcript(
    scenario: Any,
    fw: Any,
    tutor_model: str,
    composed: dict[str, Any],
    tutor_turn: TutorTurnFn,
    *,
    attempts: int,
    sleep: SleepFn,
    activity_compose: ActivityComposeFn | None = None,
) -> dict[str, Any]:
    history: list[dict[str, str]] = []
    tokens = [0, 0]
    activity = getattr(scenario, "activity", None)
    composed_from = dict(composed["composedFrom"])
    if activity is not None:
        composed_from["activity"] = activity.activity_id
        composed_from["notIncluded"] = ["group history", "persona"]
    record: dict[str, Any] = {
        "id": f"{scenario.id}|{fw.id}|{tutor_model}",
        "scenario": scenario.id,
        "producing": fw.id,
        "tutorModel": tutor_model,
        "tutorId": composed["tutorId"],
        "composedFrom": composed_from,
        "ok": True,
        "error": "",
        "retries": 0,
    }

    def _count(_attempt: int, _desc: str) -> None:
        record["retries"] += 1

    for i, student in enumerate(scenario.student_turns):
        turn_composed = composed
        if activity is not None:
            if activity_compose is None:
                raise SystemExit(f"scenario {scenario.id} has a workbench but no activity composer was given")
            # The REAL agent build, this turn: the workbench block, the referral
            # rule and the nudge are the ones a student would get.
            turn_composed = {**composed, "instruction": await activity_compose(fw.id, activity, history, student)}
        out = await _tutor_turn_with_retry(
            tutor_turn,
            (turn_composed, history, student),
            {"model": tutor_model, "uid": BENCH_UID, "turn_index": 2 * i + 1},
            label=f"tutor {record['id']} turn {i}",
            attempts=attempts,
            sleep=sleep,
            on_retry=_count,
        )
        history.append({"role": "student", "content": student})
        if not out.get("ok"):
            status = f" (status {out['status']})" if out.get("status") is not None else ""
            record.update(ok=False, error=f"tutor turn {i} failed{status}: {out.get('error')}")
            break
        history.append({"role": "tutor", "content": out.get("reply", "")})
        tokens[0] += int(out.get("tokenIn") or 0)
        tokens[1] += int(out.get("tokenOut") or 0)
    record["turns"] = history
    record["tutorTokens"] = tokens
    record["referral"] = None
    if activity is not None and record["ok"]:
        from analytics.workbench_referral import referral_probe, referral_vocabulary

        # Deterministic, no judge call — and the SAME matcher the runtime nudge
        # fires on and the prod SQL counts with.
        record["referral"] = referral_probe(
            history, referral_vocabulary(activity), stuck_student_turn=scenario.stuck_turn
        ).to_dict()
    return record


#: One agent build at a time: composing patches module-level resolvers (below).
#: Per event loop, since a lock is bound to the loop it first waits on.
_ACTIVITY_COMPOSE_LOCKS: dict[int, asyncio.Lock] = {}


def _activity_compose_lock() -> asyncio.Lock:
    return _ACTIVITY_COMPOSE_LOCKS.setdefault(id(asyncio.get_running_loop()), asyncio.Lock())


async def compose_activity_turn(framework_id: str, cfg: Any, history: list[dict[str, str]], message: str) -> str:
    """This turn's instruction for an approach tutor ON A WORKBENCH (1.1.149 M5).

    Built by the real ``adk.agent.create_agent`` on the environment's seeded
    ``concept-dialogue`` skill, then ``agent.instruction(ctx)`` is awaited the
    way ADK awaits it — so every per-turn provider, including the workbench
    block and its nudge, runs exactly as in a lesson. Two things are pinned
    rather than looked up, because a scripted bench has neither a class nor a
    saved activity in Firestore: the ACTIVITY (the scenario's inline config) and
    the TEACHING CONTEXT (this approach, no persona — the same 1-1 confound
    ``compose_approach_instruction`` keeps out). Nothing is written anywhere.
    """
    from types import SimpleNamespace
    from unittest import mock

    from adk.agent import create_agent
    from adk.tutor_resolution import TeachingContext
    from analytics.tutor_preview import DEFAULT_PREVIEW_SKILL
    from auth import User
    from skills.platform import PLATFORM_OWNER_UID
    from skills.skill_config import find_by_slug

    skill = find_by_slug(PLATFORM_OWNER_UID, DEFAULT_PREVIEW_SKILL)
    if skill is None:
        raise SystemExit(f"the {DEFAULT_PREVIEW_SKILL} skill is not seeded in this environment (make seed ENV=...)")
    teaching = TeachingContext(
        tutor_id=f"approach:{framework_id}",
        framework_id=framework_id,
        persona_id=None,
        class_id=None,
        activity_id=cfg.activity_id,
        interaction_style=None,
        source="tutor",
    )

    def _event(author: str, text: str) -> Any:
        return SimpleNamespace(author=author, content=SimpleNamespace(parts=[SimpleNamespace(text=text)]))

    events = [_event("user" if h["role"] == "student" else "tutor", h["content"]) for h in history]
    events.append(_event("user", message))
    ctx = SimpleNamespace(
        state={},
        user_content=SimpleNamespace(parts=[SimpleNamespace(text=message)]),
        session=SimpleNamespace(events=events, id=f"preview:{BENCH_UID}"),
        user_id=BENCH_UID,
    )
    user = User(uid=f"preview:{BENCH_UID}", email="", domain="")
    async with _activity_compose_lock():
        with (
            mock.patch("adk.agent.resolve_active_config", return_value=cfg),
            mock.patch("adk.teacher_focus.resolve_active_config", return_value=cfg),
            mock.patch("adk.agent.resolve_teaching_context", return_value=teaching),
            mock.patch("adk.tutor_resolution.resolve_teaching_context", return_value=teaching),
        ):
            agent = create_agent(skill, user, activity_id=cfg.activity_id)
            return await agent.instruction(ctx)


async def run_benchmark(
    setup: Setup,
    out_dir: Path,
    *,
    concurrency: int,
    compose: ComposeFn,
    tutor_turn: TutorTurnFn,
    judge: JudgeFn | None,
    attempts: int = 4,
    sleep: SleepFn = asyncio.sleep,
    activity_compose: ActivityComposeFn | None = None,
) -> dict[str, Any]:
    from analytics.framework_discrimination import (
        FIT_PROMPT_VERSION,
        SYCOPHANCY_PROMPT_VERSION,
        TONE_PROMPT_VERSION,
        resolve_judge,
        score_fit_all,
        score_sycophancy,
        score_tone,
    )
    from analytics.model_retry import call_with_retry
    from analytics.rate_card import cost_eur
    from reports.session_summary import SessionTurn

    composed_by_fw: dict[str, dict[str, Any]] = {}
    for fw in setup.frameworks:
        c = compose(fw.id)
        if not c.get("ok") or not (c.get("instruction") or "").strip():
            raise SystemExit(f"could not compose the {fw.id} tutor: {c.get('error') or 'empty instruction'}")
        if not c["composedFrom"].get("skillFound"):
            raise SystemExit(
                f"the {c['composedFrom'].get('skill')} skill was not found in this environment's Firestore, so the "
                f"{fw.id} tutor would run on its approach alone. Seed the skills (make seed ENV=...) and re-run."
            )
        composed_by_fw[fw.id] = c

    judge_retries = [0]

    def _count_judge(_attempt: int, _desc: str) -> None:
        judge_retries[0] += 1

    async def retrying_judge(prompt: str, model: str) -> str:
        base = resolve_judge(judge)  # resolved per call, so a patched seam is honoured
        return await call_with_retry(
            lambda: base(prompt, model),
            label=f"judge {model}",
            attempts=attempts,
            sleep=sleep,
            on_retry=_count_judge,
        )

    sem = asyncio.Semaphore(max(1, concurrency))
    started = time.monotonic()

    async def _one(scenario: Any, fw: Any, tutor_model: str) -> dict[str, Any]:
        async with sem:
            rec = await _run_transcript(
                scenario,
                fw,
                tutor_model,
                composed_by_fw[fw.id],
                tutor_turn,
                attempts=attempts,
                sleep=sleep,
                activity_compose=activity_compose,
            )
            if not rec["ok"]:
                rec["fit"] = None
                rec["sycophancy"] = None
                rec["tone"] = None
                return rec
            turns = [SessionTurn(timestamp="", role=t["role"], content=t["content"]) for t in rec["turns"]]
            # BLIND: only the dialogue and the frameworks go in. The producer label
            # (rec["producing"]) is joined back on AFTER judging.
            profile = await score_fit_all(
                turns, setup.frameworks, model=setup.judge_model, concurrency=concurrency, judge=retrying_judge
            )
            rec["fit"] = profile.to_dict()
            rec["sycophancy"] = await score_sycophancy(
                turns, scenario.probe, model=setup.judge_model, judge=retrying_judge
            )
            rec["tone"] = await score_tone(turns, model=setup.judge_model, judge=retrying_judge)
            return rec

    jobs = [_one(s, f, m) for m in setup.tutor_models for s in setup.scenarios for f in setup.frameworks]
    records = await asyncio.gather(*jobs)

    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "transcripts.jsonl").open("w", encoding="utf-8") as fh:
        for r in records:
            keep = {
                k: r[k]
                for k in (
                    "id",
                    "scenario",
                    "producing",
                    "tutorModel",
                    "tutorId",
                    "composedFrom",
                    "ok",
                    "error",
                    "retries",
                    "turns",
                )
            }
            fh.write(json.dumps(keep, ensure_ascii=False) + "\n")
    revision = _git_revision()
    rows: list[dict[str, Any]] = []
    with (out_dir / "raw_scores.jsonl").open("w", encoding="utf-8") as fh:
        for r in records:
            keep = {
                k: r[k]
                for k in (
                    "id",
                    "scenario",
                    "producing",
                    "tutorModel",
                    "ok",
                    "error",
                    "fit",
                    "sycophancy",
                    "tone",
                    "referral",
                )
            }
            # The arm, in the same field names 1.1.92 M0 put on RubricResult, so a
            # benchmark row and a scored classroom session can sit in one table.
            # An approach tutor has no stored version (it is composed, not
            # authored), so tutorVersion is unknown rather than a guess; the
            # revision is the code that composed it.
            keep |= {
                "tutorId": r["tutorId"],
                "tutorVersion": None,
                "frameworkId": r["producing"],
                "revision": revision,
                "groupId": f"preview:{BENCH_UID}",
            }
            rows.append(keep)
            fh.write(json.dumps(keep, ensure_ascii=False) + "\n")

    order = [f.id for f in setup.frameworks]
    tutor_calls = sum(len([t for t in r["turns"] if t["role"] == "tutor"]) for r in records)
    fit_calls = sum((r["fit"] or {}).get("calls", 0) for r in records)
    syco_calls = sum((r["sycophancy"] or {}).get("calls", 0) for r in records)
    tone_calls = sum((r["tone"] or {}).get("calls", 0) for r in records)
    tutor_retries = sum(r["retries"] for r in records)
    total = tutor_calls + fit_calls + syco_calls + tone_calls
    tutor_cost = sum(cost_eur(r["tutorModel"], *r["tutorTokens"]) for r in records)

    from analytics.tutor_preview import DEFAULT_PREVIEW_SKILL

    provenance = [
        f"- Run: {datetime.now(UTC).isoformat(timespec='seconds')} · project "
        f"`{os.environ.get('GOOGLE_CLOUD_PROJECT', '?')}` · {time.monotonic() - started:.0f}s",
        f"- Tutor instruction: `{DEFAULT_PREVIEW_SKILL}` skill + the approach's generated instruction "
        "(`tutor_preview.compose_approach_instruction`). **Not included:** activity materials, teacher ILOs, group "
        "history, persona. Preview-logged (`preview:` prefix, no content).",
        f"- Tutor models: {', '.join(f'`{m}`' for m in setup.tutor_models)} · judge: `{setup.judge_model}`",
        f"- Prompt versions: fit `{FIT_PROMPT_VERSION}` · tone `{TONE_PROMPT_VERSION}` · sycophancy "
        f"`{SYCOPHANCY_PROMPT_VERSION}` · code revision `{revision or 'unknown'}`",
        f"- Scenarios: {', '.join(f'`{s.id}`' for s in setup.scenarios)} (language: "
        f"{', '.join(sorted({s.language for s in setup.scenarios}))})",
        f"- Calls made (successful): tutor **{tutor_calls}** · fit **{fit_calls}** · tone **{tone_calls}** · "
        f"sycophancy **{syco_calls}** · total **{total}** · retries on 429/5xx: tutor {tutor_retries}, "
        f"judge {judge_retries[0]}",
        f"- Tutor cost (from usage metadata, rate card): EUR {tutor_cost:.2f}. Judge cost is not metered here; "
        "see the dry-run estimate.",
        f"- Transcripts: {len(records)} · failed (not judged): {sum(1 for r in records if not r['ok'])}",
    ]
    report = build_report(
        rows,
        order=order,
        tutor_models=setup.tutor_models,
        title="Tutor discrimination report",
        provenance=provenance,
    )
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    return {"records": records, "report": report, "calls": total}


# --- --from-sessions (1.1.140 M3): real classroom sessions ------------------------------


def _sessions_view(env: str) -> str:
    return f"`aipla-{env}-2026.chat_logs.chat_turns`"


def _sessions_judge_model(args: argparse.Namespace) -> str:
    from analytics.framework_fidelity import analysis_judge_model
    from config.models import model_api_names

    judge_model = args.judge_model or analysis_judge_model()
    if judge_model not in model_api_names():
        raise SystemExit(f"model(s) not in the registry (config/models.yaml): {judge_model}")
    return judge_model


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")


def from_sessions(
    args: argparse.Namespace,
    *,
    query: QueryFn | None,
    judge: JudgeFn | None,
    sleep: SleepFn = asyncio.sleep,
) -> int:
    """Select real sessions (read-only BigQuery), then — only with --go — judge
    them. --dry-run and a bare invocation make ZERO model calls."""
    import secrets

    from analytics import session_discrimination as sd
    from frameworks.loader import ready_frameworks

    if args.since is None:
        raise SystemExit("--from-sessions needs --since YYYY-MM-DD")
    until = args.until or datetime.now(UTC).date()
    min_turns = args.min_turns if args.min_turns is not None else sd.DEFAULT_MIN_TUTOR_TURNS
    project = f"aipla-{args.env}-2026"
    # The Makefile defaults GOOGLE_CLOUD_PROJECT to dev; --env is the one that counts here.
    os.environ["GOOGLE_CLOUD_PROJECT"] = project
    if query is None:
        from db.bigquery import run_query

        query = run_query
    frameworks = ready_frameworks()
    order = [f.id for f in frameworks]
    judge_model = _sessions_judge_model(args)
    view = _sessions_view(args.env)

    sel = sd.select_sessions(
        query,
        view,
        since=args.since,
        until=until,
        min_turns=min_turns,
        tutors=_csv(args.tutor),
        frameworks=_csv(args.framework),
        max_sessions=args.max_sessions,
        include_teacher_trials=args.include_teacher_trials,
    )
    plan = sd.plan_session_calls(sel.sessions, frameworks, judge_model)
    costs = plan.cost_eur()
    est_total = sum(costs.values())
    selection_md = sd.render_selection(sel, order, min_turns)
    cost_line = ", ".join(
        f"{m} EUR {c:.2f} ({plan.tokens[m][0]:,} in / {plan.tokens[m][1]:,} out tok)" for m, c in costs.items()
    )
    print(
        "\n".join(
            [
                "BENCH tutor discrimination — from real sessions (read-only selection)",
                f"  project       : {project} · view {view}",
                f"  window        : {args.since} .. {until} (inclusive, UTC) · min tutor turns {min_turns}",
                f"  filters       : tutor={args.tutor or 'all'} · framework={args.framework or 'all'}"
                f" · max-sessions={args.max_sessions or 'none'}",
                f"  sessions      : {len(sel.classroom)} in {len({s.group_id for s in sel.classroom})} groups",
                *(
                    [
                        f"  teacher trials: {len(sel.teacher_trials)} (Try as student; judged, reported "
                        "separately, never pooled)"
                    ]
                    if args.include_teacher_trials
                    else []
                ),
                f"  judge model   : {judge_model} (blind; analysis model) · approaches judged: {len(order)}",
                f"  fit calls     : {plan.fit_calls} · tone calls: {plan.tone_calls} · sycophancy: 0 (no planted claim)",
                f"  TOTAL CALLS   : {plan.total_calls} (before any 429/5xx retries; zero tutor calls)",
                f"  est. cost     : {cost_line or 'EUR 0.00'}",
                f"  est. total    : EUR {est_total:.2f} (rough: chars/4 tokens, generous output sizes)",
                "",
                selection_md,
            ]
        )
    )
    if args.dry_run:
        print("\n--dry-run: no model was called (one read-only BigQuery selection only).")
        return 0
    if args.referral_only:
        return _sessions_referral(args, query, view, sel, until=until, order=order)
    if not args.go:
        print("\nRefusing to call any model without --go. The judge costs real money; get M's go-ahead first.")
        return 2
    if not sel.sessions:
        print("\nNo sessions selected; nothing to judge.")
        return 0

    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
    from analytics.framework_discrimination import FIT_PROMPT_VERSION, TONE_PROMPT_VERSION, resolve_judge
    from analytics.model_retry import call_with_retry

    judge_retries = [0]

    def _count(_attempt: int, _desc: str) -> None:
        judge_retries[0] += 1

    async def retrying_judge(prompt: str, model: str) -> str:
        base = resolve_judge(judge)  # resolved per call, so a patched seam is honoured
        return await call_with_retry(
            lambda: base(prompt, model),
            label=f"judge {model}",
            attempts=args.retry_attempts,
            sleep=sleep,
            on_retry=_count,
        )

    started = time.monotonic()
    transcripts = sd.fetch_transcripts(query, view, sel.sessions, since=args.since, until=until)
    # Per-run salt, never written: a group code is a small space, so an unsalted
    # (or recorded-salt) hash could be reversed by hashing candidates.
    salt = os.environ.get("BENCH_GROUP_SALT") or secrets.token_hex(16)
    rows = asyncio.run(
        sd.judge_sessions(
            sel.sessions,
            transcripts,
            frameworks,
            judge_model=judge_model,
            judge=retrying_judge,
            salt=salt,
            concurrency=args.concurrency,
        )
    )
    out_dir = args.out or DEFAULT_OUT_ROOT / f"sessions-{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
    out_dir.mkdir(parents=True, exist_ok=True)
    revision = _git_revision()
    _write_jsonl(
        out_dir / "transcripts.jsonl",
        [
            {
                "sessionId": s.session_id,
                "frameworkId": s.framework_id,
                "groupHash": sd.group_hash(s.group_id, salt),
                "turns": [t.model_dump() for t in transcripts.get(s.session_id, [])],
            }
            for s in sel.sessions
        ],
    )
    _write_jsonl(out_dir / "raw_scores.jsonl", [{**r, "revision": revision, "judgeModel": judge_model} for r in rows])

    calls = sum((r["fit"] or {}).get("calls", 0) + (r["tone"] or {}).get("calls", 0) for r in rows)
    who = "student groups + teacher trials (separate section)" if args.include_teacher_trials else "student groups only"
    provenance = [
        f"- Run: {datetime.now(UTC).isoformat(timespec='seconds')} · project `{project}` · "
        f"{time.monotonic() - started:.0f}s · code revision `{revision or 'unknown'}`",
        f"- Selection: `{args.since}` .. `{until}` inclusive (UTC) · `teaching_source = 'tutor'` with a framework · "
        f"{who} · >= {min_turns} tutor turns · tutor={args.tutor or 'all'} · "
        f"framework={args.framework or 'all'}",
        f"- Judge: `{judge_model}` (blind) · fit `{FIT_PROMPT_VERSION}` · tone `{TONE_PROMPT_VERSION}` · "
        f"judge calls made **{calls}** · retries on 429/5xx {judge_retries[0]} · estimate was EUR {est_total:.2f}",
        "- Group ids appear nowhere in this directory except as a salted hash in the jsonl files (salt per run, "
        "not written). `transcripts.jsonl` and `raw_scores.jsonl` hold transcript text and quotes: gitignored, "
        "for human checking only.",
    ]
    report = sd.build_sessions_report(
        rows,
        order=order,
        selection_md=selection_md,
        provenance=provenance,
        title=f"Tutor discrimination on classroom sessions — {args.env}, {args.since} .. {until}",
    )
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    print("\n" + _headline_of(report))
    print(f"\n{calls} judge calls made. Report: {out_dir / 'report.md'}")
    return 0


def _sessions_referral(
    args: argparse.Namespace, query: QueryFn, view: str, sel: Any, *, until: Any, order: list[str]
) -> int:
    """1.1.149 M6 — the referral probe over REAL sessions. Deterministic: no model
    is called. Uses the GENERIC lexicon only — a session row carries no activity
    config to take element and sim names from — which is exactly what the M0 SQL
    counts, so the two numbers are comparable.

    ⚠️ The selection keeps only ``teaching_source = 'tutor'`` sessions WITH a
    framework (it was built for the discrimination judge). Workbench activities
    run by a framework-less tutor are not in it; the M0 SQL (``research/
    workbench-referral/m0.sql`` Q1) is the all-sessions count.
    """
    from analytics import session_discrimination as sd
    from analytics.workbench_referral import referral_probe

    if not sel.sessions:
        print("\nNo sessions selected; nothing to count.")
        return 0
    transcripts = sd.fetch_transcripts(query, view, sel.sessions, since=args.since, until=until)
    rows = []
    for s in sel.sessions:
        turns = [{"role": t.role, "content": t.content} for t in transcripts.get(s.session_id, [])]
        rows.append(
            {
                "ok": True,
                "producing": s.framework_id,
                "tutorModel": s.cohort,
                "referral": referral_probe(turns).to_dict(),
            }
        )
    cohorts = list(dict.fromkeys(r["tutorModel"] for r in rows))
    section = render_referral_section(rows, order=order, tutor_models=cohorts)
    print("\n" + section)
    print("\n--referral-only: no model was called.")
    if args.out is not None:
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "referral.md").write_text(section + "\n", encoding="utf-8")
    return 0


def _headline_of(report: str) -> str:
    """The headline section of a rendered report, for the terminal."""
    start = report.find("## Headline")
    end = report.find("\n## ", start + 1)
    return report[start:end].strip() if start >= 0 else ""


def main(
    argv: list[str] | None = None,
    *,
    compose: ComposeFn | None = None,
    tutor_turn: TutorTurnFn | None = None,
    judge: JudgeFn | None = None,
    sleep: SleepFn = asyncio.sleep,
    query: QueryFn | None = None,
    activity_compose: ActivityComposeFn | None = None,
) -> int:
    args = _parse_args(argv)
    if args.from_sessions:
        return from_sessions(args, query=query, judge=judge, sleep=sleep)
    if args.report_only is not None:
        target, report = report_only(args.report_only, args.out)
        print(_headline_of(report))
        print(f"\n--report-only: no model was called. Report: {target}")
        return 0
    setup = build_setup(args)
    plan_text, _ = render_plan(setup)
    print(plan_text)
    if args.dry_run:
        print("\n--dry-run: no model was called.")
        return 0
    if not args.go:
        print("\nRefusing to call any model without --go. This run costs real money; get M's go-ahead first.")
        return 2

    os.environ.setdefault("GOOGLE_CLOUD_LOCATION", "global")
    if compose is None or tutor_turn is None:
        from analytics.tutor_preview import compose_approach_instruction, run_preview_dialogue_turn

        compose = compose or compose_approach_instruction
        tutor_turn = tutor_turn or run_preview_dialogue_turn
    out_dir = args.out or DEFAULT_OUT_ROOT / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    result = asyncio.run(
        run_benchmark(
            setup,
            out_dir,
            concurrency=args.concurrency,
            compose=compose,
            tutor_turn=tutor_turn,
            judge=judge,
            attempts=args.retry_attempts,
            sleep=sleep,
            activity_compose=activity_compose or compose_activity_turn,
        )
    )
    print("\n" + _headline_of(result["report"]))
    print(f"\n{result['calls']} calls made. Report: {out_dir / 'report.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
