"""API tests for /api/activities + /api/classes/{id}/activities (ALS-1 M1.1)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class
from db.models.class_ import Class
from protocols.activity_routes import router as activities_router
from protocols.classes_routes import router as classes_router

TEACHER = "teacher-1"
OTHER = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(uid: str = TEACHER, *, researcher: bool = False) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router)
    app.include_router(classes_router)

    async def _override(request: Request) -> User:
        u = User(
            uid=uid,
            email=f"{uid}@example.test",
            domain="example.test",
            is_teacher=True,
            is_researcher=researcher,
        )
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _make_class(class_id: str, owner: str = TEACHER) -> None:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=class_id,
            ownerUid=owner,
            name=f"Class {class_id}",
            tagNamespace=f"class:{owner}:{class_id}",
            createdAt=now,
            updatedAt=now,
        )
    )


def test_post_mints_distinct_ids_no_collision():
    """The core fix: two creates → two DISTINCT activity ids (no overwrite)."""
    c = _client()
    a = c.post("/api/activities", json={"skillId": "concept", "title": "A", "teachingGoal": "ga"})
    b = c.post("/api/activities", json={"skillId": "concept", "title": "B", "teachingGoal": "gb"})
    assert a.status_code == 201 and b.status_code == 201
    aid, bid = a.json()["activityId"], b.json()["activityId"]
    assert aid != bid
    assert aid.startswith("act-") and bid.startswith("act-")


def test_post_accepts_document_and_solution_elements():
    """Regression (1.1.48): the builder POSTs the full element set. ``document``
    must be accepted on the ALS-1 path + round-trip on GET — it was missing from
    ActivityUpsert/Activity/_activity_from_body, so creating a document-feedback
    activity 422'd with extra_forbidden('document')."""
    c = _client()
    body = {
        "skillId": "concept",
        "title": "Doc + solution",
        "document": [{"id": "document-1", "prompt": "Upload din opgave"}],
        "solution": [{"id": "solution-1", "prompt": "Tegn din løsning"}],
    }
    resp = c.post("/api/activities", json=body)
    assert resp.status_code == 201, resp.text
    got = c.get(f"/api/activities/{resp.json()['activityId']}").json()
    assert got["document"] == [{"id": "document-1", "prompt": "Upload din opgave"}]
    assert got["solution"][0]["id"] == "solution-1"


def test_post_accepts_writing_elements():
    """Same regression shape as the one above, for 1.1.73's writing element.

    Recipe step 1b is three models and TWO adapters; the model test catches a
    missing field but nothing auto-checks the adapters, so the POST→GET
    round-trip is written before the frontend exists. Several elements, because
    the cap is 3 and a method box overwriting a conclusion box would be exactly
    the silent-data-loss failure 1.1.71 documents.
    """
    c = _client()
    body = {
        "skillId": "concept",
        "title": "Rapport",
        "writing": [
            {"id": "writing-1", "title": "Metode", "prompt": "Beskriv jeres metode"},
            {"id": "writing-2", "title": "Konklusion", "minWords": 150, "maxChars": 5000},
        ],
    }
    resp = c.post("/api/activities", json=body)
    assert resp.status_code == 201, resp.text

    got = c.get(f"/api/activities/{resp.json()['activityId']}").json()
    assert [w["id"] for w in got["writing"]] == ["writing-1", "writing-2"]
    assert got["writing"][0]["prompt"] == "Beskriv jeres metode"
    assert got["writing"][1]["minWords"] == 150


def test_writing_element_survives_the_activity_to_config_adapter():
    """The other half of recipe 1b. An element that creates fine but is dropped
    by ``_activity_to_config`` renders nothing for the student — how the
    ``document`` element shipped broken in 1.1.48."""
    from adk.teacher_focus import _activity_to_config
    from db.models.activity import Activity
    from db.models.activity_config import WritingElement

    activity = Activity(
        activityId="act-1",
        skillId="concept",
        ownerUid=TEACHER,
        title="Rapport",
        writing=[WritingElement(id="writing-1", title="Konklusion", prompt="Skriv din konklusion")],
    )
    cfg = _activity_to_config(activity, class_id="c1")
    assert [w.id for w in cfg.writing] == ["writing-1"]
    assert cfg.writing[0].prompt == "Skriv din konklusion"


def test_post_with_class_auto_assigns():
    _make_class("c1")
    c = _client()
    resp = c.post("/api/activities", json={"skillId": "concept", "title": "A", "classId": "c1"})
    aid = resp.json()["activityId"]
    cls = c.get("/api/classes/c1").json()
    assert aid in cls["activityIds"]


