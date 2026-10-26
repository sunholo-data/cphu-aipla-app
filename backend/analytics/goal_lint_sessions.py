"""1.1.141 M0 — which real sessions ran on an activity whose goal carries pedagogy?

The measurement before any change: run the 1.1.140 M3 real-session fidelity
harness, and for each session record whether its activity's teaching goal
contains tone / hint / character / answer-giving lines (M2's lint, offline).
The prediction is that those sessions show a smaller own-column margin.

This module is the selection and the plan. It is **read-only** throughout:

1. one BigQuery selection over ``chat_turns`` — one row per session, no content;
2. one Firestore read per distinct activity, for its teaching goal;
3. the lint call count and a cost estimate.

Only ``run_lint`` makes model calls, and only the script's ``--go`` reaches it
(after M's go-ahead). ``--dry-run`` stops after step 3 with zero model calls.

Same population rules as ``session_discrimination``: ``teaching_source =
'tutor'`` with a framework, no teacher/preview groups, and group ids stay in
memory — outputs carry counts and session ids only (ADR-001).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any

from analytics.research_logs import NON_STUDENT_PREFIXES

QueryFn = Callable[[str, dict[str, Any]], list[Any]]
GoalFn = Callable[[str], str | None]
LintFn = Callable[..., Awaitable[Any]]

DEFAULT_MIN_TUTOR_TURNS = 6
#: Rough prompt size of a lint call beyond the goal itself: the instructions
#: plus one approach's generated criteria. Output is a short JSON list.
_PROMPT_OVERHEAD_CHARS = 6000
_OUTPUT_TOKENS = 400
_CHARS_PER_TOKEN = 4


def _student_only_sql() -> str:
    return " AND ".join(f"NOT STARTS_WITH(IFNULL(group_id, ''), '{p}')" for p in NON_STUDENT_PREFIXES)


def selection_sql(view: str) -> str:
    """One row per session: its activity(ies), approach(es) and tutor turns. No content."""
    return f"""
      SELECT
        session_id,
        ARRAY_AGG(DISTINCT activity_id IGNORE NULLS) AS activity_ids,
        ARRAY_AGG(DISTINCT framework_id IGNORE NULLS) AS framework_ids,
        COUNTIF(role = 'tutor') AS tutor_turns,
        MIN(ts) AS first_ts
      FROM {view}
      WHERE ts >= @since AND ts < @until
        AND teaching_source = 'tutor'
        AND framework_id IS NOT NULL AND framework_id != ''
        AND activity_id IS NOT NULL AND activity_id != ''
        AND session_id IS NOT NULL AND session_id != ''
        AND role IN ('student', 'tutor')
        AND {_student_only_sql()}
      GROUP BY session_id
    """


def _get(row: Any, key: str) -> Any:
    return row[key] if isinstance(row, dict) else getattr(row, key)


@dataclass(frozen=True)
class SessionActivity:
    session_id: str
    activity_id: str
    framework_id: str
    tutor_turns: int
    first_ts: str


@dataclass
class Selection:
    sessions: list[SessionActivity] = field(default_factory=list)
    mixed: int = 0
    below_min_turns: int = 0


def select_sessions(query: QueryFn, view: str, *, since: date, until: date, min_turns: int) -> Selection:
    """Read-only. A session spanning two activities or two approaches is
    excluded and counted — which goal taught it would be a guess."""
    params = {
        "since": datetime(since.year, since.month, since.day, tzinfo=UTC),
        "until": datetime(until.year, until.month, until.day, tzinfo=UTC) + timedelta(days=1),
    }
    sel = Selection()
    for r in query(selection_sql(view), params):
        acts = list(_get(r, "activity_ids") or [])
        fws = list(_get(r, "framework_ids") or [])
        if len(acts) != 1 or len(fws) != 1:
            sel.mixed += 1
            continue
        turns = int(_get(r, "tutor_turns") or 0)
        if turns < min_turns:
            sel.below_min_turns += 1
            continue
        first = _get(r, "first_ts")
        sel.sessions.append(
            SessionActivity(
                session_id=str(_get(r, "session_id")),
                activity_id=str(acts[0]),
                framework_id=str(fws[0]),
                tutor_turns=turns,
                first_ts=first.isoformat() if hasattr(first, "isoformat") else str(first or ""),
            )
        )
    sel.sessions.sort(key=lambda s: (s.first_ts, s.session_id))
    return sel


@dataclass
class LintPlan:
    selection: Selection
    goals: dict[str, str]  # activity_id -> teaching goal (non-empty only)
    missing: list[str]  # activity ids with no readable goal
    pairs: list[tuple[str, str]]  # distinct (activity_id, framework_id) to lint

    @property
    def lint_calls(self) -> int:
        """Distinct (goal text, approach) pairs — the lint caches on exactly that."""
        return len({(self.goals[a], fw) for a, fw in self.pairs})

    def tokens(self) -> tuple[int, int]:
        seen: set[tuple[str, str]] = set()
        tok_in = 0
        for a, fw in self.pairs:
            key = (self.goals[a], fw)
            if key in seen:
                continue
            seen.add(key)
            tok_in += (len(self.goals[a]) + _PROMPT_OVERHEAD_CHARS) // _CHARS_PER_TOKEN
        return tok_in, _OUTPUT_TOKENS * len(seen)

    def cost_eur(self, model: str) -> float:
        from analytics.rate_card import cost_eur

        tok_in, tok_out = self.tokens()
        return cost_eur(model, tok_in, tok_out)


def plan_lint(selection: Selection, read_goal: GoalFn) -> LintPlan:
    """Read each distinct activity's goal (read-only) and count the calls. No model."""
    goals: dict[str, str] = {}
    missing: list[str] = []
    for activity_id in sorted({s.activity_id for s in selection.sessions}):
        goal = (read_goal(activity_id) or "").strip()
        if goal:
            goals[activity_id] = goal
        else:
            missing.append(activity_id)
    pairs = sorted({(s.activity_id, s.framework_id) for s in selection.sessions if s.activity_id in goals})
    return LintPlan(selection=selection, goals=goals, missing=missing, pairs=pairs)


