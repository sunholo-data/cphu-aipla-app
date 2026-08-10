"""Proactive-greet opening guidance for the agent's system prompt.

Phase A of the proactive-tutor design (see
``docs/design/aipla/v1.0.0-pilot/proactive-tutor.md``). When a skill
opts in via ``SkillConfig.proactive_greet=True`` and supplies an
``opening_template``, that template is appended to the agent's
instruction as a clearly-delimited "OPENING GUIDANCE" block so the
tutor produces a meaningful first turn when invoked with the synthetic
empty user message that the ``/greet`` endpoint sends.

The block is intentionally framed the same way ``iframe_context`` and
``a2ui_surface_context`` frame their blocks: a leading prose line tells
the model the contents are system-supplied opening guidance (not user
instructions), then the template body itself, then a trailing prose
line explaining when to act on it.

Phase B (idle heartbeat) will reuse this pattern with a parallel
``inject_idle_nudge_guidance`` wrapper. Both kinds of proactive turn
should be distinguishable via OTel ``tutor.proactive_kind`` span tags.
"""

from __future__ import annotations

import logging

from adk.prompt_budget import clip, fit_lines
from db.models.activity_config import ELEMENT_REGISTRY, ActivityConfig

log = logging.getLogger(__name__)

_BLOCK_TEMPLATE = """
============================================================
OPENING GUIDANCE (system context, not student input).

The student has just joined this session. They have NOT yet sent
a message. You are speaking first — your reply will be the first
thing they see.

If the most recent user message is the literal sentinel
``[session_start]`` (or similar bracketed marker), treat it as a
system signal that the student just opened the chat — do NOT echo
it, reply to it literally, or ask what they meant. Just produce
the opening turn described below.

Use the guidance below to shape that first turn:

{template}{activity}

Once you have produced your opening turn, ignore this guidance on
subsequent turns — the student will lead the conversation from here.
============================================================
""".strip()

# 1.1.72 — what today's activity actually is.
#
# Aswin, 2026-08-10: *"Jonas always starts with 'Hvilket emne eller fysikbegreb
# har du lyst til, at vi skal undersøge sammen i dag?' even though the lesson is
# about waves. After students start to chat, then he tells students that the
# lesson is about wave."*
#
# The tutor DID know — ``{teacher_focus}`` carries the goal, the manifest and the
# ILOs — but the greet turn is the one turn generated with no conversational
# context, and ``inject_opening_guidance`` took only ``(proactive_greet,
# opening_template)``. The skill-authored template therefore could not mention a
# lesson it had never been told about. This is parameter passing: ``_active_cfg``
# is resolved in the same function, a dozen lines above the call.
#
# Deliberately THIN. The tutor already receives the full goal, the element
# manifest and the ILO list through ``{teacher_focus}``; restating them here
# would spend the same budget twice. This block says what to SAY FIRST.
_ACTIVITY_TEMPLATE = """

Today's activity is not open-ended — the teacher has set it:
{facts}

Open by naming what the activity is about and pointing at the first thing to do.
Do NOT ask the student to choose a topic or ask what they would like to explore:
that invites them to pick something the teacher did not author, which you would
then have to walk back. Two sentences at most, then one specific question."""

# Bounded like every other variable-length contributor. The title is capped at
# 200 by the model and the goal at 2,000; this block only needs enough of the
# goal to name the subject.
OPENING_ACTIVITY_CAP = 700
_GOAL_CLIP = 400


def _activity_facts(cfg: ActivityConfig | None) -> str:
    """The two or three lines the opening turn needs, or ``""``.

    Degradation is the point: no config, or a config with nothing to say, must
    leave the greeting byte-identical to what it was before 1.1.72 — chat-only
    and unconfigured skills are the majority of callers.
    """
    if cfg is None:
        return ""

    lines: list[str] = []
    title = (cfg.title or "").strip()
    if title:
        lines.append(f"- Title: {title}")
    goal = (cfg.teaching_goal or "").strip()
    if goal:
        lines.append(f"- What it is for: {clip(goal, _GOAL_CLIP)}")

    # Point at the first thing on the workbench rather than describing it — the
    # element manifest already carries the full description.
    first = _first_element(cfg)
    if first:
        lines.append(f"- First thing on the workbench: {first}")

    if not lines:
        return ""

    kept, dropped = fit_lines(lines, OPENING_ACTIVITY_CAP)
    if dropped:  # pragma: no cover — three short lines cannot exceed 700 chars
        kept.append("(…)")
    return _ACTIVITY_TEMPLATE.format(facts="\n".join(kept))


def _first_element(cfg: ActivityConfig) -> str:
    """A short pointer at the first thing the student should touch.

    Registry order, so a new element kind is reachable here without a second
    edit — the same inversion ``element_manifest`` made for the same reason.
    """
    for kind, spec in ELEMENT_REGISTRY.items():
        items = getattr(cfg, spec.field, None) or []
        if not items:
            continue
        first = items[0]
        if kind == "checklist":
            return f'the checklist, starting with "{getattr(first, "label", "")}"'
        title = (getattr(first, "title", "") or "").strip()
        return f'the {kind} "{title}"' if title else f"the {kind}"
    return ""


def inject_opening_guidance(
    instructions: str,
    *,
    proactive_greet: bool,
    opening_template: str | None,
    cfg: ActivityConfig | None = None,
) -> str:
    """Return ``instructions`` with the opening-guidance block appended
    when both conditions are met; otherwise return ``instructions``
    unchanged.

    ``cfg`` (1.1.72) is the resolved activity. When supplied and non-empty, the
    block also names the lesson so the first turn a student ever reads is about
    what the teacher actually set. Defaults to ``None`` so every existing caller
    — and every skill with no saved activity — composes exactly as before.

    The wrapper is a pure string transform — exposed for testability
    without spinning up an ADK runtime. It runs at agent build time
    (see ``adk/agent.py:create_agent``), before the
    ``compose_instruction_providers`` chain wraps the result for
    runtime ``InstructionProvider`` resolution.

    **Language.** Nothing here states one. The activity's language directive is
    the first block of ``compose_teacher_focus`` and is substituted into the
    SKILL.md body, i.e. positionally BEFORE this block, so an English activity
    opens in English without a second, duplicated instruction that could
    contradict it. See ``test_the_language_directive_precedes_the_opening``.
    """
    if not proactive_greet:
        return instructions
    if not opening_template or not opening_template.strip():
        log.debug("inject_opening_guidance: proactive_greet=True but opening_template empty — no-op")
        return instructions

    activity = _activity_facts(cfg)
    log.info(
        "inject_opening_guidance: appending opening block (%d chars, activity=%s)",
        len(opening_template) + len(activity),
        (cfg.activity_id if cfg else None) or "-",
    )
    block = _BLOCK_TEMPLATE.format(template=opening_template.strip(), activity=activity)
    return f"{instructions.rstrip()}\n\n{block}"


__all__ = ["OPENING_ACTIVITY_CAP", "inject_opening_guidance"]
