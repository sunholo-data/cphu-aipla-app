"""Unit tests for adk.proactive_reactive — REACTIVE GUIDANCE injection
(sprint PROACTIVE-SIM-REACTIVE M3).

Mirrors test_proactive_greet.py's shape exactly so the two Phase A /
Phase B injectors are tested with the same contract: pure string
transform, no-op when flag off or template empty, frames the appended
content as system context (not student input), preserves the base
instruction prefix without doubling newlines.
"""

from __future__ import annotations

import pytest

from adk.proactive_greet import inject_opening_guidance
from adk.proactive_reactive import inject_reactive_guidance

BASE = "You are a friendly Socratic tutor for projectile motion."


def test_proactive_event_reactive_false_is_a_noop():
    assert inject_reactive_guidance(BASE, proactive_event_reactive=False, reactive_template="anything") == BASE


def test_empty_reactive_template_is_a_noop():
    assert inject_reactive_guidance(BASE, proactive_event_reactive=True, reactive_template=None) == BASE
    assert inject_reactive_guidance(BASE, proactive_event_reactive=True, reactive_template="   ") == BASE


def test_appends_reactive_block_when_both_set():
    reactive = "Acknowledge what the student just tried. Ask one short question that invites a prediction."
    out = inject_reactive_guidance(BASE, proactive_event_reactive=True, reactive_template=reactive)
    assert out != BASE
    assert BASE in out
    assert reactive in out
    assert "REACTIVE GUIDANCE" in out
    assert "subsequent turns" in out.lower()


def test_appends_after_existing_instructions_without_doubling_newlines():
    out = inject_reactive_guidance(
        BASE,
        proactive_event_reactive=True,
        reactive_template="A short reactive turn.",
    )
    assert out.count("\n\n\n") == 0
    assert out.index(BASE) < out.index("REACTIVE GUIDANCE")


def test_reactive_template_with_leading_trailing_whitespace_is_trimmed():
    out = inject_reactive_guidance(
        BASE,
        proactive_event_reactive=True,
        reactive_template="   \n\n  Observe and ask.  \n  ",
    )
    assert "Observe and ask." in out
    assert "\n   Observe" not in out


def test_block_explains_the_event_reactive_sentinel():
    """The injected block must tell the model that the sentinel
    ``[event_reactive:<kind>]`` is a system signal, NOT student input.
    Without this, the model would echo the sentinel back to the student
    as a literal user message (the Phase A bug pattern the sentinel
    framing was designed to prevent — see proactive_greet.py)."""
    out = inject_reactive_guidance(
        BASE,
        proactive_event_reactive=True,
        reactive_template="Stay short.",
    )
    assert "[event_reactive:<kind>]" in out
    # The guidance must explicitly warn against echoing the sentinel —
    # this is what prevents the chat from rendering "[event_reactive:sim_run]"
    # as a literal tutor response.
    assert "do NOT echo it" in out


def test_composes_cleanly_with_phase_a_opening_guidance():
    """When both Phase A and Phase B inject, the agent-build chain in
    adk/agent.py calls inject_opening_guidance first then wraps with
    inject_reactive_guidance. This test mirrors that order and confirms:
      - both blocks present in the final instruction
      - opening block lands BEFORE reactive block (model sees opening
        expectations first when both flags are on)
      - base instruction prefix preserved
    """
    out = inject_reactive_guidance(
        inject_opening_guidance(
            BASE,
            proactive_greet=True,
            opening_template="Greet warmly.",
        ),
        proactive_event_reactive=True,
        reactive_template="React briefly.",
    )
    assert BASE in out
    assert "OPENING GUIDANCE" in out
    assert "REACTIVE GUIDANCE" in out
    assert out.index("OPENING GUIDANCE") < out.index("REACTIVE GUIDANCE")
    assert "Greet warmly." in out
    assert "React briefly." in out


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
