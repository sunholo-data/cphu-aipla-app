"""Unit tests for the activity-authoring co-pilot's set_lesson_prompt write-tool
(COPILOT-1 M1).

Headline: OWNER-SCOPING. The tool proposes a teachingGoal only for the caller's
OWN activity, returns an enumeration-resistant denial otherwise, and NEVER
persists — the teacher's Apply (PATCH /api/activities) is the only write.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from db import firestore as fs_module
from db.activities import create_activity
from db.models.activity import Activity

TEACHER = "teacher-1"
OTHER = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _tc(uid: str | None):
    """A stub ToolContext: identity rides _invocation_context.user_id (the
    production path) per the analytics.tools._caller_uid precedent."""
    return SimpleNamespace(_invocation_context=SimpleNamespace(user_id=uid), state={})


def _make_activity(owner: str = TEACHER) -> str:
    a = create_activity(Activity(activityId="", skillId="concept", ownerUid=owner, title="A"))
    return a.activity_id


def test_owner_gets_a_well_formed_proposal():
    from adk.authoring_tools import set_lesson_prompt

    aid = _make_activity(TEACHER)
    res = set_lesson_prompt(text="Udforsk energibevarelse for en B-klasse.", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["field"] == "teachingGoal"
    assert res["proposal"]["activityId"] == aid
    assert "energibevarelse" in res["proposal"]["value"].lower()


def test_non_owner_is_denied():
    from adk.authoring_tools import set_lesson_prompt

    aid = _make_activity(TEACHER)
    res = set_lesson_prompt(text="hax", activity_id=aid, tool_context=_tc(OTHER))
    assert res["ok"] is False


def test_missing_activity_same_shape_as_denied():
    # Enumeration-resistant: a missing activity and a not-owned one return the
    # same negative shape (no existence leak).
    from adk.authoring_tools import set_lesson_prompt

    denied = set_lesson_prompt(text="x", activity_id=_make_activity(OTHER), tool_context=_tc(TEACHER))
    missing = set_lesson_prompt(text="x", activity_id="act-does-not-exist", tool_context=_tc(TEACHER))
    assert denied["ok"] is False and missing["ok"] is False
    assert denied.get("error") == missing.get("error")


def test_no_identity_is_denied_not_crashed():
    from adk.authoring_tools import set_lesson_prompt

    res = set_lesson_prompt(text="x", activity_id="act-1", tool_context=_tc(None))
    assert res["ok"] is False


def test_empty_or_overlong_text_is_rejected():
    from adk.authoring_tools import MAX_GOAL_LEN, set_lesson_prompt

    aid = _make_activity(TEACHER)
    assert set_lesson_prompt(text="   ", activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False
    assert set_lesson_prompt(text="x" * (MAX_GOAL_LEN + 1), activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False


def test_tool_never_persists(monkeypatch):
    # The tool proposes; only the teacher's Apply persists. Guard the tool path
    # never writes to the store.
    from adk import authoring_tools

    aid = _make_activity(TEACHER)

    def _boom(*_a, **_k):
        raise AssertionError("set_lesson_prompt must not persist — it only proposes")

    monkeypatch.setattr(authoring_tools, "save_activity", _boom)
    res = authoring_tools.set_lesson_prompt(text="A good goal.", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    # the stored activity is untouched (still the empty default goal)
    from db.activities import get_activity

    assert get_activity(aid).teaching_goal == ""
