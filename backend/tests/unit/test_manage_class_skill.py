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


def test_manage_class_declares_the_safe_tool_set() -> None:
    """The skill went active in 0.2.0: it must declare exactly the safe
    create/list/mint tools. Destructive ops (revoke) stay dashboard-only,
    so they must NOT appear here."""
    parsed = _parse_template(TEMPLATE_PATH)
    tools = parsed["metadata"]["tools"]
    assert set(tools) == {
        "list_my_classes",
        "create_class",
        "mint_group_codes",
        "list_activities",
        "class_spend",
        "class_kpis",
        "class_trend",
    }
    assert "revoke_class" not in tools
    assert "revoke_group_code" not in tools


def test_manage_class_delegates_engagement_to_analytics_chat() -> None:
    """The hub reaches analytics-chat via agentTools (AgentTool delegation),
    NOT by copy-listing its tools. Referenced by stable slug so it resolves
    across environments."""
    parsed = _parse_template(TEMPLATE_PATH)
    assert parsed["metadata"].get("agentTools") == ["analytics-chat"]
    # And it must NOT have copy-listed the analytics tools into its own list.
    assert "count_messages" not in parsed["metadata"]["tools"]


def test_manage_class_tools_resolve_against_registry() -> None:
    """Every declared tool must resolve to a FunctionTool — guards against
    a SKILL.md naming a tool that isn't wired into TOOL_REGISTRY (which
    would raise ValueError at agent-build time, i.e. on first chat turn)."""
    from google.adk.tools import FunctionTool

    from adk.tools import resolve_tools

    parsed = _parse_template(TEMPLATE_PATH)
    resolved = resolve_tools(parsed["metadata"]["tools"], {})
    assert len(resolved) == 7
    assert all(isinstance(t, FunctionTool) for t in resolved)


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
