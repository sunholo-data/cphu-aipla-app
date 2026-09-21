"""A check-in is not an answer (2026-09-21).

Prod, 2026-08-21, group ``still-valley-05``: the tutor asked what frequency
counts per second. The student waited nineteen minutes and wrote *"Er du gået
i stå?"* — "have you stalled?". The tutor replied *"du ramte den lige i plet:
frekvens måles i hertz"* and ticked the checklist step, for an answer that was
never given. That tick is what the teacher's report shows as demonstrated.

The behavioural half lives in ``tests/eval/test_non_answer_guard_smoke.py``
(slow, calls the model). This file is the fast guarantee that the instruction
survives SKILL.md parsing into every student-facing tutor, and that the
checklist tool's own docstring — the instruction the model reads when it
decides to mark — carries the same rule.

Fast (<100ms) — no LLM calls, runs under ``make test-fast``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from admin.platform_seed import _parse_template

TEMPLATES_DIR = Path(__file__).resolve().parents[3] / "skills" / "templates"

STUDENT_TUTORS = (
    "concept-dialogue",
    "problem-set-hints",
    "led-planck-tutor",
    "kinebot-kinematics-tutor",
)


def _instructions(skill_name: str) -> str:
    return _parse_template(TEMPLATES_DIR / skill_name / "SKILL.md")["instructions"]


@pytest.mark.parametrize("skill_name", STUDENT_TUTORS)
def test_every_student_tutor_is_told_a_check_in_is_not_an_answer(skill_name: str) -> None:
    body = _instructions(skill_name)
    assert "er du gået i stå?" in body, f"{skill_name}: the check-in example is missing"
    # Whitespace-normalised: the long form wraps at 72 columns in SKILL.md.
    flat = " ".join(body.split())
    assert "never mark a checklist step on it" in flat, f"{skill_name}: the checklist half is missing"
    # The rule has to say what to do INSTEAD, or the model has only a prohibition.
    assert "ask your" in flat and "question again" in flat, f"{skill_name}: no instruction for what to do instead"


def test_the_checklist_tool_carries_the_rule_where_the_model_reads_it() -> None:
    """The tool docstring IS the tool's instruction to the model. The SKILL.md
    rule is read once at the top of the prompt; this one is read at the moment
    of marking."""
    from adk import checklist_tools

    src = Path(checklist_tools.__file__).read_text(encoding="utf-8")
    start = src.index("def mark_checklist_item(")
    doc = src[start : src.index('"""', src.index('"""', start) + 3)]
    assert "er du gået i stå?" in doc
    assert "never evidence" in doc
