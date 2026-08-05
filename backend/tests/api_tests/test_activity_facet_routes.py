"""Activity facet endpoints — filters, /facets, /{id}/facets, ACL (1.1.61).

The unit twin (tests/unit/test_activity_facets.py) pins the pure functions. This
file pins the wire: the response shape, the query params, the partial-patch
endpoint, and — the one that matters — that inheritance is resolved against the
CALLER's visible documents, so the shared catalogue cannot surface a facet
derived from someone's private upload.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import db.curriculum as dbc
from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.activities import create_activity
from db.models.activity import Activity
from db.models.curriculum import CurriculumDoc
from protocols.activity_routes import router as activities_router

TEACHER = "teacher-1"
OTHER = "teacher-other"
NOW = datetime.now(UTC)


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    dbc.invalidate_shared_cache()
    yield
    fs_module._reset_client_for_testing()
    dbc.invalidate_shared_cache()


def _client(uid: str = TEACHER, *, researcher: bool = False) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", domain="example.test", is_teacher=True, is_researcher=researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _doc(doc_id, *, subject=None, level=None, tags=(), owner="shared"):
    shared = owner == "shared"
    dbc.create_curriculum_doc(
        CurriculumDoc(
            docId=doc_id,
            title=f"Doc {doc_id}",
            subject=subject,
            level=level,
            tags=list(tags),
            source="shared" if shared else "teacher_upload",
            ownerScope=owner,
            origin="uvm.dk",
            copyrightStatus="cleared" if shared else "teacher_owned",
            createdAt=NOW,
            updatedAt=NOW,
        )
    )
    dbc.invalidate_shared_cache()


def _activity(activity_id, *, owner=TEACHER, cites=(), title="Activity", visibility="private", tags=(), subject=None):
    return create_activity(
        Activity(
            activityId=activity_id,
            ownerUid=owner,
            title=title,
            visibility=visibility,
            tags=list(tags),
            subject=subject,
            materials=[{"kind": "curriculum", "docId": d, "origin": "uvm.dk"} for d in cites],
        )
    )


# --- response shape + filters ----------------------------------------------


def test_list_returns_paginated_envelope_with_total():
    for i in range(5):
        _activity(f"act-{i}", title=f"A{i}")
    body = _client().get("/api/activities?limit=2").json()
    assert set(body) == {"activities", "total", "limit", "offset"}
    assert body["total"] == 5, "total is the full match count, not the page length"
    assert len(body["activities"]) == 2


def test_inherited_facets_are_on_the_row_and_kept_separate_from_own():
    _doc("d1", subject="Fysik", level="A", tags=["mekanik"])
    _activity("act-1", cites=["d1"], tags=["min-egen"])
    row = _client().get("/api/activities").json()["activities"][0]
    assert row["tags"] == ["min-egen"]  # own, unchanged
    assert row["inheritedTags"] == ["mekanik"]
    assert row["inheritedSubjects"] == ["Fysik"]
    assert row["inheritedLevels"] == ["A"]


def test_filter_by_inherited_subject_with_nothing_set_on_the_activity():
    _doc("d1", subject="Fysik")
    _doc("d2", subject="Matematik")
    _activity("act-fys", cites=["d1"])
    _activity("act-mat", cites=["d2"])
    body = _client().get("/api/activities?subject=Fysik").json()
    assert [a["activityId"] for a in body["activities"]] == ["act-fys"]


def test_filter_by_tag_and_free_text():
    _doc("d1", tags=["lab"])
    _activity("act-1", cites=["d1"], title="Kast med bold")
    _activity("act-2", title="Andet")
    c = _client()
    assert [a["activityId"] for a in c.get("/api/activities?tags=lab").json()["activities"]] == ["act-1"]
    assert [a["activityId"] for a in c.get("/api/activities?q=bold").json()["activities"]] == ["act-1"]


def test_unknown_level_value_is_rejected_not_silently_ignored():
    assert _client().get("/api/activities?level=Z").status_code == 422


# --- /facets ----------------------------------------------------------------


def test_facets_returns_narrowed_counts():
    _doc("d1", subject="Fysik", tags=["lab"])
    _doc("d2", subject="Matematik", tags=["lab"])
    _activity("act-1", cites=["d1"])
    _activity("act-2", cites=["d2"])
    body = _client().get("/api/activities/facets?subject=Fysik").json()
    assert {t["value"]: t["count"] for t in body["tags"]}["lab"] == 1
    # Sibling subjects keep their own counts so the teacher can switch.
    assert {s["value"]: s["count"] for s in body["subjects"]} == {"Fysik": 1, "Matematik": 1}


def test_facets_route_is_not_shadowed_by_the_activity_id_route():
    """`/facets` must resolve as the facets endpoint, not as activity id 'facets'."""
    assert _client().get("/api/activities/facets").status_code == 200


# --- PATCH /{id}/facets -----------------------------------------------------


def test_patch_facets_sets_and_normalises():
    _activity("act-1")
    r = _client().patch("/api/activities/act-1/facets", json={"tags": [" Lab ", "LAB", "exam"], "subject": "Fysik"})
    assert r.status_code == 200
    assert r.json()["tags"] == ["lab", "exam"]  # lowercased, de-duped, order-preserving
    assert r.json()["subject"] == "Fysik"


def test_patch_facets_add_and_remove_tags():
    _activity("act-1", tags=["lab"])
    c = _client()
    assert c.patch("/api/activities/act-1/facets", json={"addTags": ["exam"]}).json()["tags"] == ["lab", "exam"]
    assert c.patch("/api/activities/act-1/facets", json={"removeTags": ["lab"]}).json()["tags"] == ["exam"]


def test_patch_facets_can_clear_subject_explicitly():
    _activity("act-1", subject="Fysik")
    r = _client().patch("/api/activities/act-1/facets", json={"clearSubject": True})
    assert r.json()["subject"] is None


def test_patch_facets_cannot_touch_anything_else():
    """The point of a facets-only endpoint: a tag edit from the library row must
    not be able to carry (or drop) elements. extra=forbid makes that structural."""
    _activity("act-1")
    assert _client().patch("/api/activities/act-1/facets", json={"title": "hijacked"}).status_code == 422


def test_patch_facets_preserves_elements():
    create_activity(
        Activity(
            activityId="act-1",
            ownerUid=TEACHER,
            title="Keeps its elements",
            checklist=[{"id": "c1", "label": "step"}],
        )
    )
    _client().patch("/api/activities/act-1/facets", json={"addTags": ["lab"]})
    row = _client().get("/api/activities/act-1").json()
    assert len(row["checklist"]) == 1, "a facet patch must never drop element content"
    assert row["tags"] == ["lab"]


def test_patch_facets_of_another_teachers_activity_is_404():
    _activity("act-1", owner=OTHER)
    assert _client().patch("/api/activities/act-1/facets", json={"addTags": ["x"]}).status_code == 404


# --- the ACL rule -----------------------------------------------------------


def test_shared_catalogue_does_not_leak_a_private_uploads_facets():
    """TEACHER publishes an activity citing their OWN private upload. Nobody
    browsing the catalogue sees a facet derived from that document.

    Note "nobody", including the owner. The catalogue resolves citations against
    the SHARED corpus for every viewer, so it looks identical to all of them.
    That is deliberate and stronger than per-viewer resolution would be: a
    catalogue whose facet counts changed depending on who was looking would make
    "why do I see 3 and you see 2?" a real and unanswerable question. The owner
    keeps the full picture in their own library — asserted just below.
    """
    _doc("p1", subject="Fysik", tags=["min-private-note"], owner=TEACHER)
    _activity("act-pub", cites=["p1"], visibility="published")

    for uid in (TEACHER, OTHER):
        row = _client(uid).get("/api/activities?published=true").json()["activities"][0]
        assert row["inheritedTags"] == [], f"{uid} saw a private upload's tags in the catalogue"
        assert row["inheritedSubjects"] == []

    # ...and it is not reachable by guessing the tag either.
    hit = _client(OTHER).get("/api/activities?published=true&tags=min-private-note").json()
    assert hit["total"] == 0


def test_the_owner_still_sees_private_facets_in_their_OWN_library():
    """The counterpart to the catalogue rule: restricting cross-teacher views
    must not cost the owner the facets of documents they can see."""
    _doc("p1", subject="Fysik", tags=["min-private-note"], owner=TEACHER)
    _activity("act-1", cites=["p1"])
    row = _client(TEACHER).get("/api/activities").json()["activities"][0]
    assert row["inheritedTags"] == ["min-private-note"]
    assert row["inheritedSubjects"] == ["Fysik"]


def test_shared_corpus_facets_DO_reach_the_catalogue():
    """The counterpart: a shared document's facets are visible to everyone, which
    is what makes the catalogue searchable at all."""
    _doc("s1", subject="Fysik", tags=["mekanik"])
    _activity("act-pub", cites=["s1"], visibility="published")
    row = _client(OTHER).get("/api/activities?published=true").json()["activities"][0]
    assert row["inheritedTags"] == ["mekanik"]
    assert row["inheritedSubjects"] == ["Fysik"]
