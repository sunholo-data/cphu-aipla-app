"""Pure KPI aggregate functions for the teacher insights dashboard.

Each function in this module:

- Receives a ``teacher_uid`` + (where applicable) a ``class_id`` + a
  time window.
- Resolves the caller's owned ``group_codes`` via
  :func:`analytics.auth.resolve_caller_group_codes` and, for per-class
  aggregates, narrows to the class's own group codes after an
  ``assert_caller_owns`` gate.
- Calls one or more :mod:`analytics.queries` functions.
- Returns a structured dict the frontend renders, plus a
  ``_debug.queries`` list ``[{name, sql, params}]`` echoing the SQL
  templates from :data:`analytics.queries.SQL_TEMPLATES` and the bound
  params. The frontend uses this to populate the per-card "Show data"
  disclosure (axiom 2: EARNED TRUST).

Authorization is enforced once per call, in Python. Never trust a
``WHERE`` clause to scope to the caller. See the M2 HARD GATE notes
for why this matters.
"""

from __future__ import annotations

import statistics
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from analytics import queries
from analytics.auth import (
    PERMISSION_ERROR_MESSAGE,
    assert_can_read_class,
    resolve_caller_group_codes,
)
from db.classes import get_class, list_all_classes, list_classes_for_owner

if TYPE_CHECKING:
    from auth.firebase_auth import User


def _utcnow() -> datetime:
    return datetime.now(UTC)


def default_window(*, days: int = 7) -> tuple[datetime, datetime]:
    """Canonical (since, until) for ``--since 7d``-style requests.
    Centralised so every aggregate uses the same boundary."""
    until = _utcnow()
    return (until - timedelta(days=days), until)


def _class_group_codes(class_id: str) -> list[str]:
    """Group codes for an already-authorised ``class_id``. Mirrors the
    helper in :mod:`analytics.tools`."""
    cls = get_class(class_id)
    if cls is None:
        raise PermissionError(PERMISSION_ERROR_MESSAGE)
    return list(cls.group_codes)


def _query_meta(name: str, params: dict[str, Any]) -> dict[str, Any]:
    """Build one ``_debug.queries`` entry. SQL is sourced from
    :data:`analytics.queries.SQL_TEMPLATES` so the dashboard's
    "Show data" disclosure surfaces the exact SQL the backend ran."""
    return {
        "name": name,
        "sql": queries.SQL_TEMPLATES.get(name, ""),
        "params": {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in params.items()},
    }


def _common_params(
    *,
    since: datetime,
    until: datetime,
    allowed: list[str],
    class_codes: list[str],
) -> dict[str, Any]:
    return {
        "since": since,
        "until": until,
        "allowed_group_codes": allowed,
        "class_group_codes": class_codes,
    }


def _widen_allowed(allowed: list[str], class_codes: list[str]) -> list[str]:
    """Append any ``class_codes`` not already in ``allowed`` (researcher
    cross-class bypass — sprint 1.1.51).

    ``allowed_group_codes`` is a defense-in-depth filter scoped to the
    caller's OWNED group codes (the M2 HARD GATE: never trust the SQL
    ``WHERE`` to scope to the caller). For an OWNER, ``class_codes`` is a
    subset of ``allowed`` so this is a no-op and the emitted SQL / params /
    ``_debug`` output are byte-identical to before. For a RESEARCHER reading
    a class they do not own, ``assert_can_read_class`` has already authorized
    the class, but its codes are absent from the caller's owned set — without
    this widening the ``allowed ∩ class`` intersection is empty and the query
    returns authorized-but-zero rows. Append-only preserves owner ordering.
    """
    missing = [c for c in class_codes if c not in allowed]
    return allowed + missing if missing else allowed


# ---------------------------------------------------------------------------
# Per-class KPI grid (the six cards documented in the design doc)
# ---------------------------------------------------------------------------


