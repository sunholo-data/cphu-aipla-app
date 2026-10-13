"""Per-teacher features: the caller's own map, and the programme toggle (2026-10-13)."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import auth
from auth import firebase_auth
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db import firestore as fs_module
from db.teacher_access import get_grant, grant_access
from protocols.programme_routes import router as programme_router
from protocols.teacher_features_routes import router as features_router


@pytest.fixture(autouse=True)
def _store(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    grant_access("teacher@example.dk", uid="t-1")
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(features_router)
    app.include_router(programme_router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[auth.get_current_user] = _override  # features route: the dispatcher
    app.dependency_overrides[firebase_auth.get_current_user] = _override  # programme routes: Firebase-only
    return TestClient(app)


TEACHER = User(uid="t-1", email="teacher@example.dk", is_teacher=True)
RESEARCHER = User(uid="r-1", email="r@example.dk", is_teacher=True, is_researcher=True)


def test_a_teacher_starts_without_the_sim_workshop():
    body = _client(TEACHER).get("/api/teacher/features").json()
    assert body == {"features": {"simWorkshop": False}, "researcher": False}


def test_a_researcher_has_every_feature():
    assert _client(RESEARCHER).get("/api/teacher/features").json()["features"]["simWorkshop"] is True


def test_a_researcher_switches_it_on_and_the_teacher_then_has_it():
    r = _client(RESEARCHER).post(
        "/api/programme/access/features",
        json={"email": "teacher@example.dk", "feature": "simWorkshop", "enabled": True},
    )
    assert r.status_code == 200 and r.json()["features"] == {"simWorkshop": True}
    assert _client(TEACHER).get("/api/teacher/features").json()["features"]["simWorkshop"] is True
    listed = _client(RESEARCHER).get("/api/programme/access/list").json()["grants"]
    assert listed[0]["features"] == {"simWorkshop": True}


def test_a_plain_teacher_cannot_switch_features():
    r = _client(TEACHER).post(
        "/api/programme/access/features",
        json={"email": "teacher@example.dk", "feature": "simWorkshop", "enabled": True},
    )
    assert r.status_code == 404


def test_unknown_feature_and_unknown_teacher_are_refused():
    c = _client(RESEARCHER)
    assert (
        c.post(
            "/api/programme/access/features", json={"email": "teacher@example.dk", "feature": "x", "enabled": True}
        ).status_code
        == 422
    )
    assert (
        c.post(
            "/api/programme/access/features",
            json={"email": "nobody@example.dk", "feature": "simWorkshop", "enabled": True},
        ).status_code
        == 404
    )


def test_a_regrant_keeps_the_switches():
    from db.teacher_access import set_feature

    set_feature("teacher@example.dk", "simWorkshop", True)
    grant_access("teacher@example.dk", monthly_cap_usd=12.0)  # a cap edit rewrites the row
    assert get_grant("teacher@example.dk").features == {"simWorkshop": True}
