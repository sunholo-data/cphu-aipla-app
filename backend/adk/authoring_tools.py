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
from db.models.activity_config import ELEMENT_REGISTRY

logger = logging.getLogger(__name__)

# Matches ActivityUpsert.teaching_goal (activity_routes.py) so an Applied
# proposal never 422s on length.
MAX_GOAL_LEN = 2000

# Palette element kinds the co-pilot can assemble today (COPILOT-2 M1). The
# checklist is the framework's formative-checkpoint instance (1.1.50); table /
# chart / calculator carry richer specs and are a follow-on.
_SUPPORTED_ELEMENT_KINDS = {"checklist"}
# Cap from the registry (1.1.38) so an Applied checklist never exceeds the bound.
MAX_CHECKLIST_ITEMS = ELEMENT_REGISTRY["checklist"].max_items

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


def add_element(
    element_kind: str,
    items: list[str],
    activity_id: str,
    tool_context: ToolContext = None,
) -> dict[str, Any]:
    """Propose adding a workspace element to an activity (COPILOT-2 M1).

    Owner-scoped + propose-only: returns a proposal the teacher Applies; never
    persists. The kind is validated against the 1.1.38 ``ELEMENT_REGISTRY``.

    Args:
        element_kind: the palette element kind (currently ``checklist``).
        items: for a checklist, the step labels (blanks dropped, capped, trimmed).
        activity_id: the activity being authored (the teacher owns it).

    Returns:
        ``{"ok": True, "proposal": {"kind": "add_element", "element_kind": ...,
        "spec": {...}, "label": ...}}`` or ``{"ok": False, "error": ...}``.
    """
    uid = _caller_uid(tool_context)
    if not uid:
        return dict(_DENY)

    # Input validation first — activity-independent, so no enumeration risk.
    if element_kind not in ELEMENT_REGISTRY:
        return {"ok": False, "error": f"unknown element kind {element_kind!r}"}
    if element_kind not in _SUPPORTED_ELEMENT_KINDS:
        return {"ok": False, "error": f"the co-pilot can't assemble a {element_kind!r} element yet"}

    clean = [s.strip() for s in (items or []) if isinstance(s, str) and s.strip()]
    if not clean:
        return {"ok": False, "error": "the checklist has no steps"}
    clean = clean[:MAX_CHECKLIST_ITEMS]

    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != uid:
        return dict(_DENY)

    logger.info(
        "authoring: add_element(%s, %d items) proposal for activity=%s by uid=%s",
        element_kind,
        len(clean),
        activity_id,
        uid,
    )
    return {
        "ok": True,
        "proposal": {
            "kind": "add_element",
            "element_kind": element_kind,
            "spec": {"items": clean},
            "label": f"Tjekliste ({len(clean)} trin)",
        },
    }