def test_post_assign_to_unowned_class_404s():
    _make_class("c-other", owner=OTHER)
    resp = _client().post("/api/activities", json={"skillId": "concept", "title": "A", "classId": "c-other"})
    assert resp.status_code == 404


def test_list_owner_scoped():
    _client().post("/api/activities", json={"skillId": "concept", "title": "Mine"})
    _client(OTHER).post("/api/activities", json={"skillId": "concept", "title": "Theirs"})
    mine = _client().get("/api/activities?owner=me").json()["activities"]
    assert {a["title"] for a in mine} == {"Mine"}


def test_scope_all_researcher_sees_every_owner():
    """Research view (1.1.5): a researcher's ``scope=all`` returns activities
    across ALL teachers, not just their own."""
    _client().post("/api/activities", json={"skillId": "concept", "title": "Mine"})
    _client(OTHER).post("/api/activities", json={"skillId": "concept", "title": "Theirs"})
    rows = _client(researcher=True).get("/api/activities?scope=all").json()["activities"]
    assert {a["title"] for a in rows} == {"Mine", "Theirs"}


def test_scope_all_enriches_owner_label(monkeypatch):
    """The research view replaces raw owner uids with a friendly label when the
    resolver can map them (display name / email)."""
    monkeypatch.setattr(
        "protocols.activity_routes.resolve_owner_labels",
        lambda uids: {TEACHER: "Alice Hansen"},
    )
    _client().post("/api/activities", json={"skillId": "concept", "title": "Mine"})
    rows = _client(researcher=True).get("/api/activities?scope=all").json()["activities"]
    assert rows[0]["ownerLabel"] == "Alice Hansen"


def test_scope_all_falls_back_to_uid_when_unresolved(monkeypatch):
    """An owner the resolver can't map carries no label — the client falls back
    to the uid (no crash, no empty label)."""
    monkeypatch.setattr("protocols.activity_routes.resolve_owner_labels", lambda uids: {})
    _client().post("/api/activities", json={"skillId": "concept", "title": "Mine"})
    rows = _client(researcher=True).get("/api/activities?scope=all").json()["activities"]
    assert "ownerLabel" not in rows[0]
    assert rows[0]["ownerUid"] == TEACHER


def test_scope_all_non_researcher_forbidden():
    """A non-researcher cannot reach scope=all even by URL-hacking it — 403,
    never a silent fallback to own-scope."""
    _client(OTHER).post("/api/activities", json={"skillId": "concept", "title": "Theirs"})
    resp = _client().get("/api/activities?scope=all")  # default researcher=False
    assert resp.status_code == 403


def test_scope_own_still_owner_scoped_for_researcher():
    """A researcher's DEFAULT (own) scope is still just their own library —
    the cross-owner scan only happens on the explicit scope=all opt-in."""
    _client(researcher=True).post("/api/activities", json={"skillId": "concept", "title": "Mine"})
    _client(OTHER).post("/api/activities", json={"skillId": "concept", "title": "Theirs"})
    mine = _client(researcher=True).get("/api/activities?owner=me").json()["activities"]
    assert {a["title"] for a in mine} == {"Mine"}


def test_get_patch_delete_owner_only():
    c = _client()
    aid = c.post("/api/activities", json={"skillId": "concept", "title": "A", "teachingGoal": "g1"}).json()[
        "activityId"
    ]
    # owner can load + edit
    assert c.get(f"/api/activities/{aid}").json()["title"] == "A"
    patched = c.patch(f"/api/activities/{aid}", json={"skillId": "concept", "title": "A2", "teachingGoal": "g2"})
    assert patched.json()["title"] == "A2" and patched.json()["teachingGoal"] == "g2"
    # other teacher cannot see/edit/delete (404, enumeration-resistant)
    assert _client(OTHER).get(f"/api/activities/{aid}").status_code == 404
    assert _client(OTHER).patch(f"/api/activities/{aid}", json={"skillId": "x", "title": "hax"}).status_code == 404
    assert _client(OTHER).delete(f"/api/activities/{aid}").status_code == 404
    # owner deletes
    assert c.delete(f"/api/activities/{aid}").status_code == 204
    assert c.get(f"/api/activities/{aid}").status_code == 404


