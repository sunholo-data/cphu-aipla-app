"""Unit tests for adk.proactive_greet — OPENING GUIDANCE injection."""

from __future__ import annotations

import pytest

from adk.proactive_greet import inject_opening_guidance

BASE = "You are a friendly Socratic tutor for projectile motion."


def test_proactive_greet_false_is_a_noop():
    assert inject_opening_guidance(BASE, proactive_greet=False, opening_template="anything") == BASE


def test_empty_opening_template_is_a_noop():
    assert inject_opening_guidance(BASE, proactive_greet=True, opening_template=None) == BASE
    assert inject_opening_guidance(BASE, proactive_greet=True, opening_template="   ") == BASE


def test_appends_opening_block_when_both_set():
    opening = "Hej! Greet the student and ask them what angle they think gives the longest range."
    out = inject_opening_guidance(BASE, proactive_greet=True, opening_template=opening)
    assert out != BASE
    assert BASE in out
    assert opening in out
    assert "OPENING GUIDANCE" in out
    assert "subsequent turns" in out.lower()


def test_appends_after_existing_instructions_without_doubling_newlines():
    out = inject_opening_guidance(
        BASE,
        proactive_greet=True,
        opening_template="A short opening.",
    )
    assert out.count("\n\n\n") == 0
    assert out.index(BASE) < out.index("OPENING GUIDANCE")


def test_opening_template_with_leading_trailing_whitespace_is_trimmed():
    out = inject_opening_guidance(
        BASE,
        proactive_greet=True,
        opening_template="   \n\n  Greet warmly.  \n  ",
    )
    assert "Greet warmly." in out
    assert "\n   Greet" not in out


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
