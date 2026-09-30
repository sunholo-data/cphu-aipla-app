"""Tutor discrimination on REAL classroom sessions (1.1.140 M3).

JB, 2026-09-29: *"is the tutor based on the teaching approach? not convinced"*
and *"different personas gave the same answers"*. BENCH-1/2 answered with
scripted students and preview-composed tutors. This module answers with his own
classroom sessions: it selects prod sessions from the ``chat_turns`` view, reads
their turns, and judges each one BLIND against every approach
(``score_fit_all``, fidelity-r2) plus the tone probe. Rows of the resulting
matrix = the approach the session's tutor was actually assigned.

What is different from the preview benchmark, and why a reader must know it:

* The tutor ran on the FULL lesson prompt: activity materials, teacher focus /
  ILOs, group history, persona. The preview benchmark had none of those.
* The students are real, so the dialogues are not matched: one approach's
  sessions may be a different activity, class or length from another's. The
  column read still cancels the judge's per-column offset, but not that.
* No wrong claim was planted, so there is no sycophancy probe — tone only.

Rules:

* **Selection is read-only.** Only ``teaching_source = 'tutor'`` rows with a
  ``framework_id`` count. ``preview`` (a researcher trying a tutor) and
  ``fields`` (the pre-tutor persona-field path) are excluded, as is every
  non-student group prefix (``teacher:``, ``preview:``, ``preview-``) — nobody
  was taught in those.
* **ADR-001: the group is the finest grain, and group ids never leave.** The
  raw scores carry a SALTED hash of the group id (salt per run, never written),
  so rows from one group can be counted together without naming it. The
  report shows counts only. A researcher who needs the group joins back from
  ``session_id`` through the research-logs lens, which is access-controlled.
* **Blind**, analysis model, abstain over fabricate — all inherited from
  ``framework_discrimination``.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections import Counter, defaultdict
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from itertools import pairwise
from typing import Any

from analytics.framework_discrimination import (
    _FIT_OUTPUT_TOKENS,
    _TONE_OUTPUT_TOKENS,
    FIT_PROMPT_VERSION,
    LOW_SPREAD,
    TONE_PROMPT_VERSION,
    CallPlan,
    TranscriptFit,
    fit_matrix,
    render_column_table,
    render_headline_line,
    render_matrix,
    score_fit_all,
    score_tone,
    tone_table,
)
from analytics.framework_fidelity import MAX_TURNS, criteria_block
from analytics.research_logs import NON_STUDENT_PREFIXES, SYNTHETIC_CONTENT
from db.models.teaching_framework import TeachingFramework
from reports.session_summary import SessionTurn

#: The flattened view over the chat-turn sink (views.tf).
CHAT_TURNS_VIEW = "chat_turns"
#: Default floor on tutor turns: below this a dialogue shows too little of any approach.
DEFAULT_MIN_TUTOR_TURNS = 6
#: A row (approach) under either of these is flagged small-n in the report.
SMALL_N_SESSIONS = 5
SMALL_N_GROUPS = 3
#: The only teaching source that is teaching by an approach tutor.
TEACHING_SOURCE = "tutor"

_CHARS_PER_TOKEN = 4
_HIST_BINS = (10, 15, 20, 30)

QueryFn = Callable[[str, dict[str, Any]], list[Any]]
JudgeFn = Callable[[str, str], Awaitable[str]]


def _student_only_sql() -> str:
    # IFNULL is load-bearing, as in research_logs: NOT STARTS_WITH(NULL, …) is NULL.
    return " AND ".join(f"NOT STARTS_WITH(IFNULL(group_id, ''), '{p}')" for p in NON_STUDENT_PREFIXES)


def _window(since: date, until: date) -> dict[str, Any]:
    """``until`` is inclusive: the query reads ``ts < until + 1 day``."""
    return {
        "since": datetime(since.year, since.month, since.day, tzinfo=UTC),
        "until": datetime(until.year, until.month, until.day, tzinfo=UTC) + timedelta(days=1),
    }


def _base_where() -> str:
    return (
        "ts >= @since AND ts < @until"
        f" AND teaching_source = '{TEACHING_SOURCE}'"
        " AND framework_id IS NOT NULL AND framework_id != ''"
        " AND session_id IS NOT NULL AND session_id != ''"
        " AND role IN ('student', 'tutor')"
        f" AND {_student_only_sql()}"
    )


def selection_sql(view: str) -> str:
    """One row per session: its framework(s), tutors, turn counts and size.
    Carries no content, so a dry run never pulls a transcript."""
    return f"""
      SELECT
        session_id,
        ARRAY_AGG(DISTINCT group_id IGNORE NULLS) AS group_ids,
        ARRAY_AGG(DISTINCT framework_id IGNORE NULLS) AS framework_ids,
        ARRAY_AGG(DISTINCT tutor_id IGNORE NULLS) AS tutor_ids,
        ARRAY_AGG(DISTINCT persona_id IGNORE NULLS) AS persona_ids,
        ARRAY_AGG(DISTINCT model IGNORE NULLS) AS models,
        COUNTIF(role = 'tutor') AS tutor_turns,
        COUNTIF(role = 'student') AS student_turns,
        SUM(LENGTH(IFNULL(content, ''))) AS chars,
        MIN(ts) AS first_ts
      FROM {view}
      WHERE {_base_where()}
      GROUP BY session_id
    """


def excluded_sources_sql(view: str) -> str:
    """How many sessions in the window each teaching source had — so the
    report can show preview/fields were seen AND left out, not silently absent."""
    return f"""
      SELECT IFNULL(teaching_source, '(null)') AS teaching_source,
             COUNT(DISTINCT session_id) AS sessions
      FROM {view}
      WHERE ts >= @since AND ts < @until AND {_student_only_sql()}
      GROUP BY teaching_source
    """


def transcript_sql(view: str) -> str:
    return f"""
      SELECT session_id, ts, turn_index, role, content
      FROM {view}
      WHERE {_base_where()} AND session_id IN UNNEST(@session_ids)
      ORDER BY session_id, turn_index, ts
    """


def _get(row: Any, key: str) -> Any:
    return row[key] if isinstance(row, dict) else getattr(row, key)


@dataclass
class SessionMeta:
    """One selected session. ``group_id`` stays in memory; outputs carry only its hash."""

    session_id: str
    group_id: str
    framework_id: str
    tutor_ids: list[str]
    persona_ids: list[str]
    models: list[str]
    tutor_turns: int
    student_turns: int
    chars: int
    first_ts: str


@dataclass
class Selection:
    sessions: list[SessionMeta]
    below_min_turns: int = 0
    mixed_framework: int = 0
    filtered_out: int = 0
    capped: int = 0
    sources: dict[str, int] = field(default_factory=dict)


def select_sessions(
    query: QueryFn,
    view: str,
    *,
    since: date,
    until: date,
    min_turns: int = DEFAULT_MIN_TUTOR_TURNS,
    tutors: Iterable[str] = (),
    frameworks: Iterable[str] = (),
    max_sessions: int | None = None,
) -> Selection:
    """Read-only selection. A session assigned to more than one approach inside
    the window (reassigned mid-session) is excluded and counted — its row label
    would be a guess."""
    params = _window(since, until)
    tutor_set, fw_set = set(tutors), set(frameworks)
    sel = Selection(sessions=[])
    sel.sources = {
        str(_get(r, "teaching_source")): int(_get(r, "sessions")) for r in query(excluded_sources_sql(view), params)
    }
    for r in query(selection_sql(view), params):
        fws = list(_get(r, "framework_ids") or [])
        if len(fws) != 1:
            sel.mixed_framework += 1
            continue
        if int(_get(r, "tutor_turns") or 0) < min_turns:
            sel.below_min_turns += 1
            continue
        tids = sorted(_get(r, "tutor_ids") or [])
        if (fw_set and fws[0] not in fw_set) or (tutor_set and not tutor_set.intersection(tids)):
            sel.filtered_out += 1
            continue
        groups = sorted(_get(r, "group_ids") or [])
        first = _get(r, "first_ts")
        sel.sessions.append(
            SessionMeta(
                session_id=str(_get(r, "session_id")),
                group_id=groups[0] if groups else "",
                framework_id=fws[0],
                tutor_ids=tids,
                persona_ids=sorted(_get(r, "persona_ids") or []),
                models=sorted(_get(r, "models") or []),
                tutor_turns=int(_get(r, "tutor_turns") or 0),
                student_turns=int(_get(r, "student_turns") or 0),
                chars=int(_get(r, "chars") or 0),
                first_ts=first.isoformat() if hasattr(first, "isoformat") else str(first or ""),
            )
        )
    sel.sessions.sort(key=lambda s: (s.first_ts, s.session_id))
    if max_sessions is not None and len(sel.sessions) > max_sessions:
        sel.capped = len(sel.sessions) - max_sessions
        sel.sessions = sel.sessions[:max_sessions]
    return sel


def rows_to_turns(rows: Iterable[Any]) -> dict[str, list[SessionTurn]]:
    """Group transcript rows by session, ordered by turn_index then ts, in the
    harness's ``SessionTurn`` shape. The system's ``[session_start]`` sentinel is
    logged as a student turn but nobody typed it, so it is dropped here."""
    by: dict[str, list[tuple[int, str, SessionTurn]]] = defaultdict(list)
    for r in rows:
        role = _get(r, "role")
        content = _get(r, "content") or ""
        if role not in ("student", "tutor"):
            continue
        if role == "student" and content.strip() in SYNTHETIC_CONTENT:
            continue
        ts = _get(r, "ts")
        ts_s = ts.isoformat() if hasattr(ts, "isoformat") else str(ts or "")
        ti = _get(r, "turn_index")
        by[str(_get(r, "session_id"))].append(
            (ti if ti is not None else 10**9, ts_s, SessionTurn(timestamp=ts_s, role=role, content=content))
        )
    return {sid: [t for _, _, t in sorted(v, key=lambda x: (x[0], x[1]))] for sid, v in by.items()}


def fetch_transcripts(
    query: QueryFn, view: str, sessions: list[SessionMeta], *, since: date, until: date
) -> dict[str, list[SessionTurn]]:
    if not sessions:
        return {}
    params = {**_window(since, until), "session_ids": [s.session_id for s in sessions]}
    return rows_to_turns(query(transcript_sql(view), params))


def group_hash(group_id: str, salt: str) -> str:
    """Salted, truncated SHA-256. The salt is per run and never written, so a
    group code (a small space) cannot be recovered by hashing candidates."""
    return hashlib.sha256(f"{salt}:{group_id}".encode()).hexdigest()[:12]


# --- plan + sample description (no calls) ------------------------------------------


def plan_session_calls(sessions: list[SessionMeta], frameworks: list[TeachingFramework], judge_model: str) -> CallPlan:
    """Judge calls and tokens WITHOUT making any: one fit call per approach with
    assessable criteria, one tone call, per session. The dialogue is capped at
    ``MAX_TURNS`` in the judge prompt, so the estimate caps it the same way."""
    plan = CallPlan()
    judged = [f for f in frameworks if not f.is_placeholder and criteria_block(f)[1]]
    for s in sessions:
        turns = s.tutor_turns + s.student_turns
        chars = s.chars if turns <= MAX_TURNS else s.chars * MAX_TURNS // max(turns, 1)
        dialogue = chars // _CHARS_PER_TOKEN + 8 * min(turns, MAX_TURNS)
        for fw in judged:
            plan.fit_calls += 1
            plan.add(judge_model, len(criteria_block(fw)[0]) // _CHARS_PER_TOKEN + dialogue + 400, _FIT_OUTPUT_TOKENS)
        plan.tone_calls += 1
        plan.add(judge_model, dialogue + 500, _TONE_OUTPUT_TOKENS)
    return plan


@dataclass(frozen=True)
class RowN:
    framework_id: str
    sessions: int
    groups: int
    tutors: tuple[str, ...]
    small_n: bool


def row_n(sessions: Iterable[SessionMeta], order: list[str]) -> list[RowN]:
    """Per approach: sessions, distinct groups, tutor ids. Sessions from one
    group are not independent (ADR-001: the group is the unit), so a row is
    small-n on EITHER count."""
    by: dict[str, list[SessionMeta]] = defaultdict(list)
    for s in sessions:
        by[s.framework_id].append(s)
    out: list[RowN] = []
    for fw in [*order, *sorted(k for k in by if k not in order)]:
        ss = by.get(fw, [])
        groups = len({s.group_id for s in ss})
        tutors = tuple(sorted({t for s in ss for t in s.tutor_ids}))
        out.append(RowN(fw, len(ss), groups, tutors, len(ss) < SMALL_N_SESSIONS or groups < SMALL_N_GROUPS))
    return out


def turns_histogram(sessions: Iterable[SessionMeta], min_turns: int) -> list[tuple[str, int]]:
    """Tutor-turn counts in bins starting at the selection floor."""
    edges = [min_turns, *[b for b in _HIST_BINS if b > min_turns]]
    labels = [f"{lo}-{hi - 1}" for lo, hi in pairwise(edges)] + [f"{edges[-1]}+"]
    counts: Counter[str] = Counter()
    for s in sessions:
        idx = sum(1 for e in edges[1:] if s.tutor_turns >= e)
        counts[labels[idx]] += 1
    return [(lab, counts[lab]) for lab in labels]


def render_selection(sel: Selection, order: list[str], min_turns: int) -> str:
    lines = [
        "| approach (row) | sessions | groups | tutor ids | flag |",
        "|---|---|---|---|---|",
    ]
    for r in row_n(sel.sessions, order):
        flag = "**small n**" if r.small_n and r.sessions else ("no sessions" if not r.sessions else "")
        lines.append(f"| {r.framework_id} | {r.sessions} | {r.groups} | {', '.join(r.tutors) or '—'} | {flag} |")
    hist = " · ".join(f"{lab}: {n}" for lab, n in turns_histogram(sel.sessions, min_turns))
    sources = ", ".join(f"{k} {v}" for k, v in sorted(sel.sources.items())) or "none"
    lines += [
        "",
        f"- Tutor turns per session: {hist}",
        f"- Sessions in the window by teaching_source (student groups only): {sources} — only `tutor` is judged",
        f"- Excluded: {sel.below_min_turns} under {min_turns} tutor turns · {sel.mixed_framework} assigned to more "
        f"than one approach in the window · {sel.filtered_out} outside the --tutor/--framework filter · "
        f"{sel.capped} over --max-sessions",
    ]
    return "\n".join(lines)


# --- judging --------------------------------------------------------------------------


async def judge_sessions(
    sessions: list[SessionMeta],
    transcripts: dict[str, list[SessionTurn]],
    frameworks: list[TeachingFramework],
    *,
    judge_model: str,
    judge: JudgeFn,
    salt: str,
    concurrency: int = 4,
) -> list[dict[str, Any]]:
    """One raw-scores row per session. BLIND: only the dialogue and each
    approach's criteria reach a prompt; the session's framework joins after."""
    sem = asyncio.Semaphore(max(1, concurrency))

    async def _one(s: SessionMeta) -> dict[str, Any]:
        turns = transcripts.get(s.session_id, [])
        row: dict[str, Any] = {
            "id": s.session_id,
            "sessionId": s.session_id,
            "producing": s.framework_id,
            "frameworkId": s.framework_id,
            "groupHash": group_hash(s.group_id, salt),
            "tutorIds": s.tutor_ids,
            "personaIds": s.persona_ids,
            "tutorModels": s.models,
            "tutorTurns": s.tutor_turns,
            "studentTurns": s.student_turns,
            "firstTs": s.first_ts,
            "teachingSource": TEACHING_SOURCE,
            "ok": bool(turns),
            "error": "" if turns else "no turns read back for this session",
            "fit": None,
            "tone": None,
        }
        if not turns:
            return row
        async with sem:
            profile = await score_fit_all(turns, frameworks, model=judge_model, concurrency=concurrency, judge=judge)
            row["fit"] = profile.to_dict()
            row["tone"] = await score_tone(turns, model=judge_model, judge=judge)
        return row

    return list(await asyncio.gather(*(_one(s) for s in sessions)))


# --- report (pure over raw-scores rows) --------------------------------------------------


def _tone_table_md(rows: list[dict[str, Any]], order: list[str]) -> str:
    """The tone table WITHOUT the quoted instance: report.md carries no transcript text."""
    tone_rows = [{"producing": r["producing"], **(r.get("tone") or {"abstained": True})} for r in rows]
    out = [
        "| approach | none | mild | marked | not assessed | mean (0 none - 2 marked) |",
        "|---|---|---|---|---|---|",
    ]
    present = {r["producing"] for r in rows}
    for t in tone_table(tone_rows, [o for o in order if o in present]):
        mean = "—" if t.mean_score is None else f"{t.mean_score:.2f}"
        out.append(f"| {t.approach} | {t.none} | {t.mild} | {t.marked} | {t.abstained} | {mean} |")
    return "\n".join(out)


def build_sessions_report(
    rows: list[dict[str, Any]],
    *,
    order: list[str],
    selection_md: str,
    provenance: list[str],
    title: str,
) -> str:
    ok = [r for r in rows if r.get("ok") and r.get("fit")]
    fits = [TranscriptFit(r["id"], r["producing"], {k: v["fit"] for k, v in r["fit"]["fits"].items()}) for r in ok]
    abstains = sum(1 for r in ok for v in r["fit"]["fits"].values() if v["abstained"])
    matrix = fit_matrix(fits)
    failed = [r for r in rows if not r.get("ok")]
    n = len(order)
    lines = [
        f"# {title}",
        "",
        "**The question (JB, 2026-09-29):** *is the tutor based on the teaching approach?* and *different personas "
        "gave the same answers*, answered with real classroom sessions, not previews.",
        "",
        "## Headline (column-normalised)",
        "",
        render_headline_line("classroom sessions", fits, order),
        "",
        f"Sessions judged: **{len(fits)}** · framework reads abstained: **{abstains}** · failed: **{len(failed)}**. "
        "A row flagged small-n below (under "
        f"{SMALL_N_SESSIONS} sessions or {SMALL_N_GROUPS} groups) moves every column it sits in; read those "
        "columns as anecdote.",
        "",
        "## Sample (rows = the approach the session's tutor was assigned)",
        "",
        selection_md,
        "",
        "## What is different from the preview benchmark",
        "",
        "- **The tutor ran on the full lesson prompt**: activity materials, teacher focus / ILOs, group history, "
        "persona. BENCH-1/2 composed the approach alone. If these sessions blur where preview separated, the "
        "lesson layer is the first suspect (M4's persona/activity contradiction pass).",
        "- **The dialogues are not matched.** Different approaches were run in different classes, activities and "
        "lengths. The column read cancels the judge's per-column offset, not a difference in what was being "
        "taught. A clear own-column win here is stronger evidence than in preview; a miss is weaker.",
        "- **Sessions from one group are not independent** (ADR-001: the group is the finest grain). The n table "
        "counts both.",
        "- **No wrong claim was planted**, so there is no sycophancy probe; the tone probe reads unearned praise.",
        "",
        "## Per column: does each approach's tutor do more of it than the other tutors do?",
        "",
        f"Read DOWN a column. `low-spread` = the column's spread across rows is under {LOW_SPREAD:.2f} and "
        "cannot discriminate; `ceiling` / `floor` = it reads the same for everyone. A column with no sessions of "
        "its own approach is `unreadable`.",
        "",
        render_column_table(matrix, order),
        "",
        f"## Fit matrix (mean fit 0-1; rows = assigned approach, columns = judged as, bold = own; chance 1 of {n})",
        "",
        render_matrix(matrix, order).replace("| produced by ↓ / judged as → |", "| assigned ↓ / judged as → |")
        if matrix
        else "_no sessions judged_",
        "",
        "## Tone probe (unearned praise / flattery, every session)",
        "",
        _tone_table_md(ok, order),
        "",
        "Quoted instances are in `raw_scores.jsonl`, not here: this report carries no transcript text.",
        "",
        "## Provenance",
        "",
        *provenance,
    ]
    if failed:
        lines += ["", "### Sessions not judged", ""] + [f"- `{r['id']}`: {r.get('error') or '?'}" for r in failed]
    return "\n".join(lines) + "\n"


__all__ = [
    "CHAT_TURNS_VIEW",
    "DEFAULT_MIN_TUTOR_TURNS",
    "FIT_PROMPT_VERSION",
    "SMALL_N_GROUPS",
    "SMALL_N_SESSIONS",
    "TONE_PROMPT_VERSION",
    "RowN",
    "Selection",
    "SessionMeta",
    "build_sessions_report",
    "fetch_transcripts",
    "group_hash",
    "judge_sessions",
    "plan_session_calls",
    "render_selection",
    "row_n",
    "rows_to_turns",
    "select_sessions",
    "selection_sql",
    "transcript_sql",
    "turns_histogram",
]
