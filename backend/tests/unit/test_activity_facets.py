"""Activity facets — inheritance from cited materials, filtering, narrowed counts (1.1.61).

The headline behaviour: an activity's subject/level/tags are mostly NOT stored on
the activity. They are derived at read time from the curriculum documents it
cites, so filing a document files every activity that uses it, with no backfill
and nothing to reconcile. These tests pin that, plus the ACL rule that keeps a
private upload's tags out of the shared catalogue.
"""

from __future__ import annotations

from datetime import UTC, datetime

from db.activities import (
    apply_activity_filters,
    facets_for_activities,
    inherited_facets_for,
)
from db.models.activity import Activity
from db.models.curriculum import UNLEVELLED, CurriculumDoc

NOW = datetime.now(UTC)


def _doc(doc_id, *, level=None, subject=None, tags=(), owner="shared", source="shared"):
    return CurriculumDoc(
        docId=doc_id,
        title=f"Doc {doc_id}",
        level=level,
        subject=subject,
        tags=list(tags),
        source=source,
        ownerScope=owner,
        origin="uvm.dk",
        copyrightStatus="cleared",
        createdAt=NOW,
        updatedAt=NOW,
    )


def _activity(activity_id, *, cites=(), tags=(), subject=None, level=None, title="Activity", goal=""):
    return Activity(
        activityId=activity_id,
        ownerUid="teacher-1",
        title=title,
        teachingGoal=goal,
        tags=list(tags),
        subject=subject,
        level=level,
        materials=[{"kind": "curriculum", "docId": d, "origin": "uvm.dk"} for d in cites],
        createdAt=NOW,
        updatedAt=NOW,
    )


def _by_id(*docs):
    return {d.doc_id: d for d in docs}


# --- inheritance ------------------------------------------------------------


def test_inherits_subject_level_and_tags_from_cited_docs():
    docs = _by_id(_doc("d1", level="A", subject="Fysik", tags=["mekanik", "lab"]))
    inh = inherited_facets_for([_activity("act-1", cites=["d1"])], docs)
    assert inh["act-1"]["subjects"] == {"Fysik"}
    assert inh["act-1"]["levels"] == {"A"}
    assert inh["act-1"]["tags"] == {"mekanik", "lab"}


def test_inherits_a_SET_across_several_cited_docs():
    """A doc has one subject; an activity citing several has a set of them."""
    docs = _by_id(
        _doc("d1", level="A", subject="Fysik", tags=["mekanik"]),
        _doc("d2", level="B", subject="Matematik", tags=["lab"]),
    )
    inh = inherited_facets_for([_activity("act-1", cites=["d1", "d2"])], docs)
    assert inh["act-1"]["subjects"] == {"Fysik", "Matematik"}
    assert inh["act-1"]["levels"] == {"A", "B"}
    assert inh["act-1"]["tags"] == {"mekanik", "lab"}


def test_deleted_or_invisible_cited_doc_contributes_nothing():
    """A dangling docId is the normal result of deleting a document, not an error."""
    inh = inherited_facets_for([_activity("act-1", cites=["gone"])], _by_id())
    assert inh["act-1"] == {"subjects": set(), "levels": set(), "tags": set()}


def test_activity_with_no_materials_inherits_nothing():
    inh = inherited_facets_for([_activity("act-1")], _by_id(_doc("d1", subject="Fysik")))
    assert inh["act-1"]["subjects"] == set()


# --- filtering: the headline case -------------------------------------------


def test_matches_inherited_subject_with_no_activity_level_subject_set():
    """THE point of the feature: file the doc, and the activity files itself."""
    docs = _by_id(_doc("d1", subject="Fysik"))
    acts = [_activity("act-1", cites=["d1"]), _activity("act-2")]
    inh = inherited_facets_for(acts, docs)
    out = apply_activity_filters(acts, inh, subject="Fysik")
    assert [a.activity_id for a in out] == ["act-1"]


def test_retagging_the_doc_refiles_the_activity_with_no_write_to_it():
    docs_before = _by_id(_doc("d1", tags=["draft"]))
    docs_after = _by_id(_doc("d1", tags=["exam-prep"]))
    act = _activity("act-1", cites=["d1"])
    frozen = act.model_dump()

    before = apply_activity_filters([act], inherited_facets_for([act], docs_before), tags=["exam-prep"])
    after = apply_activity_filters([act], inherited_facets_for([act], docs_after), tags=["exam-prep"])

    assert before == []
    assert [a.activity_id for a in after] == ["act-1"]
    assert act.model_dump() == frozen  # the activity itself was never touched


def test_own_and_inherited_are_a_union_not_an_override():
    docs = _by_id(_doc("d1", subject="Fysik"))
    act = _activity("act-1", cites=["d1"], subject="Matematik")
    inh = inherited_facets_for([act], docs)
    assert apply_activity_filters([act], inh, subject="Fysik")  # inherited
    assert apply_activity_filters([act], inh, subject="Matematik")  # own


def test_tags_filter_is_AND_and_case_insensitive():
    docs = _by_id(_doc("d1", tags=["lab"]))
    act = _activity("act-1", cites=["d1"], tags=["exam-prep"])
    inh = inherited_facets_for([act], docs)
    assert apply_activity_filters([act], inh, tags=["lab", "exam-prep"])  # both, across sources
    assert apply_activity_filters([act], inh, tags=["LAB"])  # case-insensitive
    assert apply_activity_filters([act], inh, tags=["lab", "missing"]) == []