def test_assign_endpoint_owner_only_on_activity():
    _make_class("c1")
    c = _client()
    mine = c.post("/api/activities", json={"skillId": "concept", "title": "Mine"}).json()["activityId"]
    theirs = _client(OTHER).post("/api/activities", json={"skillId": "concept", "title": "Theirs"}).json()["activityId"]
    # assigning my own activity works
    ok = c.patch("/api/classes/c1/activities", json={"add": [mine]})
    assert ok.status_code == 200 and mine in ok.json()["activityIds"]
    # assigning another teacher's activity is refused
    bad = c.patch("/api/classes/c1/activities", json={"add": [theirs]})
    assert bad.status_code == 404
    # remove works
    removed = c.patch("/api/classes/c1/activities", json={"remove": [mine]})
    assert mine not in removed.json()["activityIds"]


def test_assign_draft_is_rejected_until_reviewed_and_saved():
    """A draft is not assignable (ALS-SHARE-UX): adding one is 409. Saving it in
    the editor promotes it to private, after which it assigns fine — the whole
    review-before-use lifecycle in one test. The draft arises the real way (adopt
    a published activity), since ``draft`` is not a user-settable state."""
    _make_class("c1")
    c = _client()
    pub = (
        _client(OTHER)
        .post("/api/activities", json={"skillId": "concept", "title": "P", "visibility": "published"})
        .json()["activityId"]
    )
    aid = c.post(f"/api/activities/{pub}/adopt").json()["activityId"]  # -> draft copy owned by caller
    blocked = c.patch("/api/classes/c1/activities", json={"add": [aid]})
    assert blocked.status_code == 409, blocked.text
    c.patch(f"/api/activities/{aid}", json={"skillId": "concept", "title": "Mine"})  # save -> promotes draft to private
    ok = c.patch("/api/classes/c1/activities", json={"add": [aid]})
    assert ok.status_code == 200 and aid in ok.json()["activityIds"]


class TestDuplicate:
    """M2 (ALS-SHARE): POST /api/activities/{id}/duplicate — copy into the
    caller's library (own source OR published)."""

    def test_duplicate_own_creates_draft_copy_with_provenance(self):
        c = _client()
        src = c.post(
            "/api/activities",
            json={"skillId": "concept", "title": "Orig", "teachingGoal": "g", "artefactId": "boldkast"},
        ).json()
        sid = src["activityId"]
        resp = c.post(f"/api/activities/{sid}/duplicate")
        assert resp.status_code == 201, resp.text
        copy = resp.json()
        assert copy["activityId"] != sid and copy["activityId"].startswith("act-")
        assert copy["ownerUid"] == TEACHER
        assert copy["sourceActivityId"] == sid
        assert copy["sourceOwnerUid"] == TEACHER
        assert copy["visibility"] == "draft"
        # content copied
        assert copy["title"] == "Orig"
        assert copy["teachingGoal"] == "g"
        assert copy["artefactId"] == "boldkast"

    def test_duplicate_published_of_another_owner_allowed(self):
        theirs = (
            _client(OTHER)
            .post("/api/activities", json={"skillId": "concept", "title": "Pub", "visibility": "published"})
            .json()["activityId"]
        )
        resp = _client().post(f"/api/activities/{theirs}/duplicate")
        assert resp.status_code == 201, resp.text
        copy = resp.json()
        assert copy["ownerUid"] == TEACHER  # copied into the caller's library
        assert copy["sourceOwnerUid"] == OTHER
        assert copy["visibility"] == "draft"

    def test_duplicate_anothers_private_is_404(self):
        theirs = (
            _client(OTHER)
            .post(
                "/api/activities",
                json={"skillId": "concept", "title": "Priv"},  # default visibility=private
            )
            .json()["activityId"]
        )
        resp = _client().post(f"/api/activities/{theirs}/duplicate")
        assert resp.status_code == 404

    def test_duplicate_missing_is_404(self):
        assert _client().post("/api/activities/act-nope/duplicate").status_code == 404


