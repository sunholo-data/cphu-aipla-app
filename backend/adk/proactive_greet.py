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

log = logging.getLogger(__name__)

_BLOCK_TEMPLATE = """
============================================================
OPENING GUIDANCE (system context, not student input).

The student has just joined this session. They have NOT yet sent
a message. You are speaking first — your reply will be the first
thing they see. Use the guidance below to shape that first turn:

{template}

Once you have produced your opening turn, ignore this guidance on
subsequent turns — the student will lead the conversation from here.
============================================================
""".strip()


def inject_opening_guidance(
    instructions: str,
    *,
    proactive_greet: bool,
    opening_template: str | None,
) -> str:
    """Return ``instructions`` with the opening-guidance block appended
    when both conditions are met; otherwise return ``instructions``
    unchanged.

    The wrapper is a pure string transform — exposed for testability
    without spinning up an ADK runtime. It runs at agent build time
    (see ``adk/agent.py:create_agent``), before the
    ``compose_instruction_providers`` chain wraps the result for
    runtime ``InstructionProvider`` resolution.
    """
    if not proactive_greet:
        return instructions
    if not opening_template or not opening_template.strip():
        log.debug("inject_opening_guidance: proactive_greet=True but opening_template empty — no-op")
        return instructions

    log.info(
        "inject_opening_guidance: appending opening block (%d chars)",
        len(opening_template),
    )
    block = _BLOCK_TEMPLATE.format(template=opening_template.strip())
    return f"{instructions.rstrip()}\n\n{block}"


__all__ = ["inject_opening_guidance"]
