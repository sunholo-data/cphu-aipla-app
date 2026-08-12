"""force_seed_demo — reconcile the demo set into existing teachers (1.1.73 follow-up).

This script had no tests, and both bugs it shipped were the kind tests catch:

1. **It could only CREATE.** Matching by title meant an activity that already
   existed was never touched again, so when Hookes lov gained a writing element
   the teachers who already had a Demo class kept the old version — the exact
   opposite of who a reseed is for.
2. **A failed join-code mint destroyed the run.** The mint happened BEFORE the
   activities were assigned, so when it raised (no GROUP_AUTH_SIGNING_SECRET on
   a laptop) it left a teacher with an empty Demo class and nine orphaned
   activities. Observed on test, 2026-08-12.
"""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.activities import create_activity, get_activity
from db.classes import add_activities, create_class, list_classes_for_owner
from db.models.activity import Activity
from db.models.activity_config import ChecklistItem, NoteElement, WritingElement
from db.models.class_ import Class
from onboarding.demo_seed import DEMO_CLASS_NAME
from scripts.force_seed_demo import _element_gaps, seed_owner

TEACHER = "teacher-1"
SKILL = "concept-skill"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _demo_class(owner: str = TEACHER) -> Class:
    cls = Class.create_for_teacher(owner_uid=owner, name=DEMO_CLASS_NAME)
    create_class(cls)
    return cls


def _canonical(title: str = "Hookes lov — fjederkraft") -> Activity:
    """A demo activity as the CURRENT demo set defines it."""
    return Activity(
        activityId="",
        ownerUid=TEACHER,
        skillId=SKILL,
        title=title,
        note=[NoteElement(id="n", title="Hookes lov", body="F = k · x")],
        checklist=[ChecklistItem(id="a", label="Opstil fjederen")],
        writing=[WritingElement(id="konklusion", title="Konklusion", prompt="Skriv jeres konklusion", minWords=100)],
    )


# --- the gap rule ----------------------------------------------------------


def test_an_empty_field_is_filled_from_the_current_demo_set() -> None:
    existing = _canonical()
    existing.writing = []  # the teacher's copy predates the element
    fills, diffs = _element_gaps(existing, _canonical())
    assert "writing" in fills
    assert fills["writing"][0].title == "Konklusion"
    assert diffs == []


def test_a_populated_field_is_never_overwritten() -> None:
    """The timid half, and the important one: a teacher may have edited their
    demo copy, and silently replacing their work to deliver a starter element
    would be a worse bug than the one this fixes."""
    existing = _canonical()
    existing.writing = [WritingElement(id="mine", title="Min egen", prompt="noget jeg selv skrev")]
    fills, _ = _element_gaps(existing, _canonical())
    assert "writing" not in fills


def test_a_populated_field_that_differs_is_reported_not_written() -> None:
    existing = _canonical()
    existing.checklist = [ChecklistItem(id="a", label="Opstil"), ChecklistItem(id="b", label="Mål")]
    fills, diffs = _element_gaps(existing, _canonical())
    assert "checklist" not in fills
    assert "checklist" in diffs


def test_nothing_to_fill_when_the_copy_is_current() -> None:
    fills, diffs = _element_gaps(_canonical(), _canonical())
    assert fills == {}
    assert diffs == []


# --- seed_owner ------------------------------------------------------------


def test_an_existing_activity_gains_the_new_element(monkeypatch) -> None:
    """The headline bug. A teacher who already has the demo set must receive an
    element the set has since gained."""
    cls = _demo_class()
    stale = _canonical()
    stale.writing = []
    aid = create_activity(stale).activity_id
    add_activities(cls.class_id, [aid])

    monkeypatch.setattr("scripts.force_seed_demo._demo_activities", lambda uid, skill: [_canonical()])
    summary = seed_owner(TEACHER, SKILL, dry_run=False)

    assert summary["created"] == 0, "it already exists — do not duplicate it"
    assert summary["updated"] == 1
    assert [w.title for w in get_activity(aid).writing] == ["Konklusion"]


def test_dry_run_writes_nothing(monkeypatch) -> None:
    cls = _demo_class()
    stale = _canonical()
    stale.writing = []
    aid = create_activity(stale).activity_id
    add_activities(cls.class_id, [aid])

    monkeypatch.setattr("scripts.force_seed_demo._demo_activities", lambda uid, skill: [_canonical()])
    summary = seed_owner(TEACHER, SKILL, dry_run=True)

    assert summary["toUpdate"] == ["Hookes lov — fjederkraft (+writing)"]
    assert get_activity(aid).writing == [], "a dry run must not write"


def test_a_teacher_edit_survives_the_reseed(monkeypatch) -> None:
    cls = _demo_class()
    edited = _canonical()
    edited.writing = [WritingElement(id="mine", title="Min egen", prompt="noget jeg selv skrev")]
    aid = create_activity(edited).activity_id
    add_activities(cls.class_id, [aid])

    monkeypatch.setattr("scripts.force_seed_demo._demo_activities", lambda uid, skill: [_canonical()])
    seed_owner(TEACHER, SKILL, dry_run=False)

    assert [w.title for w in get_activity(aid).writing] == ["Min egen"]


def test_a_failed_join_code_mint_does_not_strand_the_activities(monkeypatch) -> None:
    """The partial-write bug, netted.

    The mint needs GROUP_AUTH_SIGNING_SECRET, which a laptop usually lacks. When
    it raised BEFORE the assignment, the run left an empty Demo class and nine
    orphans. The activities must survive it.
    """

    def _boom(*_a, **_k):
        raise RuntimeError("GROUP_AUTH_SIGNING_SECRET env var is required")

    monkeypatch.setattr("scripts.force_seed_demo.mint_group_codes_under_class", _boom)
    monkeypatch.setattr("scripts.force_seed_demo._demo_activities", lambda uid, skill: [_canonical()])

    summary = seed_owner(TEACHER, SKILL, dry_run=False)

    assert summary["created"] == 1
    assert "mintFailed" in summary, "a failed mint must be reported, not swallowed"
    demo = next(c for c in list_classes_for_owner(TEACHER) if c.name == DEMO_CLASS_NAME)
    assert len(demo.activity_ids or []) == 1, "the activity must be assigned, not orphaned"


def test_missing_activities_are_still_created(monkeypatch) -> None:
    """The original behaviour, unbroken."""
    _demo_class()
    monkeypatch.setattr("scripts.force_seed_demo._demo_activities", lambda uid, skill: [_canonical()])
    summary = seed_owner(TEACHER, SKILL, dry_run=False)
    assert summary["created"] == 1
    demo = next(c for c in list_classes_for_owner(TEACHER) if c.name == DEMO_CLASS_NAME)
    assert len(demo.activity_ids or []) == 1
