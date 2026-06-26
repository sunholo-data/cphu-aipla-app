"""Unit tests for the activity-authoring-assistant teacher-only skill + the
teaching-framework layer (COPILOT-1 M0; designs 1.1.39 + 1.1.50).

Mirrors test_analytics_chat_skill.py for the skill template + access gating, and
adds the framework-as-a-layer assertions (the starter framework default + the
versioned structure rubric the M2 eval scores against).
"""

from __future__ import annotations

from pathlib import Path

from admin.platform_seed import _parse_template
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db.models.access import AccessControl

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent.parent / "skills" / "templates" / "activity-authoring-assistant" / "SKILL.md"
)


def test_authoring_assistant_template_parses() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["name"] == "activity-authoring-assistant"
    # Teacher-only — the recurring AIPLA auth corner (1.1.39 callout).
    assert parsed["accessControl"] == {"type": "tagged", "tags": ["role:teacher"]}


def test_authoring_assistant_instruction_is_the_framework() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    instr = parsed["instructions"].lower()
    # The instruction body IS the (placeholder) teaching-framework meta-prompt.
    assert "teacher" in instr
    assert "socratic" in instr
    # Proposes, never publishes (EARNED TRUST) + declarative-only (no code-gen).
    assert "propose" in instr or "proposal" in instr


class TestAccessControlGating:
    def _ac(self) -> AccessControl:
        return AccessControl.model_validate(_parse_template(TEMPLATE_PATH)["accessControl"])

    def _skill(self, ac: AccessControl):
        return type("_S", (), {"access_control": ac, "owner_id": "platform"})()

    def test_teacher_can_access(self) -> None:
        ctx = build_access_context(
            User(uid="teacher-1", email="t@example.com", group_tags=frozenset({"role:teacher"}), is_teacher=True)
        )
        assert ctx.can_access(self._skill(self._ac())) is True

    def test_anonymous_student_cannot_access(self) -> None:
        ctx = build_access_context(
            User(
                uid="anon-G-xyz",
                email="",
                domain="",
                group_tags=frozenset({"class:teacher-A:C1"}),
                auth_mode="anonymous_group_id",
                group_id="adjective-noun-12",
            )
        )
        assert ctx.can_access(self._skill(self._ac())) is False


class TestTeachingFrameworkLayer:
    def test_framework_version_is_set(self) -> None:
        from adk.authoring_framework import FRAMEWORK_VERSION

        assert isinstance(FRAMEWORK_VERSION, str) and FRAMEWORK_VERSION

    def test_framework_is_placeholder_pending_researcher_content(self) -> None:
        # M0 ships a placeholder behind the gate; AR/JB content is the human
        # gate (1.1.50). The flag makes the swap one edit.
        from adk.authoring_framework import FRAMEWORK_IS_PLACEHOLDER

        assert FRAMEWORK_IS_PLACEHOLDER is True

    def test_structure_rubric_is_well_formed(self) -> None:
        from adk.authoring_framework import STRUCTURE_RUBRIC

        assert isinstance(STRUCTURE_RUBRIC, list) and len(STRUCTURE_RUBRIC) >= 3
        ids = [line.id for line in STRUCTURE_RUBRIC]
        assert len(ids) == len(set(ids)), "rubric line ids must be unique"
        for line in STRUCTURE_RUBRIC:
            assert line.id and line.check, "each rubric line needs an id + a checkable description"

    def test_default_framework_prompt_matches_the_skill_instruction(self) -> None:
        # The framework layer's default IS the skill's shipped instruction, so a
        # researcher override (1.1.47 M2, later) layers onto exactly this.
        from adk.authoring_framework import default_framework_prompt

        prompt = default_framework_prompt()
        assert isinstance(prompt, str) and "socratic" in prompt.lower()
