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


# --- COPILOT-2 M1: add_element (owner-scoped, propose-only, registry-validated) ---


def test_add_element_owner_gets_a_checklist_proposal():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="checklist",
        items=["Find massen", " Beregn energien ", "", "Sammenlign"],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True
    assert res["proposal"]["kind"] == "add_element"
    assert res["proposal"]["element_kind"] == "checklist"
    # blanks stripped, whitespace trimmed
    assert res["proposal"]["spec"]["items"] == ["Find massen", "Beregn energien", "Sammenlign"]


def test_add_element_non_owner_is_denied():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(element_kind="checklist", items=["x"], activity_id=aid, tool_context=_tc(OTHER))
    assert res["ok"] is False


def test_add_element_rejects_unknown_and_unsupported_kinds():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    unknown = add_element(element_kind="bogus", items=["x"], activity_id=aid, tool_context=_tc(TEACHER))
    unsupported = add_element(element_kind="calculator", items=["x"], activity_id=aid, tool_context=_tc(TEACHER))
    assert unknown["ok"] is False and unsupported["ok"] is False


def test_add_element_rejects_empty_checklist():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert (
        add_element(element_kind="checklist", items=["  ", ""], activity_id=aid, tool_context=_tc(TEACHER))["ok"]
        is False
    )


def test_add_element_caps_item_count():
    from adk.authoring_tools import MAX_CHECKLIST_ITEMS, add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="checklist",
        items=[f"trin {i}" for i in range(MAX_CHECKLIST_ITEMS + 10)],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert len(res["proposal"]["spec"]["items"]) == MAX_CHECKLIST_ITEMS


def test_add_element_never_persists(monkeypatch):
    from adk import authoring_tools

    aid = _make_activity(TEACHER)
    monkeypatch.setattr(
        authoring_tools, "save_activity", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not persist"))
    )
    res = authoring_tools.add_element(element_kind="checklist", items=["a"], activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True


# --- COPILOT-2 M2: set_artefact (owner-scoped, propose-only, catalogue-validated) ---


def test_set_artefact_owner_gets_a_sim_proposal():
    from adk.authoring_tools import set_artefact

    aid = _make_activity(TEACHER)
    res = set_artefact(artefact_id="boldkast", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["kind"] == "set_artefact"
    assert res["proposal"]["artefactId"] == "boldkast"
    assert "boldkast" in res["proposal"]["label"].lower()


def test_set_artefact_non_owner_is_denied():
    from adk.authoring_tools import set_artefact

    aid = _make_activity(TEACHER)
    res = set_artefact(artefact_id="boldkast", activity_id=aid, tool_context=_tc(OTHER))
    assert res["ok"] is False


def test_set_artefact_unknown_sim_returns_the_catalogue():
    # Self-correcting: an invalid id returns the available sims so the agent retries.
    from adk.authoring_tools import set_artefact

    aid = _make_activity(TEACHER)
    res = set_artefact(artefact_id="not-a-sim", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is False
    ids = {s["id"] for s in res["available"]}
    assert {"boldkast", "kinebot", "led-planck"} <= ids


def test_set_artefact_never_persists(monkeypatch):
    from adk import authoring_tools

    aid = _make_activity(TEACHER)
    monkeypatch.setattr(
        authoring_tools, "save_activity", lambda *a, **k: (_ for _ in ()).throw(AssertionError("must not persist"))
    )
    res = authoring_tools.set_artefact(artefact_id="boldkast", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True


# --- COPILOT-2 M3: add_element note / solution / document (text-authored kinds) ---


def test_add_element_note_owner_gets_a_proposal():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="note",
        text="Husk: energi måles i joule.",
        title="Energi",
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True
    assert res["proposal"]["element_kind"] == "note"
    assert res["proposal"]["spec"] == {"title": "Energi", "body": "Husk: energi måles i joule."}


def test_add_element_solution_and_document_carry_a_prompt():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    for kind in ("solution", "document"):
        res = add_element(element_kind=kind, text="Vis din løsning.", activity_id=aid, tool_context=_tc(TEACHER))
        assert res["ok"] is True, kind
        assert res["proposal"]["element_kind"] == kind
        assert res["proposal"]["spec"] == {"prompt": "Vis din løsning."}


def test_add_element_text_kinds_require_text():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    for kind in ("note", "solution", "document"):
        assert add_element(element_kind=kind, text="  ", activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False, (
            kind
        )


def test_add_element_text_kinds_owner_scoped():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert add_element(element_kind="note", text="x", activity_id=aid, tool_context=_tc(OTHER))["ok"] is False


# --- COPILOT-2 M4: structured elements — table / chart / calculator ---


def test_add_element_table_builds_a_validated_spec():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(
        element_kind="table",
        title="Målinger",
        columns=[{"label": "tid", "unit": "s", "kind": "number"}, {"label": "navn", "kind": "text"}],
        rows=6,
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert res["ok"] is True
    assert res["proposal"]["element_kind"] == "table"
    assert res["proposal"]["spec"]["rows"] == 6
    assert [c["label"] for c in res["proposal"]["spec"]["columns"]] == ["tid", "navn"]


def test_add_element_table_rejects_no_columns():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert add_element(element_kind="table", columns=[], activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False


def test_add_element_chart_carries_kind():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    res = add_element(element_kind="chart", chart_kind="line", title="v-t", activity_id=aid, tool_context=_tc(TEACHER))
    assert res["ok"] is True
    assert res["proposal"]["spec"]["chartKind"] == "line"


def test_add_element_chart_rejects_unknown_kind():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert (
        add_element(element_kind="chart", chart_kind="pie", activity_id=aid, tool_context=_tc(TEACHER))["ok"] is False
    )


def test_add_element_calculator_validates_formula_coherence():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    ok = add_element(
        element_kind="calculator",
        formula="s / t",
        inputs=[{"id": "s", "label": "strækning", "unit": "m"}, {"id": "t", "label": "tid", "unit": "s"}],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert ok["ok"] is True
    assert ok["proposal"]["spec"]["formula"] == "s / t"
    # a formula referencing an undefined variable is rejected (coherence)
    bad = add_element(
        element_kind="calculator",
        formula="s / q",
        inputs=[{"id": "s", "label": "strækning"}],
        activity_id=aid,
        tool_context=_tc(TEACHER),
    )
    assert bad["ok"] is False


def test_add_element_structured_kinds_owner_scoped():
    from adk.authoring_tools import add_element

    aid = _make_activity(TEACHER)
    assert add_element(element_kind="chart", chart_kind="bar", activity_id=aid, tool_context=_tc(OTHER))["ok"] is False
