"""Tests for the analytics.tools FunctionTool wrappers.

Each tool's load-bearing safety property: ``assert_caller_owns`` must
run BEFORE any ``run_query`` call. The tests assert this via spies on
both functions, then check the call order on the parent mock.

Per-tool shape tests cover the structured return type. SQL-shape
testing lives in ``test_queries_*.py``; this file is one level up.
"""

from __future__ import annotations

from datetime import UTC
from unittest.mock import MagicMock, patch

import pytest

from analytics import tools
from analytics.auth import PERMISSION_ERROR_MESSAGE
from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _seed_class(owner_uid: str, *, group_codes: list[str] | None = None) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name="Test Class")
    if group_codes:
        cls = cls.model_copy(update={"group_codes": group_codes})
    classes_db.create_class(cls)
    return cls


def _ctx(user_uid: str) -> MagicMock:
    """Mock a ToolContext with the user:id state already set."""
    ctx = MagicMock()
    ctx.state = {"user:id": user_uid}
    return ctx


class TestCallerUidGate:
    """Every tool short-circuits with the canonical refusal if there
    is no caller identity in the tool_context."""

    async def test_no_tool_context_refuses(self) -> None:
        with pytest.raises(PermissionError) as exc:
            await tools.count_messages("any-class")
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_blank_user_id_refuses(self) -> None:
        ctx = MagicMock()
        ctx.state = {}
        with pytest.raises(PermissionError) as exc:
            await tools.count_messages("any-class", tool_context=ctx)
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_uid_from_invocation_context_when_state_missing(self) -> None:
        """The production chat-flow path: ADK's runner wires the user_id
        into ``tool_context._invocation_context.user_id``. Nothing in the
        codebase writes ``state['user:id']`` during a chat turn, so the
        tool must fall back to ``_invocation_context`` or every chat-
        driven analytics call refuses with 'class not accessible' even
        when the user owns the class. Caught in dev 2026-06-02."""
        cls = _seed_class("teacher-A")
        invocation_ctx = MagicMock()
        invocation_ctx.user_id = "teacher-A"  # string, not MagicMock
        ctx = MagicMock()
        ctx.state = {}
        ctx._invocation_context = invocation_ctx
        # Should NOT raise — uid resolved from invocation_context.
        with patch("analytics.tools.queries.count_messages", return_value={"total": 0, "per_group": []}):
            result = await tools.count_messages(cls.class_id, tool_context=ctx)
        assert result == {"total": 0, "per_group": []}


class TestCrossTenantRefusal:
    """Identical refusal for missing and not-owned classes — the same
    contract analytics.auth provides, just verified at the tool entry
    point so a future refactor can't accidentally swallow the error."""

    async def test_missing_class_returns_canonical_refusal(self) -> None:
        with pytest.raises(PermissionError) as exc:
            await tools.count_messages("does-not-exist", tool_context=_ctx("teacher-A"))
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_not_owned_class_returns_canonical_refusal(self) -> None:
        cls_b = _seed_class("teacher-B", group_codes=["b-1"])
        with pytest.raises(PermissionError) as exc:
            await tools.count_messages(cls_b.class_id, tool_context=_ctx("teacher-A"))
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE


class TestAuthRunsBeforeQuery:
    """If a future refactor moves the auth check after the BQ call,
    these tests fail. They are the load-bearing property tests for the
    sprint plan's HARD GATE on M2 — preserved at the tool layer too."""

    @pytest.mark.parametrize(
        "tool_name",
        ["count_messages", "time_on_task", "sim_runs_per_skill", "most_active_groups"],
    )
    async def test_unowned_class_never_hits_run_query(self, tool_name: str) -> None:
        cls_b = _seed_class("teacher-B", group_codes=["b-1"])
        tool = getattr(tools, tool_name)
        with patch("analytics.queries.run_query") as mock_q:
            with pytest.raises(PermissionError):
                await tool(cls_b.class_id, tool_context=_ctx("teacher-A"))
            mock_q.assert_not_called()

    async def test_group_summary_never_hits_session_lookup_when_unowned(self) -> None:
        cls_b = _seed_class("teacher-B", group_codes=["b-1"])
        with patch("analytics.tools.list_sessions_for_group_codes") as mock_sessions:
            with pytest.raises(PermissionError):
                await tools.group_summary(cls_b.class_id, "b-1", tool_context=_ctx("teacher-A"))
            mock_sessions.assert_not_called()


