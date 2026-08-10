"""Unit tests for adk.progress_context — inherited progress, labelled (1.1.70 M1).

Aswin, 2026-08-10: *"I stopped for a while and then previous chats were
removed. I then started again with the same code, but then Jonas only asked me
one question and I answered it correctly. He then said already marked the
learning goals."*

Nothing malfunctioned to produce that. The stores are keyed by (group,
activity) and never by session — deliberately, because a group works across
devices and progress that died with a tab would be the worse bug. The gap was
that inherited progress and progress the tutor watched happen read identically.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.progress_context import compose_progress_context
from auth.firebase_auth import User
from db import firestore as fs_module
from db.checklist_progress import record_item_state
from db.concept_progress import record_checkpoint_state
from db.models.activity_config import (
    ActivityConfig,
    ChecklistItem,
    ConceptMapElement,
    ConceptNode,
)

GROUP = "sweet-bison-13"
ACTIVITY = "act-boelger"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _cfg(*, checklist=True, concept_map=False) -> ActivityConfig:
    return ActivityConfig(
        activityId=ACTIVITY,
        classId="c1",
        teacherUid="t1",
        updatedAt=datetime.now(UTC),
        checklist=(
            [ChecklistItem(id="a", label="Mål bølgelængden"), ChecklistItem(id="b", label="Beregn frekvensen")]
            if checklist
            else []
        ),
        conceptMap=(
            [
                ConceptMapElement(
                    id="cm",
                    title="Bølger",
                    nodes=[
                        ConceptNode(id="staaende", label="Stående bølger"),
                        ConceptNode(id="mu", label="Massetæthed"),
                    ],
                )
            ]
            if concept_map
            else []
        ),
    )


def _student(group_id: str = GROUP) -> User:
    return User(uid=f"group:{group_id}", email="", group_id=group_id)


def _teacher() -> User:
    return User(uid="t1", email="teacher@example.dk")


# --- The contract, stated once for both stores ---------------------------


def test_the_contract_says_the_record_is_not_a_memory():
    """The behavioural core. Everything else here is bookkeeping around it."""
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="målte 3/2 bølgelængder")
    out = compose_progress_context(_cfg(), _student())
    assert "NOT to this conversation" in out
    assert "not a memory of yours" in out


def test_the_contract_does_not_assert_the_tutor_failed_to_witness_it():
    """1.1.70's draft wording was *"progress from an EARLIER session, which you
    did not witness"*. That premise assumed the block is composed once per
    session — but ``create_agent_with_thinking`` is called per REQUEST, so a
    build-time block is a per-turn block, and the assertion would be false from
    turn two onward about marks the tutor made itself.

    The contract asks the model to compare against its own conversation
    instead. This test pins that difference so the stronger claim cannot be
    reinstated without someone re-reading why."""
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="x")
    out = compose_progress_context(_cfg(), _student()).lower()
    assert "did not witness" not in out
    assert "if you do not find the work in the conversation you are actually in" in out


def test_the_contract_forbids_re_testing_and_permits_revisiting():
    """Two failure modes, opposite directions. Re-verifying everything punishes
    the student for our bookkeeping; treating a mark as final railroads one who
    has actually forgotten."""
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="x")
    out = compose_progress_context(_cfg(), _student())
    assert "Do not re-test it" in out
    assert "not a verdict" in out
    assert "continue from what is still outstanding rather than wrapping up" in out


def test_the_contract_is_stated_once_for_both_stores():
    """Written as two independent blocks each carried its own near-identical
    contract — the same instruction twice, for the model to reconcile, at ~450
    characters of a budget already shared seven ways."""
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="x")
    record_checkpoint_state(GROUP, ACTIVITY, "staaende", "demonstrated", "y")
    out = compose_progress_context(_cfg(concept_map=True), _student())
    assert out.count("not a memory of yours") == 1


# --- Composition ---------------------------------------------------------


def test_both_stores_are_composed():
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="målte")
    record_checkpoint_state(GROUP, ACTIVITY, "staaende", "demonstrated", "forklarede")
    out = compose_progress_context(_cfg(concept_map=True), _student())
    assert "Checklist progress already recorded" in out
    assert "Concept checkpoints already recorded" in out


def test_one_store_alone_still_composes():
    record_checkpoint_state(GROUP, ACTIVITY, "staaende", "demonstrated", "forklarede")
    out = compose_progress_context(_cfg(checklist=False, concept_map=True), _student())
    assert "Concept checkpoints already recorded" in out
    assert "Checklist progress" not in out
    assert "not a memory of yours" in out


def test_no_progress_composes_exactly_as_before():
    assert compose_progress_context(_cfg(concept_map=True), _student()) == ""
    assert compose_progress_context(None, _student()) == ""


def test_a_teacher_preview_gets_nothing():
    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="x")
    assert compose_progress_context(_cfg(), _teacher()) == ""


def test_only_this_groups_progress_is_composed():
    record_item_state("another-group", ACTIVITY, "a", done=True, by="ai", evidence_summary="x")
    assert compose_progress_context(_cfg(), _student(GROUP)) == ""


def test_a_failing_store_read_does_not_cost_the_session(monkeypatch):
    """A tutor with no progress context behaves as it did last week; one that
    500s helps nobody."""
    import adk.progress_context as mod

    def _boom(*_a, **_k):
        raise RuntimeError("firestore is having a day")

    monkeypatch.setattr(mod, "checklist_state_summary", _boom)
    record_checkpoint_state(GROUP, ACTIVITY, "staaende", "demonstrated", "forklarede")
    out = compose_progress_context(_cfg(concept_map=True), _student())
    assert "Concept checkpoints already recorded" in out
