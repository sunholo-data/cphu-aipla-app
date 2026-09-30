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

# The event kinds this guidance describes — the ``<kind>`` in the
# ``[event_reactive:<kind>]`` sentinel. It MUST equal the gate's allowlist,
# ``protocols/proactive_routes.py:MEANINGFUL_EVENT_KINDS``, and the frontend's
# ``MEANINGFUL_EVENT_KINDS`` in ``frontend/src/lib/proactiveEventCheck.ts``: a
# kind missing from the gate never fires, and a kind missing here fires a turn
# the tutor has no instructions for. ``test_proactive_reactive.py`` holds the
# two backend sets together.
#
# ``completion`` (1.1.140 M0): the student finished a mission or a question
# set. Before it existed a sim emitting ``<id>.complete`` was inert.
REACTIVE_EVENT_KINDS: frozenset[str] = frozenset(
    {
        "sim_run",
        "step_advance",
        "measurement_commit",
        "completion",
    }
)

_BLOCK_TEMPLATE = """
============================================================
REACTIVE GUIDANCE (system context, not student input).

The student has just committed a meaningful action in the workbench
(pressed Play on a sim, advanced a procedure step, recorded a
measurement, or similar). You are speaking first — they have not
sent a chat message about it.

If the most recent user message is the literal sentinel
``[event_reactive:<kind>]`` (or similar bracketed marker — ``<kind>``
will be the event type: ``sim_run``, ``step_advance``,
``measurement_commit`` or ``completion``), treat it as a system signal
that the student just acted in the workbench — do NOT echo it, reply to
it literally, or ask what they meant. Just produce the reactive turn
described below.

If ``<kind>`` is ``completion``, the student has FINISHED something — a
mission, a question set, a task the sim tracks. That turn has its own
shape, which takes precedence over the activity guidance below for this
one turn:
- Acknowledge specifically WHAT they completed, from the sim state you
  were sent (the mission, the question set, the score or answers it
  reports). Name what they got right; no stock praise, and never praise
  a wrong answer.
- Then ask ONE reflection or transfer question: what they would now
  predict in a new case, or how the result connects to the idea behind
  it. One question, not a list.
- STOP CONDITION: if the sim state says the student has reached its top
  tier or final level (a ``tier`` or ``level`` at its maximum, or a flag
  saying everything is done), ask nothing further. Consolidate instead:
  a short summary of what they have shown they can do, and end there.
Reply in the language of the session, whatever language this guidance
is written in.

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


__all__ = ["REACTIVE_EVENT_KINDS", "inject_reactive_guidance"]
