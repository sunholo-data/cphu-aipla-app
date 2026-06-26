"""Authoring write-tools for the activity-authoring co-pilot (COPILOT-1 M1;
design 1.1.39 "The agent's tools").

Each tool is owner-scoped and **proposes** — it returns an editable suggestion the
teacher Applies on the frontend; it NEVER persists. The actual write rides the
shipped, owner-checked ``PATCH /api/activities`` when the teacher clicks Apply
(EARNED TRUST: nothing changes without a teacher action). Tools are declarative —
they emit structured field deltas, never code/HTML.

Registered into ``adk/tools.py::TOOL_REGISTRY`` so the
``activity-authoring-assistant`` SKILL.md ``tools:`` frontmatter can name them.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import ToolContext

# save_activity is imported (not called) so tests can guard that the proposal
# path never persists; get_activity is the owner-scoped read.
from db.activities import get_activity, save_activity  # noqa: F401  (save_activity: guard-only)

logger = logging.getLogger(__name__)

# Matches ActivityUpsert.teaching_goal (activity_routes.py) so an Applied
# proposal never 422s on length.
MAX_GOAL_LEN = 2000

# Byte-identical denial for missing AND not-owned, so the tool can't be used to
# enumerate other teachers' activities (mirrors activity_routes._load_for_modify).
_DENY = {"ok": False, "error": "activity not found"}


def _caller_uid(tool_context: ToolContext | None) -> str | None:
    """Resolve the authenticated caller's uid, or None.

    Priority mirrors ``analytics.tools._caller_uid`` (the canonical resolver):
      1. ``tool_context._invocation_context.user_id`` — the ADK-side user_id
         wired by ``build_agui_adk_agent(user_id=...)``; the production path for
         tools invoked during a stream turn.
      2. ``tool_context.state['user:id']`` / ``['user_id']`` — the REST-probe
         shape. (Only checking (2) was the 2026-06-02 analytics-chat bug: nothing
         writes ``state['user:id']`` during a turn, so chat tool-calls denied.)
    Returns None (caller decides the denial) rather than raising."""
    if tool_context is None:
        return None
    inv = getattr(tool_context, "_invocation_context", None)
    candidate = getattr(inv, "user_id", None) if inv else None
    if not isinstance(candidate, str) or not candidate:
        state = getattr(tool_context, "state", None) or {}
        candidate = state.get("user:id") or state.get("user_id")
    return candidate if isinstance(candidate, str) and candidate else None


def set_lesson_prompt(
    text: str,
    activity_id: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose a Socratic lesson prompt (the teaching goal) for an activity.

    Owner-scoped: only proposes for the caller's OWN activity. Returns a proposal
    the teacher Applies on the frontend — it does NOT persist.

    Args:
        text: The proposed Socratic lesson prompt / teaching goal.
        activity_id: The activity being authored (the teacher owns it).

    Returns:
        ``{"ok": True, "proposal": {"field": "teachingGoal", "activityId": ...,
        "value": ...}}`` on success, or ``{"ok": False, "error": ...}`` if the
        caller can't author this activity or the text is empty/too long.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)

    goal = (text or "").strip()
    if not goal:
        return {"ok": False, "error": "the lesson prompt is empty"}
    if len(goal) > MAX_GOAL_LEN:
        return {"ok": False, "error": f"the lesson prompt is too long (max {MAX_GOAL_LEN} characters)"}

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != uid:
        return dict(_DENY)

    logger.info("authoring: set_lesson_prompt proposal for activity=%s by uid=%s", activity_id, uid)
    return {
        "ok": True,
        "proposal": {
            "kind": "set_lesson_prompt",
            "field": "teachingGoal",
            "activityId": activity_id,
            "value": goal,
        },
    }
