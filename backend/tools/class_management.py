"""ADK ``FunctionTool`` wrappers for the ``manage-class`` teacher skill.

Active class management from chat — the conversational twin of the React
``/teacher/classes`` dashboard. Each wrapper follows the analytics-chat
pattern (see :mod:`analytics.tools`):

1. Resolve the caller's uid via :func:`analytics.auth.caller_uid` — the
   same identity path analytics-chat uses (``_invocation_context.user_id``
   in the chat stream, ``state['user:id']`` for the CLI/probe path).
2. For anything scoped to an existing class, gate on ownership with
   :func:`analytics.auth.assert_caller_owns` — the byte-identical "class not
   accessible" refusal for both missing and not-owned classes.

WRITES are **propose-only** (``create_class``, ``mint_group_codes``): they
return ``{"ok", "proposal": {...}}`` and persist NOTHING. The teacher Applies
the proposal in the co-pilot, and the Apply does the real write via the same
REST endpoints the dashboard uses. This is the co-working / earned-trust model
(the AI drafts, the human commits) — see
docs/design/aipla/v1.1.0-feedback/teacher-coworking-copilot.md. Propose tools
return a soft ``{"ok": False, "error"}`` rather than raise, so a hallucinated
arg doesn't abort the turn.

READS are direct (``list_my_classes``, ``list_activities``, ``class_spend``,
``class_kpis``, ``class_trend``): they call the :mod:`db.classes` /
:mod:`insights` / :mod:`analytics` business logic and answer in chat. Engagement
Q&A is delegated to ``analytics-chat`` via ``agentTools``.

Deliberately NOT exposed as tools (destructive — dashboard-only, behind
the explicit confirmation flow): ``revoke_class`` and
``revoke_group_code``. Revoking a class or code live-kills students'
active sessions at the next token verify, so it stays a deliberate click,
not a model-issued action. The skill prompt hands those off to the
dashboard.

Registered into ``backend/adk/tools.py::TOOL_REGISTRY`` so the
``manage-class`` SKILL.md ``tools:`` frontmatter can name them.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from google.adk.tools import ToolContext

from analytics import cost_queries
from analytics.auth import assert_caller_owns, caller_uid, caller_uid_or_none
from auth.firebase_auth import User
from db import activities as activities_db
from db import classes as classes_db
from db.models.activity import Activity
from db.models.class_ import Class
from insights import aggregates

logger = logging.getLogger(__name__)

#: Mirror the ``GroupsMint`` bound in ``protocols/classes_routes.py`` (1..50).
_MAX_CODES_PER_CALL = 50

#: Valid spend windows (mirrors ``analytics.cost_queries.Period``).
_SPEND_PERIODS = ("this_month", "last_month", "all_time")

#: Default look-back for the KPI / trend tools when the model omits a window.
_DEFAULT_WINDOW_DAYS = 30


def _parse_dt(value: str | None, default: datetime) -> datetime:
    """Parse an ISO timestamp the model passed; fall back to ``default``."""
    if value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("manage_class: bad timestamp %r, using default", value)
    return default


def _class_brief(cls: Class) -> dict[str, Any]:
    """Compact, PII-free view of a class for the model. No owner uid."""
    return {
        "class_id": cls.class_id,
        "name": cls.name,
        "description": cls.description,
        "group_codes": list(cls.group_codes),
        "num_group_codes": len(cls.group_codes),
        "num_activities": len(cls.activity_ids),
    }


async def list_my_classes(tool_context: ToolContext = None) -> dict[str, Any]:
    """List the classes owned by the signed-in teacher.

    Returns each class's id + name + description + the group codes minted
    for it, so you can answer "which classes do I have" and look up a
    class id before minting codes for it.

    Returns:
        ``{"classes": [{"class_id", "name", "description", "group_codes",
        "num_group_codes", "num_activities"}, ...]}``. Empty list when the
        teacher has no (non-revoked) classes.
    """
    uid = caller_uid(tool_context)
    classes = await asyncio.to_thread(classes_db.list_classes_for_owner, uid)
    return {"classes": [_class_brief(c) for c in classes]}


def _activity_brief(a: Activity) -> dict[str, Any]:
    """Compact metadata view of a library activity for the model."""
    return {
        "activity_id": a.activity_id,
        "title": a.title,
        "skill_id": a.skill_id,
        "workbench_type": a.workbench_type,
        "artefact_id": a.artefact_id,
        "visibility": a.visibility,
        "language": a.language,
        "difficulty": a.difficulty,
    }


async def list_activities(tool_context: ToolContext = None) -> dict[str, Any]:
    """List the activities in the signed-in teacher's library.

    Activities are the class-independent lessons a teacher builds and then
    assigns to classes. This returns their metadata (not full content), so
    you can answer "what activities do I have", "which are still drafts",
    or look up an activity's running skill / hosted sim.

    Returns:
        ``{"activities": [{"activity_id", "title", "skill_id",
        "workbench_type", "artefact_id", "visibility", "language",
        "difficulty"}, ...]}``. Excludes deleted activities. Empty list
        when the teacher has built none.
    """
    uid = caller_uid(tool_context)
    rows = await asyncio.to_thread(activities_db.list_activities_by_owner, uid)
    return {"activities": [_activity_brief(a) for a in rows]}


async def create_class(
    name: str,
    description: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """PROPOSE creating a new class — does NOT persist.

    Propose-only (earned trust): returns an editable proposal the teacher Applies
    in the co-pilot; the Apply does the real write via ``POST /api/classes``. The
    AI never creates a class on its own. Tell the teacher you've *proposed* it,
    not that it's done.

    Args:
        name: The proposed class name, e.g. "Fysik 9A vår 2026". Required.
        description: Optional one-line description (topic / year level).

    Returns:
        ``{"ok": True, "proposal": {"kind": "create_class", "name",
        "description"}}`` on success, or ``{"ok": False, "error": ...}``.
    """
    uid = caller_uid_or_none(tool_context)
    if not uid:
        return {"ok": False, "error": "not signed in"}
    clean = (name or "").strip()
    if not clean:
        return {"ok": False, "error": "a class name is required"}
    return {
        "ok": True,
        "proposal": {
            "kind": "create_class",
            "name": clean,
            "description": (description.strip() if description else None),
        },
    }


async def mint_group_codes(
    class_id: str,
    count: int = 1,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """PROPOSE minting join-codes for one of the teacher's classes — does NOT
    persist.

    Propose-only (earned trust): returns a proposal the teacher Applies; the
    Apply does the real mint via ``POST /api/classes/{id}/groups``. Validates
    ownership before proposing (byte-identical "class not accessible" for a
    missing or not-owned class). Tell the teacher you've *proposed* it.

    Args:
        class_id: The class to mint codes for. Must be owned by the signed-in
            teacher (use ``list_my_classes`` to find the id).
        count: How many codes to mint. Clamped to 1-50. Default 1.

    Returns:
        ``{"ok": True, "proposal": {"kind": "mint_codes", "class_id",
        "class_name", "count"}}`` or ``{"ok": False, "error": ...}``.
    """
    uid = caller_uid_or_none(tool_context)
    if not uid:
        return {"ok": False, "error": "not signed in"}
    # Soft ownership gate (propose tools return an error dict rather than raise,
    # so a hallucinated class id doesn't abort the turn). Same refusal text for
    # missing + not-owned — no enumeration. (Reads keep assert_caller_owns.)
    cls = await asyncio.to_thread(classes_db.get_class, class_id)
    if cls is None or cls.owner_uid != uid:
        return {"ok": False, "error": "class not accessible"}
    bounded = max(1, min(int(count), _MAX_CODES_PER_CALL))
    return {
        "ok": True,
        "proposal": {
            "kind": "mint_codes",
            "class_id": class_id,
            "class_name": cls.name,
            "count": bounded,
        },
    }


async def class_spend(
    class_id: str,
    period: str = "this_month",
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Model + voice cost (in EUR) for one of the teacher's own classes.

    Args:
        class_id: The class to price. Must be owned by the signed-in
            teacher (use ``list_my_classes`` to find the id).
        period: "this_month" (default), "last_month", or "all_time".

    Returns:
        ``{"total_eur", "by_activity", "by_group", "by_model", "voice_eur",
        "by_voice_kind", "projected_eur", "period", "class_id", ...}``.
        ``projected_eur`` is a month-end estimate, set only for
        "this_month".
    """
    uid = caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    window = period if period in _SPEND_PERIODS else "this_month"
    return await asyncio.to_thread(cost_queries.class_spend, class_id, window)


