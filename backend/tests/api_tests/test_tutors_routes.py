"""1.1.91 M1 — /api/tutors and /api/research/tutors.

Headline: teachers READ the catalogue, only researchers author; a dangling
persona/framework reference is a 400 at author time rather than a silently
inert tutor in a classroom; and no framework is ever offered to a teacher as a
bare acronym.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from protocols.tutors_routes import router

RESEARCHER = User(uid="r-1", is_teacher=True, is_researcher=True)
TEACHER = User(uid="t-1", is_teacher=True)
STUDENT = User(uid="grp-1", is_teacher=False)


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def test_a_teacher_reads_the_catalogue_but_cannot_author():
    c = _client(TEACHER)
    assert c.get("/api/tutors").status_code == 200
    assert c.post("/api/research/tutors", json={"id": "x-1", "displayName": "X"}).status_code == 403
    assert (
        c.post("/api/research/tutors/variant", json={"parentId": "sofie", "id": "x-1", "displayName": "X"}).status_code
        == 403
    )


def test_a_student_reaches_none_of_it():
    c = _client(STUDENT)
    assert c.get("/api/tutors").status_code == 403


def test_catalogue_ships_every_base_tutor_with_no_framework():
    """The safety property, asserted at the API boundary: picking a base tutor
    cannot change how an activity teaches."""
    body = _client(TEACHER).get("/api/tutors").json()
    assert {t["id"] for t in body["tutors"]} == {"astrid", "frida", "henrik", "jonas", "mikkel", "sofie"}
    for t in body["tutors"]:
        assert t["frameworkId"] is None
        assert t["isVariant"] is False
        assert t["persona"]["avatar"], "a picker card needs an avatar"


def test_frameworks_are_never_offered_as_a_bare_acronym():
    """A teacher should not have to know what ESRU stands for."""
    body = _client(TEACHER).get("/api/tutors").json()
    esru = next(f for f in body["frameworks"] if f["id"] == "esru")
    assert esru["name"] == "Question-and-use cycle (ESRU)"
    dysthe = next(f for f in body["frameworks"] if f["id"] == "authentic-dialogue")
    assert dysthe["name"].startswith("Open dialogue (")
    # The five unwritten ones are flagged so the picker can grey them out
    # rather than offering a framework that would do nothing.
    assert sum(1 for f in body["frameworks"] if f["isPlaceholder"]) == 5


def test_researcher_creates_a_variant_that_carries_persona_and_framework():
    c = _client(RESEARCHER)
    r = c.post(
        "/api/research/tutors/variant",
        json={
            "parentId": "sofie",
            "id": "sofie-esru",
            "displayName": "Sofie — lab coach",
            "frameworkId": "esru",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["frameworkId"] == "esru"
    assert body["frameworkName"] == "Question-and-use cycle (ESRU)"
    assert body["persona"]["id"] == "sofie"
    assert body["lineage"]["parentTutorId"] == "sofie"
    assert body["isVariant"] is True

    # The parent is untouched and still framework-free.
    assert _client(TEACHER).get("/api/tutors/sofie").json()["frameworkId"] is None


def test_a_dangling_reference_is_rejected_at_author_time():
    """A tutor pointing at a framework that does not exist would resolve to "no
    framework" and teach as though it had none — inert, with nothing to see."""
    c = _client(RESEARCHER)
    bad_fw = c.post(
        "/api/research/tutors/variant",
        json={"parentId": "sofie", "id": "v-1", "displayName": "V", "frameworkId": "no-such"},
    )
    assert bad_fw.status_code == 400 and "framework" in bad_fw.json()["detail"]
    bad_persona = c.post("/api/research/tutors", json={"id": "v-2", "displayName": "V", "personaId": "no-such"})
    assert bad_persona.status_code == 400 and "persona" in bad_persona.json()["detail"]


def test_unknown_parent_404s_and_duplicate_id_409s():
    c = _client(RESEARCHER)
    assert (
        c.post("/api/research/tutors/variant", json={"parentId": "ghost", "id": "v-3", "displayName": "V"}).status_code
        == 404
    )
    assert (
        c.post(
            "/api/research/tutors/variant", json={"parentId": "sofie", "id": "sofie", "displayName": "V"}
        ).status_code
        == 409
    )


def test_ids_are_slug_shaped():
    c = _client(RESEARCHER)
    assert c.post("/api/research/tutors", json={"id": "Not A Slug", "displayName": "X"}).status_code == 400


def test_deleting_an_authored_tutor_falls_back_to_the_yaml_base():
    """The YAML catalogue is the floor — deleting can never empty the list."""
    c = _client(RESEARCHER)
    c.post("/api/research/tutors", json={"id": "sofie", "displayName": "Sofie (overridden)"})
    assert _client(TEACHER).get("/api/tutors/sofie").json()["displayName"] == "Sofie (overridden)"
    c.delete("/api/research/tutors/sofie")
    assert _client(TEACHER).get("/api/tutors/sofie").json()["displayName"].startswith("Sofie —")
