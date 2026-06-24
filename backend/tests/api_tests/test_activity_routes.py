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


def _client(uid: str = TEACHER) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router)
    app.include_router(classes_router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", domain="example.test", is_teacher=True)
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
    mine = _client().get("/api/activities?owner=me").json()
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