def class_kpis(
    *,
    user: User,
    class_id: str,
    since: datetime,
    until: datetime,
) -> dict[str, Any]:
    """Six KPI cards + the underlying queries.

    The six cards mirror the design doc's KPI catalogue: active groups,
    total messages, active activities, sim runs, avg time-on-task,
    last activity. Each card's "Show data" disclosure on the frontend
    pulls from ``_debug.queries``.

    Owner reads its own class; a researcher (1.1.51) may read any class
    via ``assert_can_read_class``, with the defense-in-depth filter widened
    to the target class's codes.
    """
    assert_can_read_class(user, class_id)
    class_codes = _class_group_codes(class_id)
    allowed = _widen_allowed(list(resolve_caller_group_codes(user.uid)), class_codes)
    base = _common_params(since=since, until=until, allowed=allowed, class_codes=class_codes)

    counts = queries.count_messages(**base)
    tot = queries.time_on_task(**base)
    sims = queries.sim_runs_per_skill(**base)
    top = queries.most_active_groups(**base, limit=1)

    # KPI: active groups (≥1 message in the window).
    active_groups = len(counts["per_group"])
    # KPI: total messages.
    total_messages = counts["total"]
    # KPI: active activities — union of skills that produced messages
    # OR sim runs in the window.
    skills_with_msgs = {g.get("skill_id") for g in tot["per_group"] if g.get("skill_id")}
    skills_with_sims = {s["skill_id"] for s in sims["per_skill"]}
    active_activities = len(skills_with_msgs | skills_with_sims)
    # KPI: sim runs.
    sim_runs = sims["total"]
    # KPI: median time-on-task (minutes). Take the per-group durations;
    # 0 if no group has any session yet.
    durations = [g["duration_min"] for g in tot["per_group"] if g.get("duration_min") is not None]
    median_time_on_task_min = int(statistics.median(durations)) if durations else 0
    # KPI: last activity timestamp.
    last_activity_iso: str | None = None
    if top["groups"]:
        # most_active_groups doesn't carry a timestamp; fall back to
        # the max(last_ts) from time_on_task which we already have.
        if tot["per_group"]:
            last_activity_iso = max(g["last_ts"] for g in tot["per_group"])

    return {
        "class_id": class_id,
        "since": since.isoformat(),
        "until": until.isoformat(),
        "kpis": {
            "active_groups": active_groups,
            "total_messages": total_messages,
            "active_activities": active_activities,
            "sim_runs": sim_runs,
            "median_time_on_task_min": median_time_on_task_min,
            "last_activity": last_activity_iso,
        },
        "_debug": {
            "queries": [
                _query_meta("count_messages", base),
                _query_meta("time_on_task", base),
                _query_meta("sim_runs_per_skill", base),
                _query_meta("most_active_groups", {**base, "limit": 1}),
            ]
        },
    }


# ---------------------------------------------------------------------------
# Per-group breakdown (used by the bar chart inside the class panel)
# ---------------------------------------------------------------------------


def class_groups(
    *,
    user: User,
    class_id: str,
    since: datetime,
    until: datetime,
) -> dict[str, Any]:
    """Per-group engagement breakdown: message count + session count
    per group code in the class. Sorted most-active first.

    Owner or researcher read (1.1.51) — see ``class_kpis``."""
    assert_can_read_class(user, class_id)
    class_codes = _class_group_codes(class_id)
    allowed = _widen_allowed(list(resolve_caller_group_codes(user.uid)), class_codes)
    base = _common_params(since=since, until=until, allowed=allowed, class_codes=class_codes)

    # most_active_groups returns ordered + paged; the panel wants all
    # groups in the class — clamp limit to len(class_codes) but at
    # least 1 to satisfy the SQL @limit parameter.
    limit = max(1, len(class_codes))
    top = queries.most_active_groups(**base, limit=limit)

    return {
        "class_id": class_id,
        "groups": top["groups"],
        "_debug": {"queries": [_query_meta("most_active_groups", {**base, "limit": limit})]},
    }


# ---------------------------------------------------------------------------
# Per-activity breakdown (the second bar chart in the class panel)
# ---------------------------------------------------------------------------


