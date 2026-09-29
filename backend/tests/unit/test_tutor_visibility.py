"""Ownership and visibility for tutors and custom approaches (TUTOR-2 M0).

M, 2026-09-28: *"lets have private and shared versions, but researchers always
see all."*

Three properties carry the whole milestone, and each one is a thing that breaks
something visible if it is wrong:

1. **ABSENT IS NOT PRIVATE.** A row written before the field existed reads as
   shared. Defaulting it to private would empty every class's tutor picker at
   once — four rows on prod, every one of them a base a class may be using.
2. **A private override hides itself, not the base.** An authored row shadowing
   a base is one person's override of a shared thing.
3. **The picker and the setter resolve the same way**, or a teacher picks a
   tutor the setter then refuses.
"""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.models.teaching_framework import TeachingFramework
from db.models.tutor import Tutor
from db.tutors import list_tutor_catalogue, resolve_tutor, resolve_tutor_for, save_tutor, set_visibility

OWNER = "teacher-a"
OTHER = "teacher-b"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _tutor(tutor_id: str, **kw) -> Tutor:
    return save_tutor(Tutor(id=tutor_id, displayName=tutor_id.title(), authorUid=OWNER, **kw), updated_by=OWNER)


# --- absent is not private -------------------------------------------------


def test_a_row_written_before_the_field_reads_as_shared():
    t = Tutor(id="legacy", displayName="Legacy")
    assert t.visibility is None
    assert t.effective_visibility == "shared"
    assert t.visible_to("anyone-at-all") is True


def test_the_four_seeded_rows_stay_pickable_for_everyone():
    """The migration case. These four exist on prod and test with no visibility
    field; a private default would take every one of them out of every
    picker."""
    for tid in ("concept-dialogue", "kinebot-kinematics-tutor", "led-planck-tutor", "problem-set-hints"):
        _tutor(tid)
    ids = {t.id for t in list_tutor_catalogue(OTHER)}
    assert {"concept-dialogue", "kinebot-kinematics-tutor", "led-planck-tutor", "problem-set-hints"} <= ids


# --- private means private from other TEACHERS -----------------------------


def test_a_private_tutor_is_the_owners_alone_and_the_researchers_too():
    _tutor("mine", visibility="private")
    assert "mine" in {t.id for t in list_tutor_catalogue(OWNER)}
    assert "mine" not in {t.id for t in list_tutor_catalogue(OTHER)}
    # M, 2026-09-28: "researchers always see all" — the lineage question 1.1.91
    # exists to answer is unanswerable over a filtered view.
    assert "mine" in {t.id for t in list_tutor_catalogue(OTHER, see_all=True)}


def test_sharing_is_one_call_and_reversible():
    _tutor("mine", visibility="private")
    set_visibility("mine", "shared")
    assert "mine" in {t.id for t in list_tutor_catalogue(OTHER)}
    set_visibility("mine", "private")
    assert "mine" not in {t.id for t in list_tutor_catalogue(OTHER)}


def test_an_internal_caller_with_no_uid_is_never_filtered():
    """The migration, the docs generator and analytics are not a person. A
    filtered read there would silently shorten what they operate on."""
    _tutor("mine", visibility="private")
    assert "mine" in {t.id for t in list_tutor_catalogue()}


# --- a private override hides itself, not the base -------------------------


def test_a_private_override_of_a_base_leaves_the_base_visible():
    _tutor("sofie", visibility="private")
    assert resolve_tutor_for("sofie", OTHER) is not None
    assert resolve_tutor_for("sofie", OTHER).display_name != "Sofie"  # the YAML base, not the override
    assert "sofie" in {t.id for t in list_tutor_catalogue(OTHER)}


def test_the_owner_sees_their_own_override():
    _tutor("sofie", visibility="private")
    assert resolve_tutor_for("sofie", OWNER).display_name == "Sofie"


# --- the agent path is NOT filtered ----------------------------------------


def test_resolve_tutor_stays_unfiltered_because_it_is_the_agent_path():
    """⚠️ The one that would be a passthrough-guarantee break from a new angle.

    A student's lesson resolving the tutor its class was given has no uid. If
    ``resolve_tutor`` filtered, a teacher marking their tutor private would
    silently change what their own class is being taught with, mid-term.
    """
    _tutor("mine", visibility="private")
    assert resolve_tutor("mine") is not None


# --- custom approaches, same rules -----------------------------------------


def test_an_approach_follows_the_same_absent_and_private_rules():
    published = TeachingFramework(id="esru", label="ESRU", layer="conceptual")
    assert published.visible_to(OTHER) is True  # the literature is never someone's draft

    legacy = TeachingFramework(id="custom-x", label="X", layer="custom", authorUid=OWNER)
    assert legacy.visible_to(OTHER) is True  # absent reads as shared

    drafted = TeachingFramework(id="custom-y", label="Y", layer="custom", authorUid=OWNER, visibility="private")
    assert drafted.visible_to(OWNER) is True
    assert drafted.visible_to(OTHER) is False
    assert drafted.visible_to(OTHER, see_all=True) is True
