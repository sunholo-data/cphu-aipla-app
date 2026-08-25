"""Checklist tick tools + per-group store (1.1.62 M3).

Aswin, 2026-08-06: *"How can I activate the automatic ILOs check in the
workbench?"* — and, in his follow-up, the confirmation that **ILOs are the
workspace checklist**. There was no such feature to activate: the checklist was
absent from the tutor's prompt (fixed in M2) and there was no tool to tick an
item.

**Two decisions recorded here, both taken deliberately on 2026-08-06.**

1. *The AI helps auto-grade.* ``ProgressChecklist`` carried the principle
   "student-driven, not auto-graded — the agent does NOT decide what's done".
   M's call supersedes it, following Aswin's ask. The student override survives:
   an AI tick is help, not a verdict, and provenance is always visible.

2. *One store, per group.* Student ticks lived in ``sessionStorage`` keyed by
   skill — per BROWSER. 1.1.53 shipped on the premise that the primary classroom
   shape is several students in one group on separate devices, so that store was
   already wrong: three group members had three private checklists. Adding AI
   ticks in group scope beside it would have made the split visible and worse.
   Both now live in ``checklist_progress/{group_id}:{activity_id}``.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from google.adk.sessions.state import State

from adk.checklist_tools import build_checklist_tools, checklist_state_summary
from auth.firebase_auth import User
from db import firestore as fs_module
from db.checklist_progress import get_item_states, record_item_state
from db.models.activity_config import ActivityConfig, ChecklistItem

GROUP = "aipla-demo-1"
OTHER_GROUP = "aipla-demo-2"
ACTIVITY = "act-fald"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _cfg(items: list[tuple[str, str]] | None = None) -> ActivityConfig:
    items = items if items is not None else [("a", "Mål faldtiden"), ("b", "Beregn gennemsnittet")]
    return ActivityConfig(
        activityId=ACTIVITY,
        classId="c1",
        teacherUid="t1",
        checklist=[ChecklistItem(id=i, label=lbl) for i, lbl in items],
        updatedAt=datetime.now(UTC),
    )


def _student(group_id: str = GROUP) -> User:
    """An anonymous-group student: email and domain are EMPTY (ADR-001)."""
    return User(uid=f"group:{group_id}", email="", group_id=group_id)


def _teacher() -> User:
    return User(uid="t1", email="teacher@example.dk")


def _tools(cfg=None, user=None) -> dict:
    return {t.func.__name__: t.func for t in build_checklist_tools(cfg or _cfg(), user or _student())}


# ---------------------------------------------------------------------------
# Tool attachment
# ---------------------------------------------------------------------------


def test_tools_are_attached_when_the_activity_has_a_checklist():
    assert set(_tools()) == {"list_checklist", "mark_checklist_item"}


def test_no_tools_without_a_checklist():
    assert build_checklist_tools(_cfg(items=[]), _student()) == []


def test_no_tools_for_a_teacher_preview():
    """A teacher previewing an activity has no group to record against.

    Mirrors build_checkpoint_tools. Attaching them would need a group_id from
    somewhere, and the only somewhere would be a tool parameter — which is the
    thing that must never happen.
    """
    assert build_checklist_tools(_cfg(), _teacher()) == []


def test_no_tools_when_config_is_missing():
    assert build_checklist_tools(None, _student()) == []


# ---------------------------------------------------------------------------
# Ticking
# ---------------------------------------------------------------------------


def test_mark_ticks_an_item_and_returns_the_updated_state():
    out = _tools()["mark_checklist_item"]("a", True, "målte faldtiden tre gange og noterede 0,45 s")
    assert out["ok"] is True
    assert out["itemStates"]["a"]["done"] is True
    assert out["itemStates"]["a"]["by"] == "ai"


def test_mark_echoes_the_evidence_for_the_trust_card():
    """The student sees WHY the AI ticked it. Same contract as record_checkpoint."""
    out = _tools()["mark_checklist_item"]("a", True, "beskrev opstillingen og aflæste tiden korrekt")
    assert "beskrev opstillingen" in out["evidence"]
    assert out["item"]["label"] == "Mål faldtiden"


def test_mark_rejects_an_empty_evidence_summary():
    """A tick with no evidence is refused at the tool boundary.

    The student is entitled to know why the AI thinks they did something, and
    the trust card has nothing to render without it. Rejecting here rather than
    defaulting to a placeholder keeps the model honest.
    """
    out = _tools()["mark_checklist_item"]("a", True, "   ")
    assert out["ok"] is False
    assert "evidence" in out["error"].lower()
    assert get_item_states(GROUP, ACTIVITY) == {}


def test_mark_rejects_an_unknown_item_and_lists_the_valid_ones():
    out = _tools()["mark_checklist_item"]("nope", True, "some evidence")
    assert out["ok"] is False
    assert {i["id"] for i in out["items"]} == {"a", "b"}


def test_mark_can_untick():
    tools = _tools()
    tools["mark_checklist_item"]("a", True, "did it")
    out = tools["mark_checklist_item"]("a", False, "actually the reading was wrong")
    assert out["itemStates"]["a"]["done"] is False


def test_list_reports_outstanding_and_done_items():
    tools = _tools()
    tools["mark_checklist_item"]("a", True, "did it")
    listed = {i["id"]: i for i in tools["list_checklist"]()["items"]}
    assert listed["a"]["done"] is True
    assert listed["b"]["done"] is False


# ---------------------------------------------------------------------------
# Group scoping — the security property
# ---------------------------------------------------------------------------


def test_group_is_captured_from_the_verified_identity_not_a_parameter():
    """``group_id`` must not be a tool parameter the model can set.

    If it were, a prompt-injected student could tick another group's checklist.
    The closure captures it from the verified JWT claim.

    ``tool_context`` (1.1.69 M3) is injected by ADK and excluded from the
    function declaration the model sees, so it is not a widening of the
    model-settable surface — but it IS the mechanism by which the tool reads
    session state, so the assertion below names it explicitly rather than
    matching loosely.
    """
    import inspect

    from google.adk.tools import ToolContext

    params = inspect.signature(_tools()["mark_checklist_item"]).parameters
    assert "group_id" not in params
    assert "activity_id" not in params
    # ``from __future__ import annotations`` makes these string annotations —
    # ADK matches on the same name, so assert the name it matches on.
    assert params["tool_context"].annotation in ("ToolContext", ToolContext)
    assert set(params) - {"tool_context"} == {"item_id", "done", "evidence_summary"}


def test_one_groups_ticks_do_not_reach_another():
    _tools(user=_student(GROUP))["mark_checklist_item"]("a", True, "did it")
    assert get_item_states(GROUP, ACTIVITY)["a"]["done"] is True
    assert get_item_states(OTHER_GROUP, ACTIVITY) == {}


def test_state_survives_a_new_session():
    """State is keyed by (group, activity), never by session id — a group that
    rejoins on a new session must not lose its progress."""
    _tools()["mark_checklist_item"]("a", True, "did it")
    # Re-resolving the state through a fresh tool closure stands in for a new
    # session: nothing session-scoped is threaded through the key.
    assert _tools()["list_checklist"]()["items"][0]["done"] is True
    assert get_item_states(GROUP, ACTIVITY)["a"]["done"] is True


# ---------------------------------------------------------------------------
# Provenance — student ticks are authoritative, AI ticks are help
# ---------------------------------------------------------------------------


def test_student_tick_is_recorded_with_student_provenance():
    states = record_item_state(GROUP, ACTIVITY, "a", done=True, by="student")
    assert states["a"]["by"] == "student"
    assert states["a"].get("evidence") in (None, "")


def test_a_student_can_override_an_ai_tick():
    """The override is what keeps "the AI helps auto-grade" honest (Axiom 2).

    Once the student disagrees, the item is theirs — the provenance flips so the
    UI stops presenting it as the AI's read.
    """
    _tools()["mark_checklist_item"]("a", True, "looked done to me")
    states = record_item_state(GROUP, ACTIVITY, "a", done=False, by="student")
    assert states["a"]["done"] is False
    assert states["a"]["by"] == "student"


def test_evidence_is_bounded():
    out = _tools()["mark_checklist_item"]("a", True, "x" * 2000)
    assert len(out["evidence"]) <= 500


# ---------------------------------------------------------------------------
# Context summary
# ---------------------------------------------------------------------------


def test_state_summary_is_empty_before_anything_is_ticked():
    assert checklist_state_summary(_cfg(), _student()) == ""


def test_state_summary_names_done_items_for_the_tutor():
    _tools()["mark_checklist_item"]("a", True, "did it")
    summary = checklist_state_summary(_cfg(), _student())
    # 1.1.70 M1: the teacher's LABEL, not the bare item id the old one-line
    # form emitted.
    assert "Mål faldtiden" in summary


def test_state_summary_is_empty_for_a_teacher():
    assert checklist_state_summary(_cfg(), _teacher()) == ""


# ---------------------------------------------------------------------------
# PILOT-1 M0 — reset clears PROGRESS, not just the conversation
#
# Root cause of Aswin's 2026-08-10 report. A reset wiped the conversation and
# the group-session pointer and left the ticks behind, ORPHANED: he rejoined,
# got a fresh session, and the tutor found four marks from a conversation that
# no longer existed and skipped the lesson.
#
# Every per-group progress store added so far was invisible to the reset meant
# to clear it — concept_progress (CONCEPT-1) and checklist_progress (1.1.62 M3).
# ---------------------------------------------------------------------------


def test_clear_progress_removes_a_groups_ticks():
    from db.checklist_progress import clear_progress_for_group

    _tools()["mark_checklist_item"]("a", True, "did it")
    assert get_item_states(GROUP, ACTIVITY)["a"]["done"] is True

    assert clear_progress_for_group(GROUP, ACTIVITY) == 1
    assert get_item_states(GROUP, ACTIVITY) == {}


def test_clear_progress_does_not_touch_another_group():
    from db.checklist_progress import clear_progress_for_group

    _tools(user=_student(GROUP))["mark_checklist_item"]("a", True, "did it")
    _tools(user=_student(OTHER_GROUP))["mark_checklist_item"]("a", True, "did it")

    clear_progress_for_group(GROUP, ACTIVITY)
    assert get_item_states(OTHER_GROUP, ACTIVITY)["a"]["done"] is True


def test_clear_progress_without_activity_clears_every_activity():
    from db.checklist_progress import clear_progress_for_group, record_item_state

    record_item_state(GROUP, "act-one", "a", done=True, by="student")
    record_item_state(GROUP, "act-two", "b", done=True, by="student")

    assert clear_progress_for_group(GROUP) == 2
    assert get_item_states(GROUP, "act-one") == {}
    assert get_item_states(GROUP, "act-two") == {}


def test_clear_progress_is_idempotent():
    from db.checklist_progress import clear_progress_for_group

    assert clear_progress_for_group(GROUP, ACTIVITY) == 0


def test_every_per_group_progress_store_is_in_the_reset_script():
    """**The guard.** A progress store the reset cannot see will orphan.

    If you add a new per-group progress collection, add it to
    ``_TEACHING_COLLECTIONS`` on the same day — not the week after a teacher
    reports the symptom. Both existing stores failed this until 2026-08-10.
    """
    from db.checklist_progress import _COLLECTION as CHECKLIST_COLLECTION
    from db.concept_progress import _COLLECTION as CONCEPT_COLLECTION
    from scripts.reset_teaching_data import _TEACHING_COLLECTIONS

    for coll in (CHECKLIST_COLLECTION, CONCEPT_COLLECTION):
        assert coll in _TEACHING_COLLECTIONS, f"{coll} survives reset_teaching_data — it will orphan"


# ---------------------------------------------------------------------------
# Marks require verifiable evidence (1.1.69 M3 / PILOT-1 M2)
#
# The tool's own docstring says "tick it when you have seen the substance".
# For a step whose substance is a data table that was UNFOLLOWABLE — nothing
# ever showed the model the table's contents — so it marked on the student's
# word and wrote an authoritative evidence sentence a teacher then reads.
#
# The check FAILS OPEN everywhere it is not certain. Half these tests are of
# the fail-open half, on purpose: a refusal the student cannot act on is worse
# than the bug it replaces.
# ---------------------------------------------------------------------------


def _table_cfg(items, tables):
    from db.models.activity_config import ActivityConfig

    return ActivityConfig(
        activityId=ACTIVITY,
        classId="c1",
        teacherUid="t1",
        checklist=[ChecklistItem(id=i, label=lbl) for i, lbl in items],
        table=tables,
        updatedAt=datetime.now(UTC),
    )


def _table(id_="t1", title="Faldforsøg", rows=5):
    from db.models.activity_config import TableColumn, TableElement

    return TableElement(
        id=id_,
        title=title,
        columns=[TableColumn(id="h", label="højde", unit="m"), TableColumn(id="t", label="tid", unit="s")],
        rows=rows,
    )


class _Ctx:
    """ADK injects a ToolContext; the tool reads only ``.state`` off it.

    ``.state`` is a REAL ``google.adk.sessions.state.State``, not a plain dict.
    That distinction is the whole point of this double. ADK's ``State`` has
    ``__getitem__``/``__setitem__``/``__contains__``/``get``/``update``/
    ``setdefault``/``to_dict`` but **no** ``keys()`` and **no** ``__iter__``, so
    ``dict(state)`` does not copy it — it falls through to the sequence protocol,
    asks for ``state[0]`` and raises ``KeyError: 0``.

    This double used to be a plain dict, which made ``dict(...)`` work perfectly
    in tests while failing on every single call in production. The empty-element
    guard below therefore never ran once in the 2026-08-21 pilot, including in
    the case the test at the bottom of this file calls "Aswin's exact case" —
    green in CI, not working in the room. A double that cannot reproduce the
    failure is not a double.
    """

    def __init__(self, state: dict | None = None):
        self.state = State(value=dict(state or {}), delta={})


def _table_state(table_id="t1", filled=0):
    return {"mcp_app_context.table.state": {"structuredContent": {"tableId": table_id, "filledCells": filled}}}


def test_done_on_an_empty_table_produces_no_mark():
    """**Aswin's exact case.** The step names the table, the table is empty,
    the student says done. Nothing is recorded and the model is told why."""
    cfg = _table_cfg([("a", "Udfyld tabellen Faldforsøg med dine målinger")], [_table()])
    out = _tools(cfg=cfg)["mark_checklist_item"]("a", True, "Eleven siger de er færdige", _Ctx())

    assert out["ok"] is False
    assert "Faldforsøg" in out["error"]
    assert "0 of 10" in out["error"]
    assert get_item_states(GROUP, ACTIVITY) == {}


def test_the_refusal_tells_the_model_what_to_do_instead():
    """A bare refusal leaves the model to guess, and it guesses by retrying."""
    cfg = _table_cfg([("a", "Udfyld tabellen Faldforsøg")], [_table()])
    err = _tools(cfg=cfg)["mark_checklist_item"]("a", True, "done", _Ctx())["error"].lower()
    assert "ask them to fill it in" in err
    assert "say-so" in err


def test_a_mark_still_succeeds_once_the_table_has_data():
    cfg = _table_cfg([("a", "Udfyld tabellen Faldforsøg")], [_table()])
    out = _tools(cfg=cfg)["mark_checklist_item"]("a", True, "målte tre gange", _Ctx(_table_state(filled=6)))
    assert out["ok"] is True
    assert get_item_states(GROUP, ACTIVITY)["a"]["done"] is True


def test_the_step_is_matched_by_the_kind_noun_when_there_is_one_table():
    """ "Udfyld tabellen" can only mean the single table on the activity."""
    cfg = _table_cfg([("a", "Udfyld tabellen")], [_table()])
    assert _tools(cfg=cfg)["mark_checklist_item"]("a", True, "done", _Ctx())["ok"] is False


# --- fail-open: everything uncertain marks exactly as before ---------------


def test_an_unrelated_step_is_not_refused():
    """The step is about a calculation on paper; the table is beside the point.
    A refusal here would block work the tutor legitimately witnessed."""
    cfg = _table_cfg([("a", "Forklar hvorfor accelerationen er konstant")], [_table()])
    assert _tools(cfg=cfg)["mark_checklist_item"]("a", True, "forklarede det korrekt", _Ctx())["ok"] is True


def test_a_step_naming_another_table_does_not_refuse_on_this_one():
    cfg = _table_cfg(
        [("a", "Udfyld tabellen Energiforsøg")], [_table(title="Faldforsøg"), _table("t2", "Energiforsøg")]
    )
    # "Energiforsøg" is empty too — so this SHOULD refuse, naming the right one.
    err = _tools(cfg=cfg)["mark_checklist_item"]("a", True, "done", _Ctx())["error"]
    assert "Energiforsøg" in err
    assert "Faldforsøg" not in err


def test_ambiguous_kind_reference_with_two_tables_fails_open():
    """ "Udfyld tabellen" with two tables names neither — allow the mark."""
    cfg = _table_cfg([("a", "Udfyld tabellen")], [_table(), _table("t2", "Anden")])
    assert _tools(cfg=cfg)["mark_checklist_item"]("a", True, "done", _Ctx())["ok"] is True


def test_no_tool_context_fails_open():
    """Nothing that reads session state may become a hard dependency of
    marking. If ADK stops injecting the context, marks keep working."""
    cfg = _table_cfg([("a", "Udfyld tabellen Faldforsøg")], [_table()])
    assert _tools(cfg=cfg)["mark_checklist_item"]("a", True, "done")["ok"] is True


def test_an_activity_with_no_elements_is_unaffected():
    assert _tools()["mark_checklist_item"]("a", True, "did it", _Ctx())["ok"] is True


def test_unmarking_is_never_refused():
    """A tutor correcting its own wrong tick must always be able to, and an
    empty table is exactly the situation where it needs to."""
    cfg = _table_cfg([("a", "Udfyld tabellen Faldforsøg")], [_table()])
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="premature")
    out = _tools(cfg=cfg)["mark_checklist_item"]("a", False, "tabellen er faktisk tom", _Ctx())
    assert out["ok"] is True
    assert get_item_states(GROUP, ACTIVITY)["a"]["done"] is False


# ---------------------------------------------------------------------------
# Inherited progress (1.1.70 M1 / PILOT-1 M3)
#
# Aswin, 2026-08-10: *"I stopped for a while and then previous chats were
# removed. I then started again with the same code, but then Jonas only asked
# me one question ... He then said already marked the learning goals."*
#
# Nothing malfunctioned to produce that. ``checklist_progress`` is keyed by
# (group, activity) and never by session — deliberately, because a group works
# across devices. The gap is that inherited progress and progress the tutor
# just watched happen read identically.
# ---------------------------------------------------------------------------


def test_the_block_carries_provenance_and_evidence():
    """A student can ask what was marked and why, and get the recorded answer."""
    _tools()["mark_checklist_item"]("a", True, "målte faldtiden tre gange og fik 0,45 s")
    summary = checklist_state_summary(_cfg(), _student())
    assert "by you (the AI)" in summary
    assert "0,45 s" in summary


def test_a_student_mark_is_attributed_to_the_student():
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="student")
    assert "by the student" in checklist_state_summary(_cfg(), _student())


def test_the_block_dates_each_mark():
    """Age is the fact that separates this morning's work from three weeks
    ago's, and it is already in the store."""
    from datetime import datetime as _dt

    _tools()["mark_checklist_item"]("a", True, "did it")
    assert f" on {_dt.now(UTC).date().isoformat()}" in checklist_state_summary(_cfg(), _student())


