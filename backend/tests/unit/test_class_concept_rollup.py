"""The class-level concept picture (CONCEPT-2 M4).

The headline, and the reason this file exists at all: **a class's view of a
concept is the SPREAD of its groups, never a union.** 1.1.121 M0 proposed the
union; M ruled it out on 2026-09-25 — *"the class level may disagree with group
level mastery, and indeed we want to help link groups that are mastering
different trees"* — because a union is precisely what makes that invisible.

The other correction pinned here: concepts join on a normalised LABEL, not on
node ids. Template copies share ids (55 of the 56 maps on prod came from three
templates) so a test built only on those would pass against the bug.
"""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.activities import create_activity
from db.class_concept_rollup import (
    class_concept_distribution,
    normalise_concept,
    suggest_activity_links,
)
from db.concept_progress import record_concept_evidence
from db.models.activity import Activity
from db.models.activity_config import ConceptMapElement, ConceptNode

CLASS = "cls-7b"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _activity(activity_id: str, *nodes: tuple[str, str]) -> str:
    """An activity whose map carries (node_id, label) pairs."""
    create_activity(
        Activity(
            activityId=activity_id,
            ownerUid="t-1",
            conceptMap=[
                ConceptMapElement(
                    id="cm",
                    nodes=[ConceptNode(id=nid, label=label) for nid, label in nodes],
                )
            ],
        )
    )
    return activity_id


def _mark(group: str, activity: str, node: str, status: str, kind: str = "checkpoint") -> None:
    record_concept_evidence(group, activity, node, status, "evidens", kind=kind, class_id=CLASS)


# --- the spread ------------------------------------------------------------


def test_a_concept_reports_every_group_separately_not_a_union():
    """THE test. Under 1.1.121's union this concept reads "the class has
    vektorer" and the teacher cannot see that half the room does not."""
    _activity("act-1", ("vektorer", "Vektorer"))
    _mark("grp-a", "act-1", "vektorer", "demonstrated")
    _mark("grp-b", "act-1", "vektorer", "not_yet")
    _mark("grp-c", "act-1", "vektorer", "partial")

    out = class_concept_distribution(CLASS)
    concept = out["concepts"][0]
    assert concept["concept"] == "Vektorer"
    assert concept["byGroup"] == {"grp-a": "demonstrated", "grp-b": "not_yet", "grp-c": "partial"}
    assert concept["counts"] == {"not_yet": 1, "partial": 1, "demonstrated": 1}


def test_a_group_with_no_record_is_absent_rather_than_not_yet():
    """ "Has not shown it" and "never met it" are different facts about a class.
    Flattening them here would make the weakest reading the default one; the
    caller holds the class's group codes and can name the difference."""
    _activity("act-1", ("vektorer", "Vektorer"))
    _mark("grp-a", "act-1", "vektorer", "demonstrated")
    concept = class_concept_distribution(CLASS)["concepts"][0]
    assert list(concept["byGroup"]) == ["grp-a"]
    assert sum(concept["counts"].values()) == 1


def test_an_empty_or_unstamped_class_reports_nothing_rather_than_guessing():
    assert class_concept_distribution("cls-none") == {"classId": "cls-none", "groups": [], "concepts": []}
    assert class_concept_distribution("") == {"classId": "", "groups": [], "concepts": []}


# --- the join --------------------------------------------------------------


def test_the_same_concept_in_two_activities_with_DIFFERENT_node_ids_is_one_concept():
    """The correction to 1.1.121's "shares node ids". Two independently authored
    maps never share an id, so joining on ids would show a class two nodes for
    one concept — the opposite of the point of a class-level view."""
    _activity("act-1", ("vektorer", "Vektorer"))
    _activity("act-2", ("node-3", "vektorer "))  # different id, same concept, sloppy case
    _mark("grp-a", "act-1", "vektorer", "partial")
    _mark("grp-a", "act-2", "node-3", "demonstrated")

    concepts = class_concept_distribution(CLASS)["concepts"]
    assert len(concepts) == 1
    assert sorted(concepts[0]["activityIds"]) == ["act-1", "act-2"]
    assert sorted(concepts[0]["nodeIds"]) == ["node-3", "vektorer"]


def test_one_group_meeting_a_concept_twice_keeps_its_better_showing():
    """The one place a union IS right, and its scope is a single group: they met
    it in two activities and got it in one. Across groups the spread stands."""
    _activity("act-1", ("a", "Vektorer"))
    _activity("act-2", ("b", "Vektorer"))
    _mark("grp-a", "act-1", "a", "partial")
    _mark("grp-a", "act-2", "b", "demonstrated")
    assert class_concept_distribution(CLASS)["concepts"][0]["byGroup"] == {"grp-a": "demonstrated"}


def test_a_record_whose_node_was_deleted_from_the_map_is_kept_under_its_id():
    """A teacher editing a map after a lesson must not delete the class's
    history of it. A silently shorter aggregate is the worse error."""
    _activity("act-1", ("kept", "Kept"))
    _mark("grp-a", "act-1", "gone", "demonstrated")
    labels = [c["concept"] for c in class_concept_distribution(CLASS)["concepts"]]
    assert "gone" in labels


def test_normalise_merges_case_and_whitespace_and_nothing_else():
    assert normalise_concept("  Vektorer ") == normalise_concept("vektorer")
    # Synonyms are an ALIASING problem. Guessing at them would overstate a
    # class's coverage, and this number is read as evidence.
    assert normalise_concept("Vektorer") != normalise_concept("Vektorregning")


def test_only_this_class_is_counted():
    _activity("act-1", ("vektorer", "Vektorer"))
    _mark("grp-a", "act-1", "vektorer", "demonstrated")
    record_concept_evidence("grp-z", "act-1", "vektorer", "demonstrated", "x", class_id="cls-other")
    assert class_concept_distribution(CLASS)["groups"] == ["grp-a"]


def test_an_unbound_group_lands_in_no_class_rollup():
    """A workshop session carries no class tag, so it is stamped with nothing
    and belongs to no class — rather than being attributed to a guess."""
    _activity("act-1", ("vektorer", "Vektorer"))
    record_concept_evidence("grp-workshop", "act-1", "vektorer", "demonstrated", "x")
    assert class_concept_distribution(CLASS)["concepts"] == []


# --- activity links --------------------------------------------------------


def test_activities_sharing_a_concept_are_a_candidate_link():
    _activity("act-1", ("vektorer", "Vektorer"), ("trig", "Trigonometri"))
    _activity("act-2", ("v2", "vektorer"), ("kast", "Kastebevægelse"))
    _activity("act-3", ("bolger", "Bølger"))

    links = suggest_activity_links("act-1", ["act-2", "act-3"])
    assert links == [{"toActivityId": "act-2", "viaConcepts": ["Vektorer"]}]


def test_link_suggestion_never_proposes_an_activity_against_itself_or_a_mapless_one():
    _activity("act-1", ("vektorer", "Vektorer"))
    create_activity(Activity(activityId="act-bare", ownerUid="t-1"))
    assert suggest_activity_links("act-1", ["act-1", "act-bare", "act-missing"]) == []
    assert suggest_activity_links("act-bare", ["act-1"]) == []
