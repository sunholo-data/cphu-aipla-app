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

from google.adk.tools import FunctionTool, ToolContext

from adk.element_state import find_empty_element_for_step, refusal_for
from adk.prompt_budget import clip, fit_lines, short_date
from auth.firebase_auth import User
from db.checklist_progress import get_item_states, record_item_state
from db.models.activity_config import ActivityConfig

logger = logging.getLogger(__name__)

# The inherited-progress block's share of the per-turn prompt budget. 50 items
# x (200-char label + 500-char evidence) is 35,000 characters unbounded, which
# is four times the whole focus cap — this is the largest single variable-length
# contributor PILOT-1 adds. See test_inherited_progress_block_is_bounded.
INHERITED_PROGRESS_CAP = 1200
# Evidence sentences are the reason the block is worth having (the student can
# ask what was marked and why) but a 500-char one is not "one sentence".
_EVIDENCE_CLIP = 140
# Labels are stated in full by the ILO precedence block and the element
# manifest; a 200-char one does not need a third full airing here.
_LABEL_CLIP = 90
# Leave room for the header and the next-step line, both of which must survive
# truncation — a list of marks with no instruction about what to do with them
# is the failure this block exists to fix. The shared contract paragraph lives
# in adk/progress_context.py and is NOT counted against this cap.
_INHERITED_BODY_CAP = 900


def _read_state(tool_context) -> dict:
    """Read an ADK ``ToolContext``'s session state as a plain dict.

    ``dict(tool_context.state)`` looks obviously correct and is not. ADK's
    ``State`` implements ``__getitem__``/``__setitem__``/``__contains__``/
    ``get``/``update``/``setdefault``/``to_dict`` — but no ``keys()`` and no
    ``__iter__``, so ``dict()`` cannot use the mapping protocol. It falls
    through to the sequence protocol, asks for ``state[0]`` and raises
    ``KeyError: 0`` on every call.

    Because the caller catches broadly and fails open, that raised silently: the
    mark still landed, so nothing looked broken, while the empty-element check
    this function feeds never executed once. It was found in the 2026-08-21
    pilot logs, 14 occurrences, after the feature had shipped.

    A plain dict is still accepted so any non-ADK caller keeps working.
    """
    state = getattr(tool_context, "state", None)
    if state is None:
        return {}
    to_dict = getattr(state, "to_dict", None)
    if callable(to_dict):
        return to_dict()
    return dict(state)


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

    def mark_checklist_item(
        item_id: str,
        done: bool,
        evidence_summary: str,
        tool_context: ToolContext = None,
    ) -> dict[str, Any]:
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

        # 1.1.69 M3 — the docstring above says "tick it when you have seen the
        # substance", and for a step whose substance lives in a data table that
        # instruction was UNFOLLOWABLE: nothing ever showed the model the
        # table's contents. It marked on the student's word, wrote an
        # authoritative-sounding evidence sentence, and that became the
        # assessment data a teacher reads.
        #
        # So the tool now checks what the prompt block reports. Scope is
        # deliberately narrow — only a step CONFIDENTLY associated with an
        # element we can positively see is empty, and only when marking done.
        # Un-marking is never blocked: a tutor correcting itself must always be
        # able to. Everything uncertain falls through and marks as before.
        if done and tool_context is not None:
            try:
                empty = find_empty_element_for_step(cfg, item.label, _read_state(tool_context))
            except Exception:  # pragma: no cover — a check must never break a mark
                logger.exception(
                    "checklist: element-state check FAILED OPEN for item=%s — the mark was allowed "
                    "WITHOUT the empty-element check running",
                    item_id,
                )
                empty = None
            if empty is not None:
                # Axiom 8: a refusal is a counterfactual and therefore invisible
                # unless it is logged. This line is how we find out whether the
                # inference fires at all, and on what.
                logger.info(
                    "checklist: REFUSED mark of %s for group=%s activity=%s — %s %r is empty (%d/%d)",
                    item_id,
                    group_id,
                    activity_id,
                    empty.kind,
                    empty.title,
                    empty.filled,
                    empty.total,
                )
                return {"ok": False, "error": refusal_for(empty), "items": _item_list()}

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
    """The group's recorded checklist progress, as ambient context (1.1.70 M1).

    **This function shipped in 1.1.62, was exported, was unit-tested — and was
    never wired into the agent.** So the tutor only ever learned about progress
    by *asking* (``list_checklist``), and what came back was a flat list of
    ticks with no indication of where they came from. Aswin, 2026-08-10: a long
    productive session, the chat history goes away, the student rejoins on the
    same group code, and the tutor finds four of five steps done and wraps up
    after one question. *"Jonas forgot everything, then claimed to remember."*

    Nothing malfunctioned to produce that. ``checklist_progress`` is keyed by
    (group, activity) and never by session — deliberately, because a group works
    across devices and progress that died with a tab would be the worse bug. The
    gap is that inherited progress and progress the tutor just watched happen
    read *identically*.

    **What this block says, and what it deliberately does not.** The draft
    wording in 1.1.70 asserted "you did not witness this work". That assertion
    is only safe if the block is composed once per session — and it is not:
    ``create_agent_with_thinking`` is called from ``process_skill_request`` on
    **every request**, so a build-time block is a per-turn block. Telling the
    tutor it did not witness a mark it made itself two turns ago would be a
    falsehood it can check against its own conversation.

    So the block states the *facts the store actually holds* — who marked each
    step and when — plus the contract, and lets the model do the comparison
    against the conversation it can see. Every behaviour the doc wanted is still
    stated outright: the record is not a memory, continue from the first
    outstanding step, and a mark may be revisited.

    Returns "" when there is nothing recorded, so an activity with no progress
    composes exactly as it did before this was wired.
    """
    if cfg is None or not cfg.checklist or not user.group_id:
        return ""
    states = get_item_states(user.group_id, cfg.activity_id)
    if not states:
        return ""

    done_lines: list[str] = []
    outstanding: list[str] = []
    for item in cfg.checklist:
        s = states.get(item.id) or {}
        if not s.get("done"):
            outstanding.append(item.label)
            continue
        who = "by you (the AI)" if s.get("by") == "ai" else "by the student"
        when = short_date(s.get("updatedAt"))
        evidence = (s.get("evidence") or "").strip()
        line = f'- "{clip(item.label, _LABEL_CLIP)}" — marked {who}{when}'
        if evidence:
            line += f": {clip(evidence, _EVIDENCE_CLIP)}"
        done_lines.append(line)

    if not done_lines:
        return ""

    kept, dropped = fit_lines(done_lines, _INHERITED_BODY_CAP)
    if dropped:
        kept.append(f"(+{dropped} more marked steps)")

    # Naming the next step is checklist-specific and the single most useful
    # sentence in the block: the reported behaviour was a wrap-up after one
    # question, and this is what redirects it.
    next_step = (
        f'Continue from "{clip(outstanding[0], _LABEL_CLIP)}" — the first step that is NOT done.'
        if outstanding
        else "Every step is marked. Before treating the activity as finished, check the student agrees."
    )

    return "## Checklist progress already recorded for this group\n" + "\n".join(kept) + "\n\n" + next_step


__all__ = ["INHERITED_PROGRESS_CAP", "build_checklist_tools", "checklist_state_summary"]