def render_plan(plan: LintPlan, *, model: str) -> str:
    sel = plan.selection
    by_fw: dict[str, int] = {}
    for s in sel.sessions:
        by_fw[s.framework_id] = by_fw.get(s.framework_id, 0) + 1
    tok_in, tok_out = plan.tokens()
    lines = [
        f"  sessions      : {len(sel.sessions)} (excluded: {sel.mixed} mixed activity/approach, "
        f"{sel.below_min_turns} below min tutor turns)",
        "  by approach   : " + (", ".join(f"{k} {v}" for k, v in sorted(by_fw.items())) or "-"),
        f"  activities    : {len(plan.goals)} with a goal · {len(plan.missing)} unreadable/empty",
        f"  lint calls    : {plan.lint_calls} (one per distinct goal x approach; cached by text hash)",
        f"  lint model    : {model} (analysis model)",
        f"  est. tokens   : {tok_in:,} in / {tok_out:,} out",
        f"  est. cost     : EUR {plan.cost_eur(model):.2f} (rough: chars/4)",
    ]
    return "\n".join(lines)


async def run_lint(plan: LintPlan, lint: LintFn | None = None) -> list[dict[str, Any]]:
    """--go only: lint each (goal, approach) once and label every session.

    Each row: session id, activity id, approach, whether the goal carries
    pedagogy, the span kinds and which constructs they conflict with. No goal
    text and no group id in the output — the spans are teacher text, and the
    activity id is the join back for a researcher who needs it.
    """
    if lint is None:
        from analytics.teaching_goal_lint import lint_teaching_goal as lint
    results: dict[tuple[str, str], Any] = {}
    for activity_id, fw in plan.pairs:
        results[(activity_id, fw)] = await lint(plan.goals[activity_id], framework_id=fw)
    rows: list[dict[str, Any]] = []
    for s in plan.selection.sessions:
        res = results.get((s.activity_id, s.framework_id))
        spans = list(getattr(res, "spans", []) or []) if res is not None else []
        rows.append(
            {
                "sessionId": s.session_id,
                "activityId": s.activity_id,
                "frameworkId": s.framework_id,
                "tutorTurns": s.tutor_turns,
                "goalRead": s.activity_id in plan.goals,
                "carriesPedagogy": bool(spans),
                "spanKinds": sorted({sp.kind for sp in spans}),
                "conflictsWith": sorted({k for sp in spans for k in sp.conflicts_with}),
                "lintDegraded": bool(getattr(res, "degraded", False)) if res is not None else None,
            }
        )
    return rows


def firestore_goal_reader() -> GoalFn:
    """Read-only teaching-goal lookup through the app's own activity store."""
    from db.activities import get_activity

    def _read(activity_id: str) -> str | None:
        a = get_activity(activity_id, include_deleted=True)
        return a.teaching_goal if a is not None else None

    return _read


__all__ = [
    "DEFAULT_MIN_TUTOR_TURNS",
    "LintPlan",
    "Selection",
    "SessionActivity",
    "firestore_goal_reader",
    "plan_lint",
    "render_plan",
    "run_lint",
    "select_sessions",
    "selection_sql",
]
