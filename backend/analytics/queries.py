"""Parameter-bound SQL strings for analytics over the chat-log BQ
tables.

Every query in this module:

- Filters by ``@allowed_group_codes`` (the union of group_codes the
  caller owns — see :func:`analytics.auth.resolve_caller_group_codes`).
- Filters by ``@since`` / ``@until`` (TIMESTAMP). Required parameters;
  no unbounded scans.
- Uses ``@``-named parameter binding, never f-string interpolation of
  user data. The ``backend/db/bigquery.py.run_query`` helper binds
  ``str`` → STRING, ``datetime`` → TIMESTAMP, ``list[str]`` → ARRAY
  (STRING).

The SQL strings are kept in this module (not interleaved with the
:mod:`analytics.tools` wrappers) so they are greppable and reviewable
in isolation. Adding a new query: paste the SQL here, then write the
matching ``FunctionTool`` wrapper in :mod:`analytics.tools` that calls
``assert_caller_owns`` first.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from db.bigquery import CHAT_TURN_TABLE, WORKBENCH_EVENT_TABLE, run_query, table_ref


def count_messages(
    *,
    since: datetime,
    until: datetime,
    allowed_group_codes: list[str],
    class_group_codes: list[str],
) -> dict[str, Any]:
    """Total + per-group chat-turn counts within a time window.

    ``class_group_codes`` narrows to the group codes belonging to the
    specific class the caller asked about. ``allowed_group_codes`` is
    the caller's owned set — included in the SQL ``WHERE`` clause as
    defense in depth even though ``class_group_codes`` is always a
    subset of it (caller passed ``assert_caller_owns`` first).

    Returns ``{"total": int, "per_group": [{"group_code", "count"}, ...]}``.
    """
    if not class_group_codes or not allowed_group_codes:
        return {"total": 0, "per_group": []}

    sql = f"""
        SELECT
          jsonPayload.group_id AS group_code,
          COUNT(*) AS count
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY group_code
        ORDER BY count DESC
    """.strip()

    rows = run_query(
        sql,
        params={
            "since": since,
            "until": until,
            "class_group_codes": list(class_group_codes),
            "allowed_group_codes": list(allowed_group_codes),
        },
    )

    per_group = [{"group_code": r["group_code"], "count": int(r["count"])} for r in rows]
    total = sum(g["count"] for g in per_group)
    return {"total": total, "per_group": per_group}


def time_on_task(
    *,
    since: datetime,
    until: datetime,
    allowed_group_codes: list[str],
    class_group_codes: list[str],
) -> dict[str, Any]:
    """Per-group, per-skill time-on-task window from first to last chat
    turn in the period.

    Returns ``{"per_group": [{"group_code", "skill_id", "first_ts",
    "last_ts", "duration_min"}, ...]}``. ``duration_min`` is an integer
    minute count (``TIMESTAMP_DIFF`` with MINUTE granularity); short
    sessions show as 0 — that's correct.
    """
    if not class_group_codes or not allowed_group_codes:
        return {"per_group": []}

    sql = f"""
        SELECT
          jsonPayload.group_id AS group_code,
          jsonPayload.skill_id AS skill_id,
          MIN(timestamp) AS first_ts,
          MAX(timestamp) AS last_ts,
          TIMESTAMP_DIFF(MAX(timestamp), MIN(timestamp), MINUTE) AS duration_min
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY group_code, skill_id
        ORDER BY group_code, skill_id
    """.strip()

    rows = run_query(
        sql,
        params={
            "since": since,
            "until": until,
            "class_group_codes": list(class_group_codes),
            "allowed_group_codes": list(allowed_group_codes),
        },
    )

    per_group = [
        {
            "group_code": r["group_code"],
            "skill_id": r["skill_id"],
            "first_ts": r["first_ts"].isoformat() if hasattr(r["first_ts"], "isoformat") else r["first_ts"],
            "last_ts": r["last_ts"].isoformat() if hasattr(r["last_ts"], "isoformat") else r["last_ts"],
            "duration_min": int(r["duration_min"]),
        }
        for r in rows
    ]
    return {"per_group": per_group}


def sim_runs_per_skill(
    *,
    since: datetime,
    until: datetime,
    allowed_group_codes: list[str],
    class_group_codes: list[str],
) -> dict[str, Any]:
    """Sim-run counts grouped by skill_id, with distinct-group counts.

    Filters the workbench_event table for ``tool = 'sim_run'`` — other
    workbench event types (slider settle, state-change) are excluded
    so ``sim_runs`` matches the SKILL.md-aligned interpretation.
    """
    if not class_group_codes or not allowed_group_codes:
        return {"per_skill": [], "total": 0}

    sql = f"""
        SELECT
          jsonPayload.skill_id AS skill_id,
          COUNT(*) AS run_count,
          COUNT(DISTINCT jsonPayload.group_id) AS unique_groups
        FROM {table_ref(WORKBENCH_EVENT_TABLE)}
        WHERE jsonPayload.tool = 'sim_run'
          AND jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY skill_id
        ORDER BY run_count DESC
    """.strip()

    rows = run_query(
        sql,
        params={
            "since": since,
            "until": until,
            "class_group_codes": list(class_group_codes),
            "allowed_group_codes": list(allowed_group_codes),
        },
    )

    per_skill = [
        {
            "skill_id": r["skill_id"],
            "run_count": int(r["run_count"]),
            "unique_groups": int(r["unique_groups"]),
        }
        for r in rows
    ]
    total = sum(s["run_count"] for s in per_skill)
    return {"per_skill": per_skill, "total": total}


def most_active_groups(
    *,
    since: datetime,
    until: datetime,
    allowed_group_codes: list[str],
    class_group_codes: list[str],
    limit: int = 10,
) -> dict[str, Any]:
    """Top groups by message_count, with session_count alongside.

    ``limit`` is bound to a sane range (1..100) at the API layer; this
    function trusts the caller.
    """
    if not class_group_codes or not allowed_group_codes:
        return {"groups": []}

    sql = f"""
        SELECT
          jsonPayload.group_id AS group_code,
          COUNT(*) AS message_count,
          COUNT(DISTINCT jsonPayload.session_id) AS session_count
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY group_code
        ORDER BY message_count DESC
        LIMIT @limit
    """.strip()

    rows = run_query(
        sql,
        params={
            "since": since,
            "until": until,
            "class_group_codes": list(class_group_codes),
            "allowed_group_codes": list(allowed_group_codes),
            "limit": int(limit),
        },
    )

    groups = [
        {
            "group_code": r["group_code"],
            "message_count": int(r["message_count"]),
            "session_count": int(r["session_count"]),
        }
        for r in rows
    ]
    return {"groups": groups}


#: Resolved SQL templates keyed by query-function name. Exposed so the
#: insights routes (1.M) can echo SQL into their ``_debug.queries``
#: response field without duplicating the strings or scraping
#: ``inspect.getsource``. Whenever a SQL body in this module changes,
#: update the matching entry here. Tests assert these stay in sync via
#: ``tests/unit/analytics/test_queries_sql_templates_in_sync.py``.
SQL_TEMPLATES: dict[str, str] = {
    "count_messages": f"""
        SELECT
          jsonPayload.group_id AS group_code,
          COUNT(*) AS count
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY group_code
        ORDER BY count DESC
    """.strip(),
    "time_on_task": f"""
        SELECT
          jsonPayload.group_id AS group_code,
          jsonPayload.skill_id AS skill_id,
          MIN(timestamp) AS first_ts,
          MAX(timestamp) AS last_ts,
          TIMESTAMP_DIFF(MAX(timestamp), MIN(timestamp), MINUTE) AS duration_min
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY group_code, skill_id
        ORDER BY group_code, skill_id
    """.strip(),
    "sim_runs_per_skill": f"""
        SELECT
          jsonPayload.skill_id AS skill_id,
          COUNT(*) AS run_count,
          COUNT(DISTINCT jsonPayload.group_id) AS unique_groups
        FROM {table_ref(WORKBENCH_EVENT_TABLE)}
        WHERE jsonPayload.tool = 'sim_run'
          AND jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY skill_id
        ORDER BY run_count DESC
    """.strip(),
    "most_active_groups": f"""
        SELECT
          jsonPayload.group_id AS group_code,
          COUNT(*) AS message_count,
          COUNT(DISTINCT jsonPayload.session_id) AS session_count
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY group_code
        ORDER BY message_count DESC
        LIMIT @limit
    """.strip(),
    "messages_per_day": f"""
        SELECT
          DATE(timestamp) AS day,
          COUNT(*) AS count
        FROM {table_ref(CHAT_TURN_TABLE)}
        WHERE jsonPayload.group_id IN UNNEST(@class_group_codes)
          AND jsonPayload.group_id IN UNNEST(@allowed_group_codes)
          AND timestamp BETWEEN @since AND @until
        GROUP BY day
        ORDER BY day
    """.strip(),
}


def messages_per_day(
    *,
    since: datetime,
    until: datetime,
    allowed_group_codes: list[str],
    class_group_codes: list[str],
) -> dict[str, Any]:
    """Per-day message counts for a class. Fills the 7d-trend chart on
    the insights panel.

    Returns ``{"per_day": [{"day": "YYYY-MM-DD", "count": int}, ...]}``.
    ``per_day`` is API-ordered (ascending date); the frontend renders
    missing days as zero-bars.
    """
    if not class_group_codes or not allowed_group_codes:
        return {"per_day": []}

    rows = run_query(
        SQL_TEMPLATES["messages_per_day"],
        params={
            "since": since,
            "until": until,
            "class_group_codes": list(class_group_codes),
            "allowed_group_codes": list(allowed_group_codes),
        },
    )

    per_day = [
        {
            "day": r["day"].isoformat() if hasattr(r["day"], "isoformat") else str(r["day"]),
            "count": int(r["count"]),
        }
        for r in rows
    ]
    return {"per_day": per_day}


__all__ = [
    "SQL_TEMPLATES",
    "count_messages",
    "messages_per_day",
    "most_active_groups",
    "sim_runs_per_skill",
    "time_on_task",
]