def test_unlevelled_means_neither_own_nor_inherited_level():
    docs = _by_id(_doc("d1", level="A"))
    a_inherits = _activity("act-1", cites=["d1"])
    a_own = _activity("act-2", level="B")
    a_none = _activity("act-3")
    acts = [a_inherits, a_own, a_none]
    inh = inherited_facets_for(acts, docs)
    out = apply_activity_filters(acts, inh, level=UNLEVELLED)
    assert [a.activity_id for a in out] == ["act-3"]


def test_free_text_searches_title_goal_and_both_tag_sources():
    docs = _by_id(_doc("d1", tags=["kinematik"]))
    acts = [
        _activity("act-1", title="Kast med bold"),
        _activity("act-2", goal="Forstå energibevarelse"),
        _activity("act-3", cites=["d1"]),
        _activity("act-4", tags=["optik"]),
        _activity("act-5", title="Andet"),
    ]
    inh = inherited_facets_for(acts, docs)
    assert [a.activity_id for a in apply_activity_filters(acts, inh, q="bold")] == ["act-1"]
    assert [a.activity_id for a in apply_activity_filters(acts, inh, q="ENERGI")] == ["act-2"]
    assert [a.activity_id for a in apply_activity_filters(acts, inh, q="kinematik")] == ["act-3"]
    assert [a.activity_id for a in apply_activity_filters(acts, inh, q="optik")] == ["act-4"]


def test_multi_term_search_is_AND():
    acts = [_activity("act-1", title="Kast med bold"), _activity("act-2", title="Kast med vogn")]
    inh = inherited_facets_for(acts, _by_id())
    assert [a.activity_id for a in apply_activity_filters(acts, inh, q="kast bold")] == ["act-1"]


# --- ACL: the leak this feature could introduce -----------------------------


def test_private_upload_tags_do_not_leak_through_a_published_activity():
    """A published activity may cite a teacher's PRIVATE upload. Inheritance is
    resolved against the CALLER's visible docs, so another teacher browsing the
    shared catalogue sees nothing derived from that upload.

    This is the test that matters: the wrong implementation (resolving against
    the OWNER's docs) looks identical in single-teacher dev data.
    """
    private = _doc("p1", subject="Fysik", tags=["min-private-note"], owner="teacher-1", source="teacher_upload")
    act = _activity("act-1", cites=["p1"])

    as_owner = inherited_facets_for([act], _by_id(private))
    assert as_owner["act-1"]["tags"] == {"min-private-note"}

    # Another teacher's visible set contains only shared docs.
    as_other = inherited_facets_for([act], _by_id())
    assert as_other["act-1"]["tags"] == set()
    assert apply_activity_filters([act], as_other, tags=["min-private-note"]) == []


# --- facets -----------------------------------------------------------------


def test_facet_counts_are_narrowed_by_the_OTHER_facets_only():
    docs = _by_id(
        _doc("d1", subject="Fysik", tags=["lab"]),
        _doc("d2", subject="Matematik", tags=["lab"]),
        _doc("d3", subject="Fysik", tags=["exam-prep"]),
    )
    acts = [
        _activity("act-1", cites=["d1"]),
        _activity("act-2", cites=["d2"]),
        _activity("act-3", cites=["d3"]),
    ]
    inh = inherited_facets_for(acts, docs)

    f = facets_for_activities(acts, inh, subject="Fysik")
    tags = {t["value"]: t["count"] for t in f["tags"]}
    # Tags re-count against Fysik only...
    assert tags["lab"] == 1 and tags["exam-prep"] == 1
    subjects = {s["value"]: s["count"] for s in f["subjects"]}
    # ...but sibling SUBJECTS keep their own counts, so you can switch without clearing.
    assert subjects["Fysik"] == 2 and subjects["Matematik"] == 1


def test_facet_options_come_from_the_whole_visible_set_even_at_zero():
    """A rail navigated by muscle memory must not reshuffle; zero-count chips stay."""
    docs = _by_id(_doc("d1", subject="Fysik"), _doc("d2", subject="Kemi"))
    acts = [_activity("act-1", cites=["d1"]), _activity("act-2", cites=["d2"])]
    inh = inherited_facets_for(acts, docs)
    f = facets_for_activities(acts, inh, q="nothing-matches-this")
    assert {s["value"] for s in f["subjects"]} == {"Fysik", "Kemi"}
    assert all(s["count"] == 0 for s in f["subjects"])


def test_levels_are_fixed_order_with_unlevelled_last():
    docs = _by_id(_doc("d1", level="B"), _doc("d2", level="A"))
    acts = [_activity("act-1", cites=["d1"]), _activity("act-2", cites=["d2"]), _activity("act-3")]
    inh = inherited_facets_for(acts, docs)
    f = facets_for_activities(acts, inh)
    assert [lv["value"] for lv in f["levels"]] == ["A", "B", UNLEVELLED]


def test_an_activity_counts_once_per_distinct_value_not_once_per_citation():
    docs = _by_id(_doc("d1", subject="Fysik", tags=["lab"]), _doc("d2", subject="Fysik", tags=["lab"]))
    act = _activity("act-1", cites=["d1", "d2"])
    inh = inherited_facets_for([act], docs)
    f = facets_for_activities([act], inh)
    assert {s["value"]: s["count"] for s in f["subjects"]}["Fysik"] == 1
    assert {t["value"]: t["count"] for t in f["tags"]}["lab"] == 1