def _window(since: str | None, until: str | None) -> tuple[datetime, datetime]:
    """Resolve a (since, until) datetime window from optional ISO strings,
    defaulting to the last :data:`_DEFAULT_WINDOW_DAYS` days."""
    until_dt = _parse_dt(until, datetime.now(UTC))
    since_dt = _parse_dt(since, until_dt - timedelta(days=_DEFAULT_WINDOW_DAYS))
    return since_dt, until_dt


async def class_kpis(
    class_id: str,
    since: str | None = None,
    until: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Six headline KPIs for one of the teacher's classes over a window.

    The cards: active groups, total messages, active activities, sim runs,
    average time-on-task, and last activity. A compact snapshot — for
    flexible follow-up questions, use the ``analytics_chat`` tool instead.

    Args:
        class_id: The class. Must be owned by the signed-in teacher.
        since: ISO timestamp (UTC). Defaults to 30 days ago.
        until: ISO timestamp (UTC). Defaults to now.

    Returns:
        The six KPI values plus a ``_debug`` block of the underlying
        queries.
    """
    uid = caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    since_dt, until_dt = _window(since, until)
    user = User(uid=uid, is_teacher=True)
    return await asyncio.to_thread(aggregates.class_kpis, user=user, class_id=class_id, since=since_dt, until=until_dt)


async def class_trend(
    class_id: str,
    since: str | None = None,
    until: str | None = None,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Per-day message counts for one of the teacher's classes (dense
    series — every day in the window is present, even if zero).

    Args:
        class_id: The class. Must be owned by the signed-in teacher.
        since: ISO timestamp (UTC). Defaults to 30 days ago.
        until: ISO timestamp (UTC). Defaults to now.

    Returns:
        A dense per-day series of message counts over the window.
    """
    uid = caller_uid(tool_context)
    assert_caller_owns(uid, class_id)
    since_dt, until_dt = _window(since, until)
    user = User(uid=uid, is_teacher=True)
    return await asyncio.to_thread(aggregates.class_trend, user=user, class_id=class_id, since=since_dt, until=until_dt)


#: Names the manage-class SKILL.md's ``tools:`` field references.
MANAGE_CLASS_TOOLS = (
    list_my_classes,
    create_class,
    mint_group_codes,
    list_activities,
    class_spend,
    class_kpis,
    class_trend,
)

__all__ = [
    "MANAGE_CLASS_TOOLS",
    "class_kpis",
    "class_spend",
    "class_trend",
    "create_class",
    "list_activities",
    "list_my_classes",
    "mint_group_codes",
]
