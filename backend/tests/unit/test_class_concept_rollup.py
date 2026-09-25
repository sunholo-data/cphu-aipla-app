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
    complementary_pairs,
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


def _link(activity_id: str, src: str, dst: str) -> None:
    """Add a prerequisite edge to a seeded activity's map."""
    from db.activities import get_activity, save_activity
    from db.models.activity_config import ConceptEdge

    a = get_activity(activity_id)
    assert a is not None
    a.concept_map[0].edges.append(ConceptEdge.model_validate({"from": src, "to": dst}))
    save_activity(a)


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
    empty = {"groups": [], "concepts": [], "edges": []}
    assert class_concept_distribution("cls-none") == {"classId": "cls-none", **empty}
    assert class_concept_distribution("") == {"classId": "", **empty}


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


def test_prerequisite_edges_survive_the_join_across_activities():
    """The class graph is a CONCEPT graph: each activity's prerequisite edges
    are translated out of its own node ids and unioned by label, so two
    activities that both teach "vektorer → projektil" contribute one edge."""
    _activity("act-1", ("v", "Vektorer"), ("p", "Projektil"))
    _activity("act-2", ("vv", "vektorer"), ("pp", "Projektil"))
    _link("act-1", "v", "p")
    _link("act-2", "vv", "pp")
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-a", "act-1", "p", "partial")
    _mark("grp-a", "act-2", "vv", "demonstrated")
    _mark("grp-a", "act-2", "pp", "partial")

    out = class_concept_distribution(CLASS)
    assert out["edges"] == [{"from": "vektorer", "to": "projektil"}]
    assert {c["key"] for c in out["concepts"]} == {"vektorer", "projektil"}


def test_an_edge_to_a_concept_no_group_has_touched_is_dropped():
    """An edge with no node to attach to would render as a dangling arrow. The
    concept is absent because no group has a record for it — the graph shows
    what the class has actually met."""
    _activity("act-1", ("v", "Vektorer"), ("p", "Projektil"))
    _link("act-1", "v", "p")
    _mark("grp-a", "act-1", "v", "demonstrated")
    assert class_concept_distribution(CLASS)["edges"] == []


def test_two_activities_disagreeing_about_order_keep_both_edges():
    """A cycle in the union is a real disagreement between two teachers' maps,
    not corrupt data. Dropping one silently would pick a winner nobody chose;
    the renderer relaxes a bounded number of passes, so it survives it."""
    _activity("act-1", ("a", "Kraft"), ("b", "Acceleration"))
    _activity("act-2", ("c", "Kraft"), ("d", "Acceleration"))
    _link("act-1", "a", "b")
    _link("act-2", "d", "c")
    for act, nodes in (("act-1", ("a", "b")), ("act-2", ("c", "d"))):
        for n in nodes:
            _mark("grp-a", act, n, "partial")
    assert len(class_concept_distribution(CLASS)["edges"]) == 2


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


# --- conflicts (M6) --------------------------------------------------------


def test_a_passive_mark_disagreeing_with_a_checkpoint_is_flagged():
    _activity("act-1", ("v", "Vektorer"))
    _mark("grp-a", "act-1", "v", "partial")
    _mark("grp-a", "act-1", "v", "demonstrated", kind="observed")
    assert class_concept_distribution(CLASS)["concepts"][0]["flags"] == [{"groupId": "grp-a", "kind": "provenance"}]


