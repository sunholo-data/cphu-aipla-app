"""Unit tests for adk.concept_steering — the map as a boundary and a frontier (CONCEPT-2 M0).

M, 2026-09-25: *"tutors stray from the lesson plans despite keeping character."*

The tutor already had the map (``teacher_focus``) and the group's live statuses
(``progress_context``). What it lacked was any reason to treat either as a
limit, and anything saying what to do next. Two properties matter more than the
wording here, and both have a test that fails if they are lost:

1. The boundary **licenses a brief excursion and requires a return** — 1.1.90 is
   explicit that the maps guide *"while allowing for limited deviation"*, and a
   tutor that refuses every off-map remark is a worse tutor than one that wanders.
2. The frontier is a **pure function of the authored edges and the stored
   states** — never the model's inference, and never a downgrade of ``partial``.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from adk.concept_steering import CONCEPT_STEERING_CAP, build_concept_steering_block
from auth.firebase_auth import User
from db import firestore as fs_module
from db.concept_progress import record_checkpoint_state
from db.models.activity_config import (
    ActivityConfig,
    ConceptEdge,
    ConceptMapElement,
    ConceptNode,
)

GROUP = "sweet-bison-13"
ACTIVITY = "act-kast"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _cfg(*, concept_map: bool = True, nodes: list[ConceptNode] | None = None, edges=None) -> ActivityConfig:
    """The shipped prod map shape: vektorer + trigonometri both feed projektil."""
    return ActivityConfig(
        activityId=ACTIVITY,
        classId="c1",
        teacherUid="t1",
        updatedAt=datetime.now(UTC),
        conceptMap=(
            [
                ConceptMapElement(
                    id="cm",
                    title="Kastebevægelse",
                    nodes=nodes
                    if nodes is not None
                    else [
                        ConceptNode(id="vektorer", label="Vektorer"),
                        ConceptNode(id="trigonometri", label="Trigonometri"),
                        ConceptNode(id="projektil", label="Projektilbevægelse"),
                    ],
                    edges=edges
                    if edges is not None
                    else [
                        ConceptEdge(**{"from": "vektorer", "to": "projektil"}),
                        ConceptEdge(**{"from": "trigonometri", "to": "projektil"}),
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


def _demonstrate(*node_ids: str) -> None:
    for node_id in node_ids:
        record_checkpoint_state(GROUP, ACTIVITY, node_id, "demonstrated", "forklarede det selv")


# --- when it composes at all ---------------------------------------------


def test_an_activity_without_a_concept_map_composes_nothing():
    """224 of the 280 activities on prod (2026-09-25) have no map. They must
    compose byte-identically to before this module existed."""
    assert build_concept_steering_block(_cfg(concept_map=False), _student()) == ""


def test_no_activity_at_all_composes_nothing():
    assert build_concept_steering_block(None, _student()) == ""


def test_an_empty_map_composes_nothing():
    """A teacher who added the element and has not filled it in yet has
    authored no boundary, so there is none to state."""
    assert build_concept_steering_block(_cfg(nodes=[], edges=[]), _student()) == ""


def test_a_teacher_is_not_bounded_by_the_lesson_map():
    """The authoring co-pilot is not inside the lesson. Bounding it to the map
    the teacher is currently editing would be actively wrong — and it has no
    group whose frontier could be computed anyway."""
    assert build_concept_steering_block(_cfg(), _teacher()) == ""


# --- the boundary --------------------------------------------------------


def test_the_boundary_licenses_the_excursion_and_requires_the_return():
    """1.1.90's counter-requirement, pinned as a unit assertion so the wording
    cannot drift into a prohibition without this failing. A tutor that refuses
    every off-map remark is the worse of the two bugs."""
    out = build_concept_steering_block(_cfg(), _student()).lower()
    assert "take it seriously for a turn" in out
    assert "bring the conversation back" in out
    assert "never refuse a question" in out


def test_the_boundary_does_not_forbid_departure():
    out = build_concept_steering_block(_cfg(), _student()).lower()
    for prohibition in ("do not answer", "refuse to", "only discuss", "must not discuss"):
        assert prohibition not in out


def test_a_tangent_that_leads_back_is_named_as_not_a_digression():
    """The student's own route into a concept is the teachable moment; the
    block must not make the tutor police it."""
    out = build_concept_steering_block(_cfg(), _student())
    assert "is not a digression" in out


def test_the_boundary_forbids_widening_the_lesson_rather_than_deepening_it():
    out = build_concept_steering_block(_cfg(), _student()).lower()
    assert "do not open concepts of your own" in out
    assert "covering more is not" in out


# --- the frontier --------------------------------------------------------


def test_with_nothing_recorded_the_frontier_is_the_roots():
    """Turn one. No special case in the implementation — a root has no
    prerequisites, so "all demonstrated" is vacuously true."""
    out = build_concept_steering_block(_cfg(), _student())
    assert '"Vektorer"' in out
    assert '"Trigonometri"' in out
    assert '"Projektilbevægelse"' not in out


def test_a_node_is_not_on_the_frontier_until_every_prerequisite_is_demonstrated():
    """Projektilbevægelse builds on BOTH. One is not enough — this is the
    property that makes the map a plan rather than a checklist."""
    _demonstrate("vektorer")
    out = build_concept_steering_block(_cfg(), _student())
    assert '"Projektilbevægelse"' not in out
    assert '"Trigonometri"' in out
    assert '"Vektorer"' not in out  # already demonstrated, so no longer "next"


def test_the_frontier_opens_when_the_last_prerequisite_lands():
    _demonstrate("vektorer", "trigonometri")
    out = build_concept_steering_block(_cfg(), _student())
    assert '"Projektilbevægelse"' in out


def test_a_partial_node_stays_on_the_frontier():
    """Half-understood is exactly where the tutor should still be working, so
    ``partial`` must not read as done."""
    record_checkpoint_state(GROUP, ACTIVITY, "vektorer", "partial", "usikker på komposanter")
    out = build_concept_steering_block(_cfg(), _student())
    assert '"Vektorer"' in out


def test_a_node_whose_prerequisite_is_only_partial_is_not_on_the_frontier():
    """The mirror of the above, and the one a naive "not not_yet" check gets
    wrong."""
    record_checkpoint_state(GROUP, ACTIVITY, "vektorer", "partial", "usikker")
    _demonstrate("trigonometri")
    out = build_concept_steering_block(_cfg(), _student())
    assert '"Projektilbevægelse"' not in out


def test_a_finished_map_says_consolidate_rather_than_leaving_the_tutor_to_infer():
    """With no frontier named, the likeliest inference is to wrap up — which is
    the 1.1.70 "Jonas already marked the learning goals" failure in a different
    costume."""
    _demonstrate("vektorer", "trigonometri", "projektil")
    out = build_concept_steering_block(_cfg(), _student()).lower()
    assert "consolidate" in out
    assert "rather than opening new ground" in out


def test_the_frontier_is_a_suggestion_not_an_order():
    """A tutor that reads the frontier as a running order is a worse tutor than
    one that wanders — it railroads a student who wants to come at the lesson
    their own way."""
    out = build_concept_steering_block(_cfg(), _student())
    assert "not an order to work through" in out


# --- budget ---------------------------------------------------------------


def test_a_maximal_map_stays_within_the_cap():
    """30 nodes is the model's maximum and the whole map is an antichain here,
    so this is the widest frontier the schema permits."""
    nodes = [ConceptNode(id=f"n{i}", label=f"Begreb nummer {i} med en lang etiket") for i in range(30)]
    out = build_concept_steering_block(_cfg(nodes=nodes, edges=[]), _student())
    assert len(out) <= CONCEPT_STEERING_CAP
    assert "(+" in out  # the overflow is reported, not silently dropped


def test_an_unreadable_store_still_composes_the_boundary(monkeypatch):
    """A read failure must never cost a session. The frontier is lost; the
    boundary — the half that answers the actual report — is not."""
    monkeypatch.setattr(
        "adk.concept_steering.get_node_states",
        lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("firestore down")),
    )
    out = build_concept_steering_block(_cfg(), _student())
    assert "The edges of this lesson" in out