class TestSharedCatalogue:
    """M3.2 (ALS-SHARE): GET /api/activities?published=true — open to any teacher."""

    def test_published_returns_all_published_across_owners_excludes_private(self):
        _client().post("/api/activities", json={"skillId": "c", "title": "Mine-pub", "visibility": "published"})
        _client().post("/api/activities", json={"skillId": "c", "title": "Mine-priv"})  # private (default)
        _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Theirs-pub", "visibility": "published"})
        rows = _client().get("/api/activities?published=true").json()["activities"]
        assert {r["title"] for r in rows} == {"Mine-pub", "Theirs-pub"}

    def test_published_catalogue_open_to_any_teacher_not_researcher_gated(self):
        _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Pub", "visibility": "published"})
        resp = _client().get("/api/activities?published=true")  # non-researcher
        assert resp.status_code == 200
        assert {r["title"] for r in resp.json()["activities"]} == {"Pub"}

    def test_published_enriches_owner_label(self, monkeypatch):
        monkeypatch.setattr("protocols.activity_routes.resolve_owner_labels", lambda uids: {OTHER: "Bob Jensen"})
        _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Pub", "visibility": "published"})
        rows = _client().get("/api/activities?published=true").json()["activities"]
        assert rows[0]["ownerLabel"] == "Bob Jensen"


class TestAdopt:
    """M3.3 (ALS-SHARE): POST /{id}/adopt — copy a PUBLISHED activity into your library."""

    def test_adopt_published_creates_draft_copy_with_provenance(self):
        pub = (
            _client(OTHER)
            .post("/api/activities", json={"skillId": "c", "title": "Pub", "visibility": "published"})
            .json()["activityId"]
        )
        resp = _client().post(f"/api/activities/{pub}/adopt")
        assert resp.status_code == 201, resp.text
        copy = resp.json()
        assert copy["ownerUid"] == TEACHER
        assert copy["sourceOwnerUid"] == OTHER
        assert copy["sourceActivityId"] == pub
        assert copy["visibility"] == "draft"

    def test_adopt_non_published_is_404(self):
        priv = _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Priv"}).json()["activityId"]
        assert _client().post(f"/api/activities/{priv}/adopt").status_code == 404

    def test_adopt_missing_is_404(self):
        assert _client().post("/api/activities/act-nope/adopt").status_code == 404


