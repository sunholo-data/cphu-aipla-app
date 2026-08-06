"""Chat-native checklist (ILO) tools (1.1.62 M3).

Built PER SESSION at agent-build time, exactly like ``adk/checkpoint_tools.py``:
the closures capture the session's resolved ``ActivityConfig`` and the VERIFIED
student identity, so the model can never name another group or activity —
``group_id`` is not a tool parameter and must never become one.

**What these are for.** Aswin, 2026-08-06: *"How can I activate the automatic
ILOs check in the workbench?"*, and in his follow-up the confirmation that the
ILOs **are** the workspace checklist. There was no feature to activate: the
checklist was missing from the tutor's prompt (fixed in M2) and nothing could
tick an item.

**The AI helps auto-grade** (M, 2026-08-06). ``ProgressChecklist`` previously
carried the principle "student-driven, not auto-graded — the agent does NOT
decide what's done". That is superseded, following Aswin's ask. What survives is
the student's override: every AI tick is recorded with ``by="ai"`` plus one
sentence of evidence, rendered to the student in a trust card, and a student
disagreeing flips the entry to ``by="student"``. The tutor helps; it does not
adjudicate.

Delivery is chat-native, the same principle as the concept-map checkpoints: the
tutor judges from the conversation it is already having, in its own voice. The
checklist element stays a student-facing surface, never a quiz form.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import FunctionTool

from auth.firebase_auth import User
from db.checklist_progress import get_item_states, record_item_state
from db.models.activity_config import ActivityConfig

logger = logging.getLogger(__name__)


def build_checklist_tools(cfg: ActivityConfig | None, user: User) -> list[FunctionTool]:
    """The session's checklist tools — empty when they don't apply.

    Attached only when the activity carries a checklist AND the caller is an
    anonymous-group student (``user.group_id``). A teacher previewing an
    activity gets none: there is no group to record against, and the only way to
    supply one would be a tool parameter.
    """
    if cfg is None or not cfg.checklist or not user.group_id:
        return []

    items = list(cfg.checklist)
    group_id = user.group_id
    activity_id = cfg.activity_id

    def _item_list() -> list[dict[str, str]]:
        return [{"id": i.id, "label": i.label} for i in items]

    def list_checklist() -> dict[str, Any]:
        """List this activity's checklist steps and which are already done.

        The checklist is the teacher's intended learning outcomes for the
        activity. Call this when you need to know what is still outstanding —
        for example before suggesting what to do next, or at a wrap-up.

        Returns:
            Each step with its id, label, whether it is done, and who marked it.
        """
        states = get_item_states(group_id, activity_id)
        return {
            "ok": True,
            "items": [
                {
                    "id": i.id,
                    "label": i.label,
                    "done": bool(states.get(i.id, {}).get("done")),
                    "by": states.get(i.id, {}).get("by"),
                }
                for i in items
            ],
        }

    def mark_checklist_item(item_id: str, done: bool, evidence_summary: str) -> dict[str, Any]:
        """Mark one checklist step done (or not) from what the student has shown.

        Use this when the conversation gives you real evidence that a step is
        finished — the student described the measurement they took, or worked
        through the calculation. Do NOT tick a step just because the student
        says "done"; tick it when you have seen the substance.

        The student sees every mark you make, with your reason, and can undo it.
        Say in the conversation what you have marked and why — a step that
        silently changes state is worse than one you mention.

        Args:
            item_id: the step to mark (see the checklist in your context).
            done: True when the student has demonstrated the step.
            evidence_summary: one concrete sentence about what they showed,
                e.g. "målte faldtiden tre gange og fik 0,45 s i gennemsnit".
                Required — a mark with no reason is refused.

        Returns:
            The updated state of every step.
        """
        item = next((i for i in items if i.id == item_id), None)
        if item is None:
            return {"ok": False, "error": f"unknown checklist item {item_id!r}", "items": _item_list()}

        evidence = (evidence_summary or "").strip()
        if not evidence:
            # Refused rather than defaulted: the student is entitled to know why
            # the AI thinks they did something, and the trust card has nothing
            # to render without it.
            return {
                "ok": False,
                "error": "evidence_summary is required — say in one sentence what the student showed",
                "items": _item_list(),
            }

        states = record_item_state(
            group_id,
            activity_id,
            item_id,
            done=done,
            by="ai",
            evidence_summary=evidence,
        )
        logger.info(
            "checklist: %s -> done=%s for group=%s activity=%s",
            item_id,
            done,
            group_id,
            activity_id,
        )
        return {
            "ok": True,
            "item": {"id": item.id, "label": item.label},
            "done": done,
            # Echoed for the chat trust card — the student sees WHY.
            "evidence": evidence[:500],
            "itemStates": states,
        }

    return [FunctionTool(list_checklist), FunctionTool(mark_checklist_item)]


def checklist_state_summary(cfg: ActivityConfig | None, user: User) -> str:
    """A compact per-session status line for the tutor's context — which steps
    this group has already done. Empty when there is nothing to say.

    Statuses are deliberately NOT baked into the composed instruction (which is
    built once per session and would go stale); this is read at agent-build time
    and the tools return fresh state on every call.
    """
    if cfg is None or not cfg.checklist or not user.group_id:
        return ""
    states = get_item_states(user.group_id, cfg.activity_id)
    done = [item_id for item_id, s in sorted(states.items()) if s.get("done")]
    if not done:
        return ""
    return "Checklist steps this group has already completed: " + ", ".join(done)


__all__ = ["build_checklist_tools", "checklist_state_summary"]
