"""Unit tests for the analytics-chat teacher-only skill (1.G-Ph3 M6).

Verifies the SKILL.md template parses cleanly and that the
accessControl tag gates the skill to teachers only.
"""

from __future__ import annotations

from pathlib import Path

from admin.platform_seed import _parse_template
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db.models.access import AccessControl

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "skills"
    / "templates"
    / "analytics-chat"
    / "SKILL.md"
)


def test_analytics_chat_template_parses() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["name"] == "analytics-chat"
    assert parsed["displayName"] == "Analytics chat"
    assert parsed["accessControl"] == {
        "type": "tagged",
        "tags": ["role:teacher"],
    }


def test_analytics_chat_template_has_instructions() -> None:
    parsed = _parse_template(TEMPLATE_PATH)
    instructions = parsed["instructions"]
    assert "teacher" in instructions.lower()
    assert "privacy" in instructions.lower() or "PII" in instructions or "student" in instructions.lower()


class TestAccessControlGating:
    def _analytics_chat_skill_ac(self) -> AccessControl:
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
        ac = self._analytics_chat_skill_ac()
        ctx = build_access_context(self._teacher_user())
        skill = type("_S", (), {"access_control": ac, "owner_id": "platform"})()
        assert ctx.can_access(skill) is True

    def test_anonymous_student_cannot_access(self) -> None:
        ac = self._analytics_chat_skill_ac()
        ctx = build_access_context(self._student_user())
        skill = type("_S", (), {"access_control": ac, "owner_id": "platform"})()
        assert ctx.can_access(skill) is False

    def test_local_mode_workshop_user_can_access(self) -> None:
        from auth.local_mode_stub import build_workshop_user

        u = build_workshop_user()
        assert "role:teacher" in u.group_tags
        ctx = build_access_context(u)
        ac = self._analytics_chat_skill_ac()
        skill = type("_S", (), {"access_control": ac, "owner_id": "platform"})()
        assert ctx.can_access(skill) is True