def test_it_points_at_the_first_outstanding_step_not_the_end():
    """The reported behaviour was a wrap-up after one question. This is the
    instruction that blocks it."""
    _tools()["mark_checklist_item"]("a", True, "did it")
    summary = checklist_state_summary(_cfg(), _student())
    assert 'Continue from "Beregn gennemsnittet"' in summary
    assert "first step that is NOT done" in summary


def test_all_steps_done_does_not_declare_the_activity_over():
    tools = _tools()
    tools["mark_checklist_item"]("a", True, "did it")
    tools["mark_checklist_item"]("b", True, "did it")
    summary = checklist_state_summary(_cfg(), _student())
    assert "check the student agrees" in summary


def test_no_progress_composes_exactly_as_before():
    assert checklist_state_summary(_cfg(), _student()) == ""


def test_a_teacher_preview_gets_no_progress_block():
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="x")
    assert checklist_state_summary(_cfg(), _teacher()) == ""


def test_only_this_groups_progress_is_reported():
    record_item_state(OTHER_GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="other group")
    assert checklist_state_summary(_cfg(), _student(GROUP)) == ""


def test_state_recorded_for_a_step_the_teacher_has_since_deleted_is_ignored():
    """A teacher editing the checklist must not leave the tutor reading marks
    against steps that no longer exist."""
    record_item_state(GROUP, ACTIVITY, "deleted-step", done=True, by="ai", evidence_summary="gone")
    assert checklist_state_summary(_cfg(), _student()) == ""