class TestResearcherCrud:
    """M3b (ALS-SHARE): researcher CRUD-over-all — write/delete bypass on the
    activities collection. The shipped researcher role only bypassed reads."""

    def test_researcher_can_patch_another_teachers_activity_owner_preserved(self):
        aid = _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Theirs"}).json()["activityId"]
        resp = _client(researcher=True).patch(
            f"/api/activities/{aid}", json={"skillId": "c", "title": "Edited by researcher"}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["title"] == "Edited by researcher"
        assert resp.json()["ownerUid"] == OTHER  # ownership preserved, NOT reassigned to the researcher

    def test_researcher_can_delete_another_teachers_activity(self):
        aid = _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Theirs"}).json()["activityId"]
        assert _client(researcher=True).delete(f"/api/activities/{aid}").status_code == 204
        assert _client(OTHER).get(f"/api/activities/{aid}").status_code == 404

    def test_non_researcher_non_owner_still_404_on_patch_delete(self):
        aid = _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Theirs"}).json()["activityId"]
        assert _client().patch(f"/api/activities/{aid}", json={"skillId": "c", "title": "hax"}).status_code == 404
        assert _client().delete(f"/api/activities/{aid}").status_code == 404


class TestHistoryProvenance:
    """M-HIST (ALS-SHARE): GET /{id} enriches an adopted activity with a friendly
    ``sourceOwnerLabel`` so the History panel can read 'Adapted from {name}'."""

    def test_get_adopted_enriches_source_owner_label(self, monkeypatch):
        monkeypatch.setattr("protocols.activity_routes.resolve_owner_labels", lambda uids: {OTHER: "Bob Jensen"})
        pub = (
            _client(OTHER)
            .post("/api/activities", json={"skillId": "c", "title": "Pub", "visibility": "published"})
            .json()["activityId"]
        )
        copy_id = _client().post(f"/api/activities/{pub}/adopt").json()["activityId"]
        got = _client().get(f"/api/activities/{copy_id}").json()
        assert got["sourceActivityId"] == pub
        assert got["sourceOwnerUid"] == OTHER
        assert got["sourceOwnerLabel"] == "Bob Jensen"

    def test_get_from_scratch_has_no_provenance(self):
        aid = _client().post("/api/activities", json={"skillId": "c", "title": "Fresh"}).json()["activityId"]
        got = _client().get(f"/api/activities/{aid}").json()
        assert got.get("sourceActivityId") is None
        assert "sourceOwnerLabel" not in got

    def test_get_adopted_unresolved_source_owner_omits_label(self, monkeypatch):
        monkeypatch.setattr("protocols.activity_routes.resolve_owner_labels", lambda uids: {})
        pub = (
            _client(OTHER)
            .post("/api/activities", json={"skillId": "c", "title": "Pub", "visibility": "published"})
            .json()["activityId"]
        )
        copy_id = _client().post(f"/api/activities/{pub}/adopt").json()["activityId"]
        got = _client().get(f"/api/activities/{copy_id}").json()
        assert got["sourceOwnerUid"] == OTHER  # raw uid still present for client fallback
        assert "sourceOwnerLabel" not in got


class TestSetVisibility:
    """ALS-SHARE-UX M1: POST /{id}/visibility — the unified setter behind the
    teacher card's status control. Only private/published are user-settable."""

    def test_owner_can_set_private_and_shared(self):
        c = _client()
        aid = c.post("/api/activities", json={"skillId": "c", "title": "A"}).json()["activityId"]  # private default
        for state in ("published", "private"):
            resp = c.post(f"/api/activities/{aid}/visibility", json={"visibility": state})
            assert resp.status_code == 200, resp.text
            assert resp.json()["visibility"] == state

    def test_cannot_set_draft_is_422(self):
        # draft is a system state (set on copy/adopt, cleared by review+save), not
        # a value a teacher can pick — selecting it would bypass review-before-use.
        aid = _client().post("/api/activities", json={"skillId": "c", "title": "A"}).json()["activityId"]
        resp = _client().post(f"/api/activities/{aid}/visibility", json={"visibility": "draft"})
        assert resp.status_code == 422

    def test_invalid_visibility_is_422(self):
        aid = _client().post("/api/activities", json={"skillId": "c", "title": "A"}).json()["activityId"]
        resp = _client().post(f"/api/activities/{aid}/visibility", json={"visibility": "public"})
        assert resp.status_code == 422

    def test_non_owner_non_researcher_404(self):
        aid = _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Theirs"}).json()["activityId"]
        resp = _client().post(f"/api/activities/{aid}/visibility", json={"visibility": "published"})
        assert resp.status_code == 404

    def test_researcher_can_set_any_owner_preserved(self):
        aid = _client(OTHER).post("/api/activities", json={"skillId": "c", "title": "Theirs"}).json()["activityId"]
        resp = _client(researcher=True).post(f"/api/activities/{aid}/visibility", json={"visibility": "published"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["visibility"] == "published"
        assert resp.json()["ownerUid"] == OTHER  # ownership preserved on a researcher edit

    def test_published_then_private_does_not_touch_adopted_copies(self):
        # Publish, someone adopts, then unpublish via the setter — the copy survives.
        pub = (
            _client()
            .post("/api/activities", json={"skillId": "c", "title": "Pub", "visibility": "published"})
            .json()["activityId"]
        )
        copy_id = _client(OTHER).post(f"/api/activities/{pub}/adopt").json()["activityId"]
        _client().post(f"/api/activities/{pub}/visibility", json={"visibility": "private"})
        assert _client(OTHER).get(f"/api/activities/{copy_id}").status_code == 200  # adopted copy untouched


class TestEditVisibilityLifecycle:
    """ALS-SHARE-UX: the editor save (PATCH) must NOT clobber visibility. It
    preserves private/published and promotes a freshly-copied draft to private."""

    def test_save_preserves_published(self):
        # Regression: editing a SHARED activity must not silently unpublish it.
        c = _client()
        aid = c.post("/api/activities", json={"skillId": "c", "title": "A", "visibility": "published"}).json()[
            "activityId"
        ]
        r = c.patch(f"/api/activities/{aid}", json={"skillId": "c", "title": "A edited"})
        assert r.status_code == 200, r.text
        assert r.json()["visibility"] == "published"

    def test_save_promotes_draft_to_private(self):
        # adopt -> draft; saving in the editor is the review that makes it yours.
        pub = (
            _client(OTHER)
            .post("/api/activities", json={"skillId": "c", "title": "P", "visibility": "published"})
            .json()["activityId"]
        )
        aid = _client().post(f"/api/activities/{pub}/adopt").json()["activityId"]
        assert _client().get(f"/api/activities/{aid}").json()["visibility"] == "draft"
        r = _client().patch(f"/api/activities/{aid}", json={"skillId": "c", "title": "P mine"})
        assert r.json()["visibility"] == "private"

    def test_save_preserves_private(self):
        c = _client()
        aid = c.post("/api/activities", json={"skillId": "c", "title": "A"}).json()["activityId"]  # private
        r = c.patch(f"/api/activities/{aid}", json={"skillId": "c", "title": "A2"})
        assert r.json()["visibility"] == "private"