def class_activities(
    *,
    user: User,
    class_id: str,
    since: datetime,
    until: datetime,
) -> dict[str, Any]:
    """Per-activity (skill) breakdown for a class. For each skill,
    pairs sim-run count from ``sim_runs_per_skill`` with message count
    derived from ``time_on_task`` (which has a per-skill row per group
    so summing rows gives a per-skill total).

    Owner or researcher read (1.1.51) — see ``class_kpis``."""
    assert_can_read_class(user, class_id)
    class_codes = _class_group_codes(class_id)
    allowed = _widen_allowed(list(resolve_caller_group_codes(user.uid)), class_codes)
    base = _common_params(since=since, until=until, allowed=allowed, class_codes=class_codes)

    tot = queries.time_on_task(**base)
    sims = queries.sim_runs_per_skill(**base)

    msg_count_per_skill: dict[str, int] = {}
    for row in tot["per_group"]:
        skill = row.get("skill_id") or "unknown"
        # time_on_task doesn't carry a per-row message count, so this
        # approximates "this skill had at least one turn for this
        # group" by counting groups touching the skill. Cheaper than
        # adding a new SQL; sufficient for the bar height.
        msg_count_per_skill[skill] = msg_count_per_skill.get(skill, 0) + 1
    sim_runs_per_skill: dict[str, int] = {s["skill_id"]: s["run_count"] for s in sims["per_skill"]}

    skill_ids = set(msg_count_per_skill) | set(sim_runs_per_skill)
    activities = sorted(
        (
            {
                "skill_id": s,
                "active_groups": msg_count_per_skill.get(s, 0),
                "sim_runs": sim_runs_per_skill.get(s, 0),
            }
            for s in skill_ids
        ),
        key=lambda r: (r["sim_runs"], r["active_groups"]),
        reverse=True,
    )

    return {
        "class_id": class_id,
        "activities": activities,
        "_debug": {
            "queries": [
                _query_meta("time_on_task", base),
                _query_meta("sim_runs_per_skill", base),
            ]
        },
    }


# ---------------------------------------------------------------------------
# /api/insights/summary — small per-class strip for every owned class
# ---------------------------------------------------------------------------


def _scope_classes(user: User, scope: str) -> tuple[list[Any], list[str]]:
    """Resolve the (classes, allowed_group_codes) pair for ``summary`` /
    ``compare`` (sprint 1.1.51).

    ``scope == "all"`` AND a researcher claim → every class across all
    teachers, with ``allowed`` widened to the union of all those classes'
    codes (so each class's ``allowed ∩ class`` intersection is the class's
    own codes). Any other case is the unchanged owner path:
    ``list_classes_for_owner`` + the caller's owned group codes — so owner
    behaviour and emitted SQL are identical to before. The route enforces
    the 403 for a non-researcher requesting ``scope=all``; the
    ``is_researcher`` guard here is defense-in-depth (a non-researcher who
    somehow reaches this with ``scope=all`` silently gets their own scope,
    never someone else's data).
    """
    if scope == "all" and getattr(user, "is_researcher", False):
        classes = list_all_classes()
        allowed = sorted({code for cls in classes for code in cls.group_codes})
        return classes, allowed
    return list_classes_for_owner(user.uid), list(resolve_caller_group_codes(user.uid))


def teacher_summary(
    *,
    user: User,
    since: datetime,
    until: datetime,
    scope: str = "own",
) -> dict[str, Any]:
    """Lightweight strip for ``/teacher/classes``: one entry per class,
    each carrying active_groups + total_messages + last_activity.

    Fires the count_messages + time_on_task queries per class. The
    cache (60s TTL) is the load-bearing performance story; this
    function intentionally does not parallelise.

    ``scope="all"`` (researcher-only, 1.1.51) spans every teacher's class
    instead of the caller's own — see :func:`_scope_classes`.
    """
    classes, allowed = _scope_classes(user, scope)

    class_entries: list[dict[str, Any]] = []
    debug_entries: list[dict[str, Any]] = []
    for cls in classes:
        class_codes = list(cls.group_codes)
        base = _common_params(since=since, until=until, allowed=allowed, class_codes=class_codes)
        counts = queries.count_messages(**base)
        tot = queries.time_on_task(**base)
        last_iso = max((g["last_ts"] for g in tot["per_group"]), default=None)
        class_entries.append(
            {
                "class_id": cls.class_id,
                "name": cls.name,
                "owner_uid": cls.owner_uid,
                "active_groups": len(counts["per_group"]),
                "total_messages": counts["total"],
                "last_activity": last_iso,
            }
        )
        # The summary debug shape carries one queries-list per class;
        # the frontend doesn't show this disclosure on the strip, but
        # the CLI / smoke tests need it.
        debug_entries.append(
            {
                "class_id": cls.class_id,
                "queries": [_query_meta("count_messages", base), _query_meta("time_on_task", base)],
            }
        )

    return {
        "since": since.isoformat(),
        "until": until.isoformat(),
        "classes": class_entries,
        "_debug": {"per_class": debug_entries},
    }


