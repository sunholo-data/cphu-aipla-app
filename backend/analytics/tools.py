"""ADK ``FunctionTool``-compatible async wrappers for the
``analytics-chat`` skill.

Each wrapper follows the same pattern:

1. Pull ``user_uid`` from ``tool_context.state['user:id']``.
2. ``assert_caller_owns(user_uid, class_id)`` — raises if the caller
   doesn't own the class (byte-identical "class not accessible" for
   missing + forbidden, see :mod:`analytics.auth`).
3. Resolve the caller's owned ``group_codes`` (defense in depth filter)
   and the class's specific ``group_codes`` (scoping filter).
4. Call the matching :mod:`analytics.queries` function.
5. Return a structured dict the agent paraphrases per the skill prompt.

The agent never sees the SQL; the SQL never sees model-controlled
strings; the model never sees raw student content for these tools
(``summarise_chat_excerpts`` is the only exception — see
:mod:`analytics.summarise`).

Registered into ``backend/adk/tools.py::TOOL_REGISTRY`` so the
``analytics-chat`` skill's ``tools:`` frontmatter can name them.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from google.adk.tools import ToolContext

from analytics import queries
from analytics.auth import (
    PERMISSION_ERROR_MESSAGE,
    assert_caller_owns,
    resolve_caller_group_codes,
)
from analytics.auth import caller_uid as _caller_uid
from db.chat_sessions import list_sessions_for_group_codes
from db.classes import get_class
from reports.narrative import resolve_narrative
from reports.session_summary import resolve_session_summary

logger = logging.getLogger(__name__)


def _now() -> datetime:
    """Indirection so tests can monkeypatch the clock."""
    from datetime import UTC

    return datetime.now(UTC)


def _parse_since(since: str | None, default_days: int = 7) -> datetime:
    """Parse an ISO timestamp; fall back to ``now - default_days`` if
    the caller omits or sends an unparseable value. Agents pass strings
    so this is the canonical normalisation point."""
    if since:
        try:
            return datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("analytics.tools: bad since=%r, defaulting to %d days", since, default_days)
    return _now() - timedelta(days=default_days)


def _parse_until(until: str | None) -> datetime:
    if until:
        try:
            return datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("analytics.tools: bad until=%r, defaulting to now", until)
    return _now()


def _class_group_codes(class_id: str) -> list[str]:
    """Return the group codes belonging to ``class_id``. Caller has
    already gone through ``assert_caller_owns`` so existence is
    guaranteed."""
    cls = get_class(class_id)
    if cls is None:
        # Should not happen — assert_caller_owns ran first — but guard
        # to keep the error shape consistent if the class was deleted
        # between auth and query.
        raise PermissionError(PERMISSION_ERROR_MESSAGE)
    return list(cls.group_codes)


# ---------------------------------------------------------------------------
# Tool wrappers
# ---------------------------------------------------------------------------


async def count_messages(
    class_id: str,
    since: str | None = None,
    until: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Total chat-turn count for a class within a time window, broken
    out per group code.

    Args:
        class_id: The class to query. Must be owned by the calling teacher.
        since: ISO timestamp (UTC). Defaults to 7 days ago.
        until: ISO timestamp (UTC). Defaults to now.

    Returns:
        ``{"total": int, "per_group": [{"group_code", "count"}, ...]}``.
    """
    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    allowed = list(resolve_caller_group_codes(uid))
    class_codes = _class_group_codes(class_id)
    since_dt = _parse_since(since)
    until_dt = _parse_until(until)
    return queries.count_messages(
        since=since_dt,
        until=until_dt,
        allowed_group_codes=allowed,
        class_group_codes=class_codes,
    )


