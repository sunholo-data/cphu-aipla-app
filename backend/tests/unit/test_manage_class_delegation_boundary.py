"""manage-class must answer class/code questions itself, not delegate them.

M, 17 Aug notes: *"copilot class management for creating codes etc, its
confusing it switches to analytics codes."*

The cause was the delegation rule, which read "For open-ended **or specific**
questions, delegate to analytics_chat". A teacher asking "what codes does 1.g
have" is a specific question, so the model handed class management to the
analytics assistant — even though `list_my_classes` already returns each
class's minted codes and could have answered directly.

This test does not prove the model behaves; only an eval or a real session can
do that. What it does prove is that the INSTRUCTION still says the right thing,
so the boundary cannot be quietly softened back to the wording that caused the
confusion. That is worth guarding on its own: SKILL.md edits are seeded to
Firestore and their effect is invisible until someone drives the co-pilot.
"""

from __future__ import annotations

from pathlib import Path

import pytest

_SKILL = Path(__file__).resolve().parents[2] / "skills" / "templates" / "manage-class" / "SKILL.md"


@pytest.fixture(scope="module")
def instructions() -> str:
    assert _SKILL.is_file(), f"manage-class SKILL.md not found at {_SKILL}"
    return _SKILL.read_text(encoding="utf-8")


def test_code_management_is_explicitly_not_delegated(instructions: str):
    lowered = instructions.lower()
    assert "never delegate" in lowered, (
        "The class/code-management boundary is gone. Without it the model hands "
        '"what codes does 1.g have" to analytics_chat — M reported exactly that.'
    )


def test_the_old_catch_all_wording_has_not_returned(instructions: str):
    assert "open-ended or specific questions, delegate" not in instructions.lower(), (
        "The wording that caused the bug is back. 'Specific' covers almost every "
        "real teacher question, so it routed class management to analytics."
    )


def test_delegation_is_scoped_to_session_content(instructions: str):
    lowered = instructions.lower()
    assert "analytics_chat" in lowered, "the delegation target should still exist"
    assert "session" in lowered and "content" in lowered, (
        "The rule should name what analytics is FOR (session content / student behaviour), not just what it is not."
    )


def test_list_my_classes_is_still_documented_as_returning_codes(instructions: str):
    """The boundary only works because the direct tool can actually answer."""
    assert "group codes minted for each" in instructions, (
        "If list_my_classes stops returning codes, 'answer it directly' becomes "
        "impossible and the delegation rule has to be reconsidered."
    )


def test_instructions_stay_under_the_seed_cap(instructions: str):
    # SkillConfig caps the instructions body at 10,000 chars; crossing it makes
    # platform_seed fail its re-read AFTER a partial write.
    assert len(instructions) < 10_000, (
        f"manage-class SKILL.md is {len(instructions)} chars — over the 10,000 cap. Trim before adding more."
    )