# ---------------------------------------------------------------------------
# /api/insights/compare — cross-class table for /teacher/insights
# ---------------------------------------------------------------------------


def teacher_compare(
    *,
    user: User,
    since: datetime,
    until: datetime,
    scope: str = "own",
) -> dict[str, Any]:
    """Cross-class comparison rows + a delta vs the prior equally-sized
    window. The frontend sorts client-side; the API returns rows in
    class-creation order.

    ``scope="all"`` (researcher-only, 1.1.51) spans every teacher's class
    instead of the caller's own — see :func:`_scope_classes`.
    """
    classes, allowed = _scope_classes(user, scope)
    window = until - since
    prior_since = since - window
    prior_until = since

    rows: list[dict[str, Any]] = []
    debug_entries: list[dict[str, Any]] = []
    for cls in classes:
        class_codes = list(cls.group_codes)
        current_params = _common_params(since=since, until=until, allowed=allowed, class_codes=class_codes)
        prior_params = _common_params(since=prior_since, until=prior_until, allowed=allowed, class_codes=class_codes)
        current = queries.count_messages(**current_params)
        prior = queries.count_messages(**prior_params)
        sims = queries.sim_runs_per_skill(**current_params)
        tot = queries.time_on_task(**current_params)
        last_iso = max((g["last_ts"] for g in tot["per_group"]), default=None)
        delta = current["total"] - prior["total"]
        rows.append(
            {
                "class_id": cls.class_id,
                "name": cls.name,
                "owner_uid": cls.owner_uid,
                "active_groups": len(current["per_group"]),
                "messages": current["total"],
                "messages_prior": prior["total"],
                "messages_delta": delta,
                "sim_runs": sims["total"],
                "last_activity": last_iso,
            }
        )
        debug_entries.append(
            {
                "class_id": cls.class_id,
                "queries": [
                    _query_meta("count_messages", current_params),
                    _query_meta("count_messages", prior_params),
                    _query_meta("sim_runs_per_skill", current_params),
                    _query_meta("time_on_task", current_params),
                ],
            }
        )

    return {
        "since": since.isoformat(),
        "until": until.isoformat(),
        "rows": rows,
        "_debug": {"per_class": debug_entries},
    }


# ---------------------------------------------------------------------------
# Per-class trend (the 7-day sparkline at the top of the panel)
# ---------------------------------------------------------------------------


def class_trend(
    *,
    user: User,
    class_id: str,
    since: datetime,
    until: datetime,
) -> dict[str, Any]:
    """Per-day message counts for one class. Returns a dense series —
    every day in ``[since, until]`` is present, even if zero — so the
    frontend can render without date arithmetic.

    Owner or researcher read (1.1.51) — see ``class_kpis``."""
    assert_can_read_class(user, class_id)
    class_codes = _class_group_codes(class_id)
    allowed = _widen_allowed(list(resolve_caller_group_codes(user.uid)), class_codes)
    base = _common_params(since=since, until=until, allowed=allowed, class_codes=class_codes)

    raw = queries.messages_per_day(**base)
    counts_by_day = {row["day"]: row["count"] for row in raw["per_day"]}

    dense: list[dict[str, Any]] = []
    cursor = since.date()
    end = until.date()
    while cursor <= end:
        iso = cursor.isoformat()
        dense.append({"day": iso, "count": counts_by_day.get(iso, 0)})
        cursor = cursor + timedelta(days=1)

    return {
        "class_id": class_id,
        "per_day": dense,
        "_debug": {"queries": [_query_meta("messages_per_day", base)]},
    }


__all__ = [
    "class_activities",
    "class_groups",
    "class_kpis",
    "class_trend",
    "default_window",
    "teacher_compare",
    "teacher_summary",
]
