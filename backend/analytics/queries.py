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

from db.bigquery import CHAT_TURN_TABLE, run_query, table_ref


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


__all__ = ["count_messages"]
