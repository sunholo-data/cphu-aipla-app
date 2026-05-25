"""API tests for /api/activity-configs endpoints.

Uses ``InMemoryFirestoreClient`` (via LOCAL_MODE) so writes round-trip
without a real GCP project. Auth is overridden to a fixed teacher uid
so we can exercise the ownership-mismatch 403 branch directly.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from protocols.activity_config_routes import router

TEACHER_UID = "teacher-1"
OTHER_TEACHER_UID = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    """Force the in-memory Firestore client for every test."""
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


@pytest.fixture()
def app():
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=TEACHER_UID, email="teacher@example.test")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _sample_body(**overrides) -> dict:
    body = {
        "activityId": "boldkast",
        "classId": "7b-physics-a-2026",
        "teachingGoal": "Independence of vx and vy; 45° gives the longest range.",
        "language": "da",
        "difficulty": "standard",
        "pairedWorkbench": "boldkast-simulator-v1",
    }
    body.update(overrides)
    return body


# --- POST ---


def test_post_creates_config(client):
    resp = client.post("/api/activity-configs", json=_sample_body())
    assert resp.status_code == 201, resp.text
    data = resp.json()
    assert data["activityId"] == "boldkast"
    assert data["classId"] == "7b-physics-a-2026"
    assert data["teacherUid"] == TEACHER_UID
    assert data["teachingGoal"].startswith("Independence")
    assert "updatedAt" in data


def test_post_is_idempotent_overwrites_existing(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.post(
        "/api/activity-configs",
        json=_sample_body(teachingGoal="A second teaching goal."),
    )
    assert resp.status_code == 201
    assert resp.json()["teachingGoal"] == "A second teaching goal."


def test_post_rejects_unknown_fields(client):
    body = _sample_body()
    body["evilExtra"] = "nope"
    resp = client.post("/api/activity-configs", json=body)
    assert resp.status_code == 422


# --- GET ---


def test_get_returns_404_when_missing(client):
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 404


def test_get_returns_the_saved_config(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 200
    assert resp.json()["teacherUid"] == TEACHER_UID


def test_get_blocks_cross_teacher_access(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.get(f"/api/activity-configs/{OTHER_TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 403


# --- PATCH ---


def test_patch_updates_existing(client):
    client.post("/api/activity-configs", json=_sample_body())
    body = _sample_body(teachingGoal="Revised goal copy.")
    resp = client.patch(
        f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast",
        json=body,
    )
    assert resp.status_code == 200
    assert resp.json()["teachingGoal"] == "Revised goal copy."


def test_patch_rejects_url_body_mismatch(client):
    body = _sample_body(classId="some-other-class")
    resp = client.patch(
        f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast",
        json=body,
    )
    assert resp.status_code == 400


# --- DELETE ---


def test_delete_is_idempotent(client):
    # Delete-without-create still returns 204.
    resp = client.delete(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 204

    client.post("/api/activity-configs", json=_sample_body())
    resp = client.delete(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 204

    # After delete, GET 404s.
    resp = client.get(f"/api/activity-configs/{TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 404


def test_delete_blocks_cross_teacher(client):
    client.post("/api/activity-configs", json=_sample_body())
    resp = client.delete(f"/api/activity-configs/{OTHER_TEACHER_UID}/7b-physics-a-2026/boldkast")
    assert resp.status_code == 403
