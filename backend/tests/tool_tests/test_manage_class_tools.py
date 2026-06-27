"""Tests for the manage-class FunctionTool wrappers (tools.class_management).

Load-bearing safety property mirrored from the analytics wrappers:
``assert_caller_owns`` runs BEFORE any Firestore write for the
class-scoped tools, and the byte-identical "class not accessible" refusal
covers both missing and not-owned classes (enumeration-resistant).

Shape tests cover the structured return types. The underlying repository
(``db.classes``) is exercised by its own tests; here we verify the tool
layer: identity resolution, ownership gating, clamping, and that the
write actually lands.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from analytics.auth import PERMISSION_ERROR_MESSAGE
from db import classes as classes_db
from db import firestore as fs_module
from db.models.class_ import Class
from tools import class_management as tools


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


def _seed_class(owner_uid: str, *, name: str = "Test Class", group_codes: list[str] | None = None) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name=name)
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
    """Every tool short-circuits with the canonical refusal when there is
    no caller identity in the tool_context."""

    async def test_list_no_context_refuses(self) -> None:
        with pytest.raises(PermissionError) as exc:
            await tools.list_my_classes()
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_create_blank_uid_soft_error(self) -> None:
        # Propose tools are soft (return ok/error, never raise) so a missing
        # caller doesn't abort the turn.
        ctx = MagicMock()
        ctx.state = {}
        result = await tools.create_class("Physics 101", tool_context=ctx)
        assert result == {"ok": False, "error": "not signed in"}

    async def test_mint_no_context_soft_error(self) -> None:
        result = await tools.mint_group_codes("any-class")
        assert result == {"ok": False, "error": "not signed in"}

    async def test_uid_from_invocation_context_when_state_missing(self) -> None:
        """The production chat-flow path: ADK wires the user_id into
        ``tool_context._invocation_context.user_id``. Falling back there
        is what makes chat-driven calls work (caught for analytics-chat
        2026-06-02). Verified here too so the manage-class tools can't
        regress it independently."""
        invocation_ctx = MagicMock()
        invocation_ctx.user_id = "teacher-A"  # string, not MagicMock
        ctx = MagicMock()
        ctx.state = {}
        ctx._invocation_context = invocation_ctx
        result = await tools.list_my_classes(tool_context=ctx)
        assert result == {"classes": []}


class TestCreateClass:
    """Propose-only: create_class returns a proposal and persists NOTHING — the
    teacher Applies it in the co-pilot (which calls the REST create)."""

    async def test_proposes_without_persisting(self) -> None:
        result = await tools.create_class(
            "Fysik 9A",
            description="Vår 2026",
            tool_context=_ctx("teacher-A"),
        )
        assert result["ok"] is True
        assert result["proposal"] == {
            "kind": "create_class",
            "name": "Fysik 9A",
            "description": "Vår 2026",
        }
        # Nothing written — it's a proposal, not a create.
        assert classes_db.list_classes_for_owner("teacher-A") == []

    async def test_blank_name_soft_error(self) -> None:
        result = await tools.create_class("   ", tool_context=_ctx("teacher-A"))
        assert result == {"ok": False, "error": "a class name is required"}

    async def test_name_is_trimmed_in_proposal(self) -> None:
        result = await tools.create_class("  Mekanik  ", tool_context=_ctx("teacher-A"))
        assert result["proposal"]["name"] == "Mekanik"


class TestListMyClasses:
    async def test_scoped_to_caller(self) -> None:
        _seed_class("teacher-A", name="A-class")
        _seed_class("teacher-B", name="B-class")
        result = await tools.list_my_classes(tool_context=_ctx("teacher-A"))
        names = [c["name"] for c in result["classes"]]
        assert names == ["A-class"]

    async def test_includes_group_codes_and_counts(self) -> None:
        _seed_class("teacher-A", group_codes=["a-1", "a-2"])
        result = await tools.list_my_classes(tool_context=_ctx("teacher-A"))
        brief = result["classes"][0]
        assert brief["group_codes"] == ["a-1", "a-2"]
        assert brief["num_group_codes"] == 2
        assert brief["num_activities"] == 0

    async def test_empty_for_teacher_with_no_classes(self) -> None:
        result = await tools.list_my_classes(tool_context=_ctx("teacher-fresh"))
        assert result == {"classes": []}


class TestListActivities:
    async def test_no_context_refuses(self) -> None:
        with pytest.raises(PermissionError) as exc:
            await tools.list_activities()
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_scoped_to_caller_and_brief_shape(self) -> None:
        from db import activities as activities_db
        from db.models.activity import Activity

        mine = Activity(activityId="act-mine", ownerUid="teacher-A", title="Boldkast", skillId="boldkast")
        theirs = Activity(activityId="act-theirs", ownerUid="teacher-B", title="Theirs", skillId="x")
        activities_db.save_activity(mine)
        activities_db.save_activity(theirs)

        result = await tools.list_activities(tool_context=_ctx("teacher-A"))
        assert [a["activity_id"] for a in result["activities"]] == ["act-mine"]
        brief = result["activities"][0]
        assert brief["title"] == "Boldkast"
        assert brief["skill_id"] == "boldkast"
        assert brief["visibility"] == "private"

    async def test_empty_for_teacher_with_no_activities(self) -> None:
        result = await tools.list_activities(tool_context=_ctx("teacher-fresh"))
        assert result == {"activities": []}


class TestClassSpend:
    async def test_no_context_refuses(self) -> None:
        with pytest.raises(PermissionError) as exc:
            await tools.class_spend("any-class")
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    async def test_unowned_class_refuses_before_query(self) -> None:
        cls_b = _seed_class("teacher-B")
        with patch("tools.class_management.cost_queries.class_spend") as mock_spend:
            with pytest.raises(PermissionError) as exc:
                await tools.class_spend(cls_b.class_id, tool_context=_ctx("teacher-A"))
            assert str(exc.value) == PERMISSION_ERROR_MESSAGE
            mock_spend.assert_not_called()

    async def test_owned_class_passes_period_through(self) -> None:
        cls = _seed_class("teacher-A")
        with patch("tools.class_management.cost_queries.class_spend", return_value={"total_eur": 1.23}) as mock_spend:
            result = await tools.class_spend(cls.class_id, period="last_month", tool_context=_ctx("teacher-A"))
            assert result == {"total_eur": 1.23}
            assert mock_spend.call_args.args == (cls.class_id, "last_month")

    async def test_invalid_period_defaults_to_this_month(self) -> None:
        cls = _seed_class("teacher-A")
        with patch("tools.class_management.cost_queries.class_spend", return_value={}) as mock_spend:
            await tools.class_spend(cls.class_id, period="bogus", tool_context=_ctx("teacher-A"))
            assert mock_spend.call_args.args == (cls.class_id, "this_month")


class TestClassKpisAndTrend:
    @pytest.mark.parametrize("tool_name", ["class_kpis", "class_trend"])
    async def test_no_context_refuses(self, tool_name: str) -> None:
        with pytest.raises(PermissionError) as exc:
            await getattr(tools, tool_name)("any-class")
        assert str(exc.value) == PERMISSION_ERROR_MESSAGE

    @pytest.mark.parametrize("tool_name", ["class_kpis", "class_trend"])
    async def test_unowned_class_refuses_before_aggregate(self, tool_name: str) -> None:
        cls_b = _seed_class("teacher-B")
        with patch.object(tools.aggregates, tool_name) as mock_agg:
            with pytest.raises(PermissionError):
                await getattr(tools, tool_name)(cls_b.class_id, tool_context=_ctx("teacher-A"))
            mock_agg.assert_not_called()

    async def test_class_kpis_builds_teacher_user_and_passes_window(self) -> None:
        cls = _seed_class("teacher-A")
        with patch.object(tools.aggregates, "class_kpis", return_value={"active_groups": 0}) as mock_agg:
            result = await tools.class_kpis(
                cls.class_id,
                since="2026-05-01T00:00:00Z",
                until="2026-06-01T00:00:00Z",
                tool_context=_ctx("teacher-A"),
            )
            assert result == {"active_groups": 0}
            kwargs = mock_agg.call_args.kwargs
            # A minimal teacher User is constructed from the caller uid.
            assert kwargs["user"].uid == "teacher-A"
            assert kwargs["user"].is_teacher is True
            assert kwargs["user"].is_researcher is False
            assert kwargs["class_id"] == cls.class_id
            assert kwargs["since"].isoformat().startswith("2026-05-01")
            assert kwargs["until"].isoformat().startswith("2026-06-01")

    async def test_class_trend_defaults_window_when_omitted(self) -> None:
        cls = _seed_class("teacher-A")
        with patch.object(tools.aggregates, "class_trend", return_value={"series": []}) as mock_agg:
            await tools.class_trend(cls.class_id, tool_context=_ctx("teacher-A"))
            kwargs = mock_agg.call_args.kwargs
            # since defaults to ~30 days before until.
            span = kwargs["until"] - kwargs["since"]
            assert span.days == 30


class TestMintGroupCodes:
    """Propose-only: mint_group_codes returns a proposal and mints NOTHING — the
    teacher Applies it (which calls the REST mint). Ownership is still validated
    before proposing, with a soft refusal (no raise)."""

    async def test_proposes_without_minting(self) -> None:
        cls = _seed_class("teacher-A")
        result = await tools.mint_group_codes(cls.class_id, count=2, tool_context=_ctx("teacher-A"))
        assert result["ok"] is True
        assert result["proposal"] == {
            "kind": "mint_codes",
            "class_id": cls.class_id,
            "class_name": cls.name,
            "count": 2,
        }
        # Nothing minted — the class has no new codes, no anon_groups docs.
        assert classes_db.get_class(cls.class_id).group_codes == []

    async def test_unowned_class_soft_refusal(self) -> None:
        cls_b = _seed_class("teacher-B")
        result = await tools.mint_group_codes(cls_b.class_id, tool_context=_ctx("teacher-A"))
        assert result == {"ok": False, "error": "class not accessible"}

    async def test_missing_class_soft_refusal(self) -> None:
        result = await tools.mint_group_codes("does-not-exist", tool_context=_ctx("teacher-A"))
        assert result == {"ok": False, "error": "class not accessible"}

    async def test_never_mints_during_propose(self) -> None:
        """Propose must NOT touch the real mint path, even for an owned class."""
        cls = _seed_class("teacher-A")
        with patch.object(classes_db, "mint_group_codes_under_class") as mock_mint:
            await tools.mint_group_codes(cls.class_id, count=3, tool_context=_ctx("teacher-A"))
            mock_mint.assert_not_called()

    async def test_clamps_count_in_proposal(self) -> None:
        cls = _seed_class("teacher-A")
        upper = await tools.mint_group_codes(cls.class_id, count=9999, tool_context=_ctx("teacher-A"))
        assert upper["proposal"]["count"] == 50
        lower = await tools.mint_group_codes(cls.class_id, count=0, tool_context=_ctx("teacher-A"))
        assert lower["proposal"]["count"] == 1
