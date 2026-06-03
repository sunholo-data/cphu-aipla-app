"""Proactive sim-reactive guidance for the agent's system prompt.

Phase B of the proactive-tutor design (see
``docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md``).
When a skill opts in via ``SkillConfig.proactive_event_reactive=True``
and supplies a ``reactive_template``, that template is appended to the
agent's instruction as a clearly-delimited "REACTIVE GUIDANCE" block so
the tutor produces a short observation-and-question turn when invoked
via the synthetic ``[event_reactive:<kind>]`` sentinel the frontend
posts after a meaningful workbench commit (sim run, step advance,
measurement commit).

The block mirrors the framing of ``inject_opening_guidance`` (Phase A):
a leading prose line tells the model the contents are system-supplied
reactive guidance (not user instructions), then the template body
itself, then a trailing prose line explaining when to act on it. The
two blocks compose cleanly when both flags are on — Phase A's opening
block lands first (so the model sees opening expectations first), then
this block.

Architecture: Path B per the design doc's mid-sprint architectural
decision (2026-06-03). Backend owns only the gate decision
(/proactive-event-check); the frontend kicks off the actual AG-UI run
with the sentinel so the proactive turn rides the established protocol
stack — same SSE stream, same Firestore mirror as any user-driven turn.
The sentinel is what tells the agent to apply this guidance.

Phase A's ``inject_opening_guidance`` is a candidate for the same
Path-B refactor — see
``docs/design/aipla/v1.1.0-feedback/proactive-greet-refactor-to-path-b.md``
(filed by sprint M10 as a follow-up).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

_BLOCK_TEMPLATE = """
============================================================
REACTIVE GUIDANCE (system context, not student input).

The student has just committed a meaningful action in the workbench
(pressed Play on a sim, advanced a procedure step, recorded a
measurement, or similar). You are speaking first — they have not
sent a chat message about it.

If the most recent user message is the literal sentinel
``[event_reactive:<kind>]`` (or similar bracketed marker — ``<kind>``
will be the event type, e.g. ``sim_run``, ``step_advance``,
``measurement_commit``), treat it as a system signal that the student
just acted in the workbench — do NOT echo it, reply to it literally,
or ask what they meant. Just produce the reactive turn described below.

Use the guidance below to shape that turn:

{template}

Once you have produced your reactive turn, ignore this guidance on
subsequent turns — the student will lead the conversation from here
unless another meaningful event fires.
============================================================
""".strip()


def inject_reactive_guidance(
    instructions: str,
    *,
    proactive_event_reactive: bool,
    reactive_template: str | None,
) -> str:
    """Return ``instructions`` with the reactive-guidance block appended
    when both conditions are met; otherwise return ``instructions``
    unchanged.

    The wrapper is a pure string transform — exposed for testability
    without spinning up an ADK runtime. It runs at agent build time
    (see ``adk/agent.py:create_agent``) AFTER ``inject_opening_guidance``
    so when both flags are on the model sees the opening block first.
    """
    if not proactive_event_reactive:
        return instructions
    if not reactive_template or not reactive_template.strip():
        log.debug("inject_reactive_guidance: proactive_event_reactive=True but reactive_template empty — no-op")
        return instructions

    log.info(
        "inject_reactive_guidance: appending reactive block (%d chars)",
        len(reactive_template),
    )
    block = _BLOCK_TEMPLATE.format(template=reactive_template.strip())
    return f"{instructions.rstrip()}\n\n{block}"


__all__ = ["inject_reactive_guidance"]