async def time_on_task(
    class_id: str,
    since: str | None = None,
    until: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Per-group, per-skill time-on-task window (first → last chat turn).

    Args:
        class_id: The class to query. Must be owned by the calling teacher.
        since: ISO timestamp (UTC). Defaults to 7 days ago.
        until: ISO timestamp (UTC). Defaults to now.

    Returns:
        ``{"per_group": [{"group_code", "skill_id", "first_ts",
        "last_ts", "duration_min"}, ...]}``.
    """
    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    allowed = list(resolve_caller_group_codes(uid))
    class_codes = _class_group_codes(class_id)
    since_dt = _parse_since(since)
    until_dt = _parse_until(until)
    return queries.time_on_task(
        since=since_dt,
        until=until_dt,
        allowed_group_codes=allowed,
        class_group_codes=class_codes,
    )


async def sim_runs_per_skill(
    class_id: str,
    since: str | None = None,
    until: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Workbench sim_run counts grouped by skill, within a time window.

    Args:
        class_id: The class to query. Must be owned by the calling teacher.
        since: ISO timestamp (UTC). Defaults to 7 days ago.
        until: ISO timestamp (UTC). Defaults to now.

    Returns:
        ``{"per_skill": [{"skill_id", "run_count", "unique_groups"}, ...],
        "total": int}``.
    """
    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    allowed = list(resolve_caller_group_codes(uid))
    class_codes = _class_group_codes(class_id)
    since_dt = _parse_since(since)
    until_dt = _parse_until(until)
    return queries.sim_runs_per_skill(
        since=since_dt,
        until=until_dt,
        allowed_group_codes=allowed,
        class_group_codes=class_codes,
    )


async def most_active_groups(
    class_id: str,
    since: str | None = None,
    until: str | None = None,
    limit: int = 10,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Top groups by message count, with session counts alongside.

    Args:
        class_id: The class to query. Must be owned by the calling teacher.
        since: ISO timestamp (UTC). Defaults to 7 days ago.
        until: ISO timestamp (UTC). Defaults to now.
        limit: How many top groups to return. Clamped to 1..100.

    Returns:
        ``{"groups": [{"group_code", "message_count", "session_count"}, ...]}``.
    """
    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    allowed = list(resolve_caller_group_codes(uid))
    class_codes = _class_group_codes(class_id)
    since_dt = _parse_since(since)
    until_dt = _parse_until(until)
    bounded = max(1, min(int(limit), 100))
    return queries.most_active_groups(
        since=since_dt,
        until=until_dt,
        allowed_group_codes=allowed,
        class_group_codes=class_codes,
        limit=bounded,
    )


async def group_summary(
    class_id: str,
    group_code: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """List recent sessions for one group inside a class.

    Wraps the existing :func:`db.chat_sessions.list_sessions_for_group_codes`
    rather than going through BigQuery — the data is in Firestore and
    already deduplicated. The caller can deep-link individual sessions
    or aggregate them.

    Args:
        class_id: The class. Must be owned by the calling teacher.
        group_code: A group code within that class. Reject if it doesn't
            belong — same byte-identical refusal as a missing class.

    Returns:
        ``{"sessions": [{"session_id", "skill_id", "group_code",
        "last_message_at", "turn_count", "title"}, ...]}``.
    """
    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    class_codes = _class_group_codes(class_id)
    if group_code not in class_codes:
        # group_code is not part of this class — same refusal shape.
        raise PermissionError(PERMISSION_ERROR_MESSAGE)
    sessions = list_sessions_for_group_codes([group_code])
    return {
        "sessions": [
            {
                "session_id": s.session_id,
                "skill_id": s.skill_id,
                "group_code": s.group_code,
                "last_message_at": s.last_message_at.isoformat(),
                "turn_count": s.turn_count,
                "title": s.title,
            }
            for s in sessions
        ]
    }


# Bound the per-group report payload so a long lesson doesn't blow the
# co-pilot's token budget — the narrative carries the gist; these give the
# co-pilot raw material to answer specific follow-ups.
_REPORT_MAX_TURNS = 20
_REPORT_MAX_WB_EVENTS = 30


async def group_report(
    class_id: str,
    group_code: str,
    refresh: bool = False,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Read ONE group's latest session report — the SAME data the teacher sees on
    the live group report: the AI summary, recent chat turns, and workbench
    interactions.

    Use this when a teacher asks about a specific group — e.g. "what is group
    7B-rød stuck on?", "summarise their session", "what did they try in the
    workbench?". For class-wide questions use the other analytics tools.

    Args:
        class_id: The class. Must be owned by the calling teacher.
        group_code: A group code within that class. Rejected if it doesn't belong.
        refresh: Force the AI summary to regenerate now (bypasses the ~5-min
            cache). Default False — the cached/auto summary is usually current.

    Returns:
        ``{"found", "session_id", "group_code", "activity_id", "message_count",
        "sim_run_count", "narrative", "recent_turns": [{role, content,
        timestamp}], "workbench_events": [{tool, field, value, timestamp}],
        "voice_minutes", "has_voice"}``. ``found=False`` when the group has no
        session yet. The lists are bounded to the most recent turns/events.
    """
    uid = _caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    if group_code not in _class_group_codes(class_id):
        raise PermissionError(PERMISSION_ERROR_MESSAGE)

    sessions = list_sessions_for_group_codes([group_code])
    if not sessions:
        return {"found": False, "group_code": group_code}
    # Newest session with actual turns; a bare 0-turn join can otherwise win
    # "latest" by timestamp and yield an empty report. list_sessions_* is
    # newest-first.
    with_turns = [s for s in sessions if s.turn_count > 0]
    latest = (with_turns or sessions)[0]

    summary = await resolve_session_summary(latest.session_id)
    if summary is None:
        return {"found": False, "group_code": group_code}
    await resolve_narrative(summary, force=refresh)

    return {
        "found": True,
        "session_id": summary.session_id,
        "group_code": group_code,
        "activity_id": summary.activity_id,
        "message_count": summary.message_count,
        "sim_run_count": summary.sim_run_count,
        "narrative": summary.narrative,
        "recent_turns": [
            {"role": t.role, "content": t.content, "timestamp": t.timestamp}
            for t in summary.conversation[-_REPORT_MAX_TURNS:]
        ],
        "workbench_events": [
            {"tool": e.tool, "field": e.field, "value": e.value, "timestamp": e.timestamp}
            for e in summary.workbench_events[-_REPORT_MAX_WB_EVENTS:]
        ],
        "voice_minutes": summary.voice_minutes,
        "has_voice": bool((summary.voice_transcript or "").strip()),
    }


#: Names the analytics-chat SKILL.md's ``tools:`` field references.
#: ``analytics.summarise`` registers itself separately in M4.
ANALYTICS_TOOLS = (
    count_messages,
    time_on_task,
    sim_runs_per_skill,
    most_active_groups,
    group_summary,
    group_report,
)


__all__ = [
    "ANALYTICS_TOOLS",
    "count_messages",
    "group_report",
    "group_summary",
    "most_active_groups",
    "sim_runs_per_skill",
    "time_on_task",
]
