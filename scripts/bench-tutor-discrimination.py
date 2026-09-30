"""BENCH-1: do the seven tutors actually teach differently?

Scripted students (research/tutor-discrimination/scenarios.yaml) are run turn by
turn through the tutor for each of the seven teaching approaches, on each tutor
model; every transcript is then judged BLIND against all seven approaches on
the analysis model, plus the sycophancy probe where a scenario planted a wrong
claim. The report is a 7x7 fit matrix per tutor model with diagonal accuracy,
mean margin, confusions and the sycophancy table.

    make bench-tutors ARGS=--dry-run          # plan + call count + cost, ZERO model calls
    make bench-tutors ARGS=--go               # the real run (costs money; needs M's go-ahead)
    make bench-tutors ENV=dev ARGS="--go --tutor-models gemini-3.5-flash-lite"

Without --go it refuses to call any model. Outputs go to
research/tutor-discrimination/<UTC timestamp>/ (gitignored): report.md,
transcripts.jsonl, raw_scores.jsonl.

What the tutor runs on: ``tutor_preview.compose_approach_instruction`` — the
``concept-dialogue`` skill's instructions plus the approach's generated
instruction, read from the environment's Firestore exactly as a preview does.
It is NOT the full lesson prompt (no activity materials, ILOs, group history or
persona), and the report says so. Every tutor turn is logged under the
``preview:`` prefix with no content, so none of it can read as classroom
evidence.

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

ComposeFn = Callable[[str], dict[str, Any]]
TutorTurnFn = Callable[..., Awaitable[dict[str, Any]]]
JudgeFn = Callable[[str, str], Awaitable[str]]


@dataclass
class Setup:
    scenarios: list[Any]
    frameworks: list[Any]
    tutor_models: list[str]
    judge_model: str


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--dry-run", action="store_true", help="print the plan, call count and cost; make no calls")
    p.add_argument("--go", action="store_true", help="actually call the models (costs money)")
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
    p.add_argument("--out", type=Path, default=None, help="output dir (default: a timestamped dir)")
    return p.parse_args(argv)


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
    lines = [
        "BENCH-1 tutor discrimination — plan",
        f"  scenarios     : {len(setup.scenarios)} ({', '.join(s.id for s in setup.scenarios)})",
        f"  approaches    : {len(setup.frameworks)} ({', '.join(f.id for f in setup.frameworks)})",
        f"  tutor models  : {', '.join(setup.tutor_models)}",
        f"  judge model   : {setup.judge_model} (blind; analysis model)",
        f"  transcripts   : {n_transcripts} = scenarios x approaches x tutor models",
        f"  tutor calls   : {plan.tutor_calls} (one per scripted student turn)",
        f"  fit calls     : {plan.fit_calls} (each transcript judged against every approach)",
        f"  sycophancy    : {plan.sycophancy_calls} (transcripts of scenarios with a planted wrong claim)",
        f"  TOTAL CALLS   : {plan.total_calls}",
        "  est. cost     : "
        + ", ".join(
            f"{m} EUR {c:.2f} ({plan.tokens[m][0]:,} in / {plan.tokens[m][1]:,} out tok)" for m, c in costs.items()
        ),
        f"  est. total    : EUR {sum(costs.values()):.2f}  (rough: chars/4 tokens, generous output sizes,"
        " rate card in analytics/rate_card.py — gemini-3.8-flash is marked PROVISIONAL there)",
    ]
    return "\n".join(lines), plan


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


async def _run_transcript(
    scenario: Any,
    fw: Any,
    tutor_model: str,
    composed: dict[str, Any],
    tutor_turn: TutorTurnFn,
) -> dict[str, Any]:
    history: list[dict[str, str]] = []
    tokens = [0, 0]
    record: dict[str, Any] = {
        "id": f"{scenario.id}|{fw.id}|{tutor_model}",
        "scenario": scenario.id,
        "producing": fw.id,
        "tutorModel": tutor_model,
        "tutorId": composed["tutorId"],
        "composedFrom": composed["composedFrom"],
        "ok": True,
        "error": "",
    }
    for i, student in enumerate(scenario.student_turns):
        out = await tutor_turn(composed, history, student, model=tutor_model, uid=BENCH_UID, turn_index=2 * i + 1)
        history.append({"role": "student", "content": student})
        if not out.get("ok"):
            record.update(ok=False, error=f"tutor turn {i} failed: {out.get('error')}")
            break
        history.append({"role": "tutor", "content": out.get("reply", "")})
        tokens[0] += int(out.get("tokenIn") or 0)
        tokens[1] += int(out.get("tokenOut") or 0)
    record["turns"] = history
    record["tutorTokens"] = tokens
    return record


async def run_benchmark(
    setup: Setup,
    out_dir: Path,
    *,
    concurrency: int,
    compose: ComposeFn,
    tutor_turn: TutorTurnFn,
    judge: JudgeFn | None,
) -> dict[str, Any]:
    from analytics.framework_discrimination import (
        FIT_PROMPT_VERSION,
        SYCOPHANCY_PROMPT_VERSION,
        TranscriptFit,
        render_model_section,
        score_fit_all,
        score_sycophancy,
    )
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

    sem = asyncio.Semaphore(max(1, concurrency))
    started = time.monotonic()

    async def _one(scenario: Any, fw: Any, tutor_model: str) -> dict[str, Any]:
        async with sem:
            rec = await _run_transcript(scenario, fw, tutor_model, composed_by_fw[fw.id], tutor_turn)
            if not rec["ok"]:
                rec["fit"] = None
                rec["sycophancy"] = None
                return rec
            turns = [SessionTurn(timestamp="", role=t["role"], content=t["content"]) for t in rec["turns"]]
            # BLIND: only the dialogue and the frameworks go in. The producer label
            # (rec["producing"]) is joined back on AFTER judging.
            profile = await score_fit_all(
                turns, setup.frameworks, model=setup.judge_model, concurrency=concurrency, judge=judge
            )
            rec["fit"] = profile.to_dict()
            rec["sycophancy"] = await score_sycophancy(turns, scenario.probe, model=setup.judge_model, judge=judge)
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
                    "turns",
                )
            }
            fh.write(json.dumps(keep, ensure_ascii=False) + "\n")
    revision = _git_revision()
    with (out_dir / "raw_scores.jsonl").open("w", encoding="utf-8") as fh:
        for r in records:
            keep = {k: r[k] for k in ("id", "scenario", "producing", "tutorModel", "ok", "fit", "sycophancy")}
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
            fh.write(json.dumps(keep, ensure_ascii=False) + "\n")

    order = [f.id for f in setup.frameworks]
    tutor_calls = sum(len([t for t in r["turns"] if t["role"] == "tutor"]) for r in records)
    fit_calls = sum((r["fit"] or {}).get("calls", 0) for r in records)
    syco_calls = sum((r["sycophancy"] or {}).get("calls", 0) for r in records)
    tutor_cost = sum(cost_eur(r["tutorModel"], *r["tutorTokens"]) for r in records)
    failed = [r for r in records if not r["ok"]]

    sections = []
    for m in setup.tutor_models:
        rs = [r for r in records if r["tutorModel"] == m and r["ok"]]
        fits = [TranscriptFit(r["id"], r["producing"], {k: v["fit"] for k, v in r["fit"]["fits"].items()}) for r in rs]
        abstains = sum(1 for r in rs for v in r["fit"]["fits"].values() if v["abstained"])
        syco = [
            {"producing": r["producing"], "scenario": r["scenario"], **r["sycophancy"]}
            for r in rs
            if r["sycophancy"] and not str(r["sycophancy"].get("abstainReason", "")).startswith("no wrong claim")
        ]
        sections.append(render_model_section(m, fits, order, syco, abstains))

    from analytics.tutor_preview import DEFAULT_PREVIEW_SKILL

    header = [
        "# BENCH-1 — tutor discrimination report",
        "",
        f"Run: {datetime.now(UTC).isoformat(timespec='seconds')} · project `{os.environ.get('GOOGLE_CLOUD_PROJECT', '?')}`"
        f" · {time.monotonic() - started:.0f}s",
        "",
        "**The question (JB, 2026-09-29):** do the seven teaching approaches produce dialogues that fit their "
        "own approach better than the other six? And is any tutor sycophantic?",
        "",
        "## How to read this",
        "",
        "- Each transcript is a scripted student (identical turns for every tutor) talking to one approach's tutor.",
        "- Every transcript is judged **blind** against all seven approaches with each approach's own generated "
        "criteria. **Fit** = mean construct band (absent 0 / partial 1 / strong 2) / 2, so 0-1; an uncited band "
        "counts as absent. The seven fits are independent and do not sum to anything.",
        "- **Diagonal accuracy** = share of transcripts whose best fit is their own approach (a tie at the top is a "
        "miss). **Margin** = own fit - best other fit. Chance accuracy is 1/7 ≈ 0.14.",
        "- Fit is not quality. A tutor can be faithfully ESRU and still unhelpful.",
        "",
        "## Provenance",
        "",
        f"- Tutor instruction: `{DEFAULT_PREVIEW_SKILL}` skill + the approach's generated instruction "
        "(`tutor_preview.compose_approach_instruction`). **Not included:** activity materials, teacher ILOs, group "
        "history, persona. Preview-logged (`preview:` prefix, no content).",
        f"- Tutor models: {', '.join(f'`{m}`' for m in setup.tutor_models)} · judge: `{setup.judge_model}`",
        f"- Prompt versions: fit `{FIT_PROMPT_VERSION}` · sycophancy `{SYCOPHANCY_PROMPT_VERSION}` · "
        f"code revision `{revision or 'unknown'}`",
        f"- Scenarios: {', '.join(f'`{s.id}`' for s in setup.scenarios)} (language: "
        f"{', '.join(sorted({s.language for s in setup.scenarios}))})",
        f"- Calls made: tutor **{tutor_calls}** · fit **{fit_calls}** · sycophancy **{syco_calls}** · "
        f"total **{tutor_calls + fit_calls + syco_calls}**",
        f"- Tutor cost (from usage metadata, rate card): EUR {tutor_cost:.2f}. Judge cost is not metered here; "
        "see the dry-run estimate.",
        f"- Transcripts: {len(records)} · failed (not judged): {len(failed)}",
    ]
    if failed:
        header += ["", "### Failed transcripts", ""] + [f"- `{r['id']}`: {r['error']}" for r in failed]
    report = "\n".join(header) + "\n\n" + "\n\n".join(sections) + "\n"
    (out_dir / "report.md").write_text(report, encoding="utf-8")
    return {"records": records, "report": report, "calls": tutor_calls + fit_calls + syco_calls}


def main(
    argv: list[str] | None = None,
    *,
    compose: ComposeFn | None = None,
    tutor_turn: TutorTurnFn | None = None,
    judge: JudgeFn | None = None,
) -> int:
    args = _parse_args(argv)
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
        run_benchmark(setup, out_dir, concurrency=args.concurrency, compose=compose, tutor_turn=tutor_turn, judge=judge)
    )
    print(f"\n{result['calls']} calls made. Report: {out_dir / 'report.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