class TestCountMessagesTool:
    async def test_passes_class_group_codes_through_to_query(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1", "a-2"])
        with patch("analytics.queries.run_query") as mock_q:
            mock_q.return_value = [{"group_code": "a-1", "count": 5}]
            result = await tools.count_messages(
                cls.class_id,
                since="2026-05-26T00:00:00Z",
                until="2026-06-02T00:00:00Z",
                tool_context=_ctx("teacher-A"),
            )
            assert result["total"] == 5
            params = mock_q.call_args.kwargs["params"]
            assert set(params["class_group_codes"]) == {"a-1", "a-2"}
            # Defense in depth: allowed_group_codes is the owner's union.
            assert set(params["allowed_group_codes"]) >= {"a-1", "a-2"}


class TestTimeOnTaskTool:
    async def test_returns_per_group_shape(self) -> None:
        from datetime import datetime

        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with patch("analytics.queries.run_query") as mock_q:
            mock_q.return_value = [
                {
                    "group_code": "a-1",
                    "skill_id": "boldkast",
                    "first_ts": datetime(2026, 5, 28, 9, 0, tzinfo=UTC),
                    "last_ts": datetime(2026, 5, 28, 9, 42, tzinfo=UTC),
                    "duration_min": 42,
                }
            ]
            result = await tools.time_on_task(cls.class_id, tool_context=_ctx("teacher-A"))
            assert result["per_group"][0]["duration_min"] == 42
            assert result["per_group"][0]["skill_id"] == "boldkast"


class TestSimRunsPerSkillTool:
    async def test_aggregates_total(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with patch("analytics.queries.run_query") as mock_q:
            mock_q.return_value = [
                {"skill_id": "boldkast", "run_count": 12, "unique_groups": 3},
                {"skill_id": "kinebot-kinematics-tutor", "run_count": 5, "unique_groups": 2},
            ]
            result = await tools.sim_runs_per_skill(cls.class_id, tool_context=_ctx("teacher-A"))
            assert result["total"] == 17
            assert result["per_skill"][0]["skill_id"] == "boldkast"


class TestMostActiveGroupsTool:
    async def test_clamps_limit(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with patch("analytics.queries.run_query") as mock_q:
            mock_q.return_value = []
            await tools.most_active_groups(
                cls.class_id,
                limit=9999,
                tool_context=_ctx("teacher-A"),
            )
            params = mock_q.call_args.kwargs["params"]
            assert params["limit"] == 100  # clamped to upper bound

    async def test_clamps_limit_lower(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with patch("analytics.queries.run_query") as mock_q:
            mock_q.return_value = []
            await tools.most_active_groups(
                cls.class_id,
                limit=0,
                tool_context=_ctx("teacher-A"),
            )
            params = mock_q.call_args.kwargs["params"]
            assert params["limit"] == 1  # clamped to lower bound


class TestGroupSummaryTool:
    async def test_refuses_group_code_outside_class(self) -> None:
        cls = _seed_class("teacher-A", group_codes=["a-1"])
        with pytest.raises(PermissionError) as exc:
            await tools.group_summary(cls.class_id, "not-in-class", tool_context=_ctx("teacher-A"))
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_returns_session_list_shape(self) -> None:
        from datetime import datetime

        cls = _seed_class("teacher-A", group_codes=["a-1"])
        fake_index = MagicMock()
        fake_index.session_id = "sess-1"
        fake_index.skill_id = "boldkast"
        fake_index.group_code = "a-1"
        fake_index.last_message_at = datetime(2026, 5, 28, 9, 42, tzinfo=UTC)
        fake_index.turn_count = 12
        fake_index.title = "Sub-task 1"
        with patch("analytics.tools.list_sessions_for_group_codes") as mock_list:
            mock_list.return_value = [fake_index]
            result = await tools.group_summary(cls.class_id, "a-1", tool_context=_ctx("teacher-A"))
        assert result["sessions"][0]["session_id"] == "sess-1"
        assert result["sessions"][0]["turn_count"] == 12
