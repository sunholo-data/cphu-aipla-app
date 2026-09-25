"""The append-only evidence record and its reduction (CONCEPT-2 M2).

Until 2026-09-25 a node held ONE replaceable ``{status, evidence, updatedAt}``
slot. One writer made that survivable; ``mark_concept`` is the second, and a
slot cannot represent the thing a year of a class's map is most interesting
for — that a deliberate checkpoint said *partial* in September and a passive
read said *demonstrated* in February.

The rules pinned here are the whole design:

* ``teacher`` wins, permanently — the half that makes ``teacher_focus``'s
  standing promise ("the teacher can override it") true.
* otherwise the most recent record wins, so a re-check can lower a concept;
* except that an ``observed`` record may RAISE but never LOWER what a
  ``checkpoint`` established.
"""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.concept_progress import (
    MAX_RECORDS_PER_NODE,
    derive_status,
    get_node_states,
    record_checkpoint_state,
    record_concept_evidence,
    states_from_stored,
)

GROUP = "grp-7b"
ACT = "act-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _rec(kind: str, status: str, at: str = "2026-09-01T00:00:00+00:00") -> dict:
    return {"kind": kind, "status": status, "summary": "", "activityId": ACT, "at": at}


# --- the reduction ---------------------------------------------------------


def test_no_evidence_reads_not_yet():
    assert derive_status([]) == "not_yet"


def test_the_most_recent_record_wins_between_equals():
    """A re-check CAN lower a concept. A group that has gone cold on something
    it demonstrated in September is the case this exists for; freezing the
    high-water mark would make the map a record of the best day, not of now."""
    assert derive_status([_rec("checkpoint", "demonstrated"), _rec("checkpoint", "partial")]) == "partial"
    assert derive_status([_rec("observed", "partial"), _rec("observed", "demonstrated")]) == "demonstrated"


def test_an_observed_record_cannot_lower_a_checkpoint():
    """A passive misread must not undo a deliberate pass. This is the one that
    makes the passive marker safe enough to ship at all."""
    assert derive_status([_rec("checkpoint", "demonstrated"), _rec("observed", "partial")]) == "demonstrated"


def test_an_observed_record_may_raise_a_checkpoint():
    """The mirror, and NOT symmetric with the rule above on purpose: between
    checkpoints a student does learn things, and a map that can only be moved
    on by a formal check goes stale exactly when the lesson is going well."""
    assert derive_status([_rec("checkpoint", "partial"), _rec("observed", "demonstrated")]) == "demonstrated"


def test_a_teacher_record_outranks_everything_and_survives_later_ai_marks():
    records = [
        _rec("checkpoint", "demonstrated"),
        _rec("teacher", "partial"),
        _rec("observed", "demonstrated"),
        _rec("checkpoint", "demonstrated"),
    ]
    assert derive_status(records) == "partial"


def test_the_most_recent_teacher_record_is_the_one_that_stands():
    records = [_rec("teacher", "not_yet"), _rec("teacher", "demonstrated")]
    assert derive_status(records) == "demonstrated"


# --- append, not replace ---------------------------------------------------


def test_writes_accumulate_and_keep_their_provenance():
    record_checkpoint_state(GROUP, ACT, "vektorer", "partial", "usikker på komposanter")
    record_concept_evidence(GROUP, ACT, "vektorer", "demonstrated", "delte 30°-kastet selv", kind="observed")
    node = get_node_states(GROUP, ACT)["vektorer"]
    assert [r["kind"] for r in node["evidence"]] == ["checkpoint", "observed"]
    assert node["evidence"][0]["summary"] == "usikker på komposanter"
    assert node["status"] == "demonstrated"


def test_a_write_to_one_node_leaves_the_others_alone():
    record_checkpoint_state(GROUP, ACT, "vektorer", "demonstrated", "ok")
    record_concept_evidence(GROUP, ACT, "projektil", "partial", "blandede vx og vy", kind="observed")
    states = get_node_states(GROUP, ACT)
    assert states["vektorer"]["status"] == "demonstrated"
    assert len(states["vektorer"]["evidence"]) == 1