def test_a_status_that_went_backwards_is_flagged():
    """Forgetting, or the same concept meaning something harder in a second
    activity. Either way it is the teacher's to look at, not ours to resolve."""
    _activity("act-1", ("v", "Vektorer"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-a", "act-1", "v", "partial")
    assert [f["kind"] for f in class_concept_distribution(CLASS)["concepts"][0]["flags"]] == ["regressed"]


def test_two_groups_simply_disagreeing_is_not_a_conflict():
    """THE distinction. Groups differing IS the class's shape and the reason the
    distribution exists; flagging it would bury the two real conflicts under
    one per concept per class."""
    _activity("act-1", ("v", "Vektorer"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-b", "act-1", "v", "not_yet")
    assert class_concept_distribution(CLASS)["concepts"][0]["flags"] == []


def test_a_teacher_record_agreeing_with_nobody_is_not_flagged_as_a_conflict():
    """An override is the resolution, not a conflict — flagging it would put a
    warning on every concept a teacher had just settled."""
    _activity("act-1", ("v", "Vektorer"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-a", "act-1", "v", "not_yet", kind="teacher")
    assert [f["kind"] for f in class_concept_distribution(CLASS)["concepts"][0]["flags"]] == ["regressed"]


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


# --- complementary groups (M7) ---------------------------------------------


def test_a_group_that_has_what_another_is_ready_for_is_a_candidate_pair():
    """The ask: "help link groups that are mastering different trees"."""
    _activity("act-1", ("v", "Vektorer"), ("t", "Trigonometri"), ("p", "Projektil"))
    _link("act-1", "v", "p")
    _link("act-1", "t", "p")
    # A has vektorer; B has trigonometri. Each is ready for what the other has.
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-b", "act-1", "t", "demonstrated")

    pairs = complementary_pairs(CLASS)["pairs"]
    assert len(pairs) == 1
    assert pairs[0]["groups"] == ["grp-a", "grp-b"]
    assert pairs[0]["aGives"] == ["Vektorer"]
    assert pairs[0]["bGives"] == ["Trigonometri"]
    assert pairs[0]["mutual"] is True


def test_a_one_way_pair_is_offered_but_not_as_a_mutual_one():
    """One group tutoring another is worth knowing and is a different thing
    from an exchange — the panel says which, rather than flattening them."""
    _activity("act-1", ("v", "Vektorer"), ("t", "Trigonometri"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-b", "act-1", "v", "not_yet")

    pairs = complementary_pairs(CLASS)["pairs"]
    assert len(pairs) == 1 and pairs[0]["mutual"] is False
    assert pairs[0]["aGives"] == ["Vektorer"] and pairs[0]["bGives"] == []


def test_mutual_pairs_come_first():
    _activity("act-1", ("v", "Vektorer"), ("t", "Trigonometri"), ("b", "Bølger"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-b", "act-1", "t", "demonstrated")
    _mark("grp-c", "act-1", "b", "not_yet")
    pairs = complementary_pairs(CLASS)["pairs"]
    assert pairs[0]["mutual"] is True
    assert all(not p["mutual"] for p in pairs[1:])


def test_two_groups_at_the_same_place_are_not_paired():
    """No exchange to offer. Pairing them anyway would fill the panel with
    every pair in the class and say nothing."""
    _activity("act-1", ("v", "Vektorer"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-b", "act-1", "v", "demonstrated")
    assert complementary_pairs(CLASS)["pairs"] == []


def test_a_concept_behind_an_undemonstrated_prerequisite_is_not_offered():
    """The pairing is the FRONTIER, not "anything you have that they lack" —
    handing a group a concept it is not ready for is not help."""
    _activity("act-1", ("v", "Vektorer"), ("p", "Projektil"))
    _link("act-1", "v", "p")
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-a", "act-1", "p", "demonstrated")
    # B has neither, so only vektorer (a root) is on its frontier.
    _mark("grp-b", "act-1", "v", "not_yet")
    pairs = complementary_pairs(CLASS)["pairs"]
    assert pairs[0]["aGives"] == ["Vektorer"]


def test_no_pairing_reports_a_score_or_a_standing():
    """The guard against this becoming a leaderboard. "Which groups are ahead"
    is one careless change from "which groups are behind", and a class can read
    that off a teacher's screen."""
    _activity("act-1", ("v", "Vektorer"), ("t", "Trigonometri"))
    _mark("grp-a", "act-1", "v", "demonstrated")
    _mark("grp-b", "act-1", "t", "demonstrated")
    pair = complementary_pairs(CLASS)["pairs"][0]
    assert set(pair) == {"groups", "aGives", "bGives", "mutual"}


def test_an_empty_class_pairs_nobody():
    assert complementary_pairs("cls-empty") == {"classId": "cls-empty", "pairs": []}
