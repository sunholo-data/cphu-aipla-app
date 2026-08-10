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
    """
    import inspect

    params = inspect.signature(_tools()["mark_checklist_item"]).parameters
    assert "group_id" not in params
    assert set(params) == {"item_id", "done", "evidence_summary"}


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
    assert "a" in summary


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
