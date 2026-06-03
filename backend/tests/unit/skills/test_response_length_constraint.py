"""Unit tests for the tutor response-length constraint (sprint QUICK-WINS-V11).

Asserts the "Response length" block (<=3 sentences + end-with-question)
is present in the resolved system prompt for each tutor skill, and absent
from non-tutor skills like manage-class and analytics-chat (guards against
accidental leakage from a shared-preamble refactor).

Fast (<100ms) — no LLM calls, runs under ``make test-fast``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from admin.platform_seed import _parse_template

TEMPLATES_DIR = Path(__file__).resolve().parents[3] / "skills" / "templates"

TUTOR_SKILLS = (
    "problem-set-hints",
    "led-planck-tutor",
    "kinebot-kinematics-tutor",
)

NON_TUTOR_SKILLS = (
    "manage-class",
    "analytics-chat",
)


def _load_instructions(skill_name: str) -> str:
    skill_md = TEMPLATES_DIR / skill_name / "SKILL.md"
    assert skill_md.exists(), f"Expected skill template at {skill_md}"
    parsed = _parse_template(skill_md)
    return parsed["instructions"]


@pytest.mark.parametrize("skill_name", TUTOR_SKILLS)
def test_tutor_skill_carries_response_length_constraint(skill_name: str) -> None:
    """Each tutor skill's resolved system prompt must contain both the
    sentence-cap substring and the end-with-question substring."""
    body = _load_instructions(skill_name)
    assert "Maximum 3 sentences" in body, (
        f"{skill_name} SKILL.md missing 'Maximum 3 sentences' constraint — "
        "tutor will revert to multi-paragraph explanations"
    )
    assert "end with a question" in body, (
        f"{skill_name} SKILL.md missing 'end with a question' constraint — "
        "tutor responses won't reliably invite student action"
    )


@pytest.mark.parametrize("skill_name", NON_TUTOR_SKILLS)
def test_non_tutor_skill_does_not_carry_response_length_constraint(skill_name: str) -> None:
    """Negative case: skills outside the tutor set must NOT carry the
    constraint. Guards against an accidental shared-preamble refactor
    that leaks the cap into management/analytics surfaces where longer
    structured responses are appropriate."""
    body = _load_instructions(skill_name)
    assert "Maximum 3 sentences" not in body, (
        f"{skill_name} unexpectedly carries 'Maximum 3 sentences' — the constraint is tutor-only by design"
    )
