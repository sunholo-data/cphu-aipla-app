"""Unit tests for the manage-class teacher-only skill (1.A M8).

Verifies the SKILL.md template parses cleanly and that the
accessControl tag gates the skill to teachers only via the existing
5-type AccessControl evaluator — no edits to access_context.py
(axiom 9 promise).
"""

from __future__ import annotations

from pathlib import Path

from admin.platform_seed import _parse_template
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db.models.access import AccessControl

TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent / "skills" / "templates" / "manage-class" / "SKILL.md"


def test_manage_class_template_parses() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["name"] == "manage-class"
    assert parsed["displayName"] == "Manage classes"
    assert "teacher" in parsed["description"].lower()
    assert parsed["accessControl"] == {
        "type": "tagged",
        "tags": ["role:teacher"],
    }


def test_manage_class_template_has_instructions() -> None:
    """Instructions must include the teacher-scope reminder + the
    privacy/safety boundary."""
    parsed = _parse_template(TEMPLATE_PATH)
    instructions = parsed["instructions"]
    assert "class-management" in instructions.lower() or "teacher" in instructions.lower()
    # Privacy boundary
    assert "PII" in instructions or "student emails" in instructions.lower()


class TestAccessControlGating:
    """The real AccessContext evaluator gates manage-class — no
    edits to access_context.py, no custom evaluator. Teachers carry
    the synthetic role:teacher tag; anonymous-group students do not."""

    def _manage_class_skill_ac(self) -> AccessControl:
        parsed = _parse_template(TEMPLATE_PATH)
        return AccessControl.model_validate(parsed["accessControl"])

    def _teacher_user(self) -> User:
        return User(
            uid="teacher-1",
            email="t@example.com",
            group_tags=frozenset({"role:teacher"}),
            is_teacher=True,
        )

    def _student_user(self) -> User:
        return User(
            uid="anon-G-xyz",
            email="",
            domain="",
            group_tags=frozenset({"class:teacher-A:C1"}),
            auth_mode="anonymous_group_id",
            group_id="adjective-noun-12",
        )

    def test_teacher_can_access(self) -> None:
        ac = self._manage_class_skill_ac()
        ctx = build_access_context(self._teacher_user())
        skill = type(
            "_S",
            (),
            {"access_control": ac, "owner_id": "platform"},
        )()
        assert ctx.can_access(skill) is True

    def test_anonymous_student_cannot_access(self) -> None:
        ac = self._manage_class_skill_ac()
        ctx = build_access_context(self._student_user())
        skill = type(
            "_S",
            (),
            {"access_control": ac, "owner_id": "platform"},
        )()
        assert ctx.can_access(skill) is False

    def test_local_mode_workshop_user_can_access(self) -> None:
        """LOCAL_MODE workshop user has the synthetic role:teacher tag
        too — so the teacher routes + manage-class work in dev without
        env-specific branching."""
        from auth.local_mode_stub import build_workshop_user

        u = build_workshop_user()
        assert "role:teacher" in u.group_tags
        ctx = build_access_context(u)
        ac = self._manage_class_skill_ac()
        skill = type(
            "_S",
            (),
            {"access_control": ac, "owner_id": "platform"},
        )()
        assert ctx.can_access(skill) is True