def test_another_group_is_untouched():
    record_checkpoint_state(GROUP, ACT, "vektorer", "demonstrated", "ok")
    assert get_node_states("grp-other", ACT) == {}


def test_every_record_carries_the_activity_it_came_from():
    """Within one document that is constant — but the class rollup (M4) merges
    records for the same concept ACROSS activities, and a record that cannot say
    where it came from is unattributable there."""
    record_checkpoint_state(GROUP, ACT, "vektorer", "demonstrated", "ok")
    assert get_node_states(GROUP, ACT)["vektorer"]["evidence"][0]["activityId"] == ACT


# --- bounded growth --------------------------------------------------------


def test_the_record_is_capped():
    for i in range(MAX_RECORDS_PER_NODE + 5):
        record_concept_evidence(GROUP, ACT, "vektorer", "partial", f"mark {i}", kind="observed")
    assert len(get_node_states(GROUP, ACT)["vektorer"]["evidence"]) == MAX_RECORDS_PER_NODE


def test_the_cap_never_drops_the_record_the_status_rests_on():
    """The trim keeps the newest of each KIND first. Dropping the one teacher
    override under a flurry of passive marks would silently hand the concept
    back to the AI — a cap that changes an answer is a bug, not a budget."""
    record_concept_evidence(GROUP, ACT, "vektorer", "partial", "teacher says not yet", kind="teacher")
    for i in range(MAX_RECORDS_PER_NODE + 3):
        record_concept_evidence(GROUP, ACT, "vektorer", "demonstrated", f"mark {i}", kind="observed")
    node = get_node_states(GROUP, ACT)["vektorer"]
    assert len(node["evidence"]) == MAX_RECORDS_PER_NODE
    assert any(r["kind"] == "teacher" for r in node["evidence"])
    assert node["status"] == "partial"


# --- the old shape ---------------------------------------------------------


def test_a_pre_concept2_document_is_migrated_on_read():
    """Two documents existed in prod when this changed. They are read through
    the same helper rather than by a migration script, so there is never a
    window where some documents are one shape and some the other."""
    old = {
        "vektorer": {
            "status": "demonstrated",
            "evidence": {"kind": "checkpoint", "summary": "forklarede det selv"},
            "updatedAt": "2026-08-21T12:19:01.968373+00:00",
        }
    }
    states = states_from_stored(old)
    assert states["vektorer"]["status"] == "demonstrated"
    assert states["vektorer"]["evidence"] == [
        {
            "kind": "checkpoint",
            "status": "demonstrated",
            "summary": "forklarede det selv",
            "activityId": "",
            "at": "2026-08-21T12:19:01.968373+00:00",
        }
    ]


def test_writing_to_a_pre_concept2_document_keeps_its_history():
    """The old slot becomes the FIRST record rather than being overwritten —
    otherwise migrating would itself destroy the only evidence those two prod
    documents hold."""
    fs_module.get_client().collection("concept_progress").document(f"{GROUP}:{ACT}").set(
        {
            "groupId": GROUP,
            "activityId": ACT,
            "nodeStates": {
                "vektorer": {
                    "status": "demonstrated",
                    "evidence": {"kind": "checkpoint", "summary": "gammel evidens"},
                    "updatedAt": "2026-08-21T12:19:01+00:00",
                }
            },
        }
    )
    record_concept_evidence(GROUP, ACT, "vektorer", "partial", "ny observation", kind="observed")
    node = get_node_states(GROUP, ACT)["vektorer"]
    assert [r["summary"] for r in node["evidence"]] == ["gammel evidens", "ny observation"]
    # ...and the old checkpoint still outranks the new passive mark
    assert node["status"] == "demonstrated"
