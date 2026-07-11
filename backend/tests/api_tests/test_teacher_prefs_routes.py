"""SETTINGS-1 M0 — /api/teacher/prefs.

Headline: OWN-UID ONLY (the uid comes from the verified token, never a
param) and unset ⇒ {} so every consumer degrades to today's behaviour.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from protocols.teacher_prefs_routes import router


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


def test_unset_prefs_read_as_empty():
    assert _client(User(uid="t-1")).get("/api/teacher/prefs").json() == {}


def test_put_partial_merges_and_round_trips():
    c = _client(User(uid="t-1"))
    assert c.put("/api/teacher/prefs", json={"defaultLanguage": "en"}).status_code == 200
    c.put("/api/teacher/prefs", json={"defaultPersonaId": "astrid"})
    body = c.get("/api/teacher/prefs").json()
    assert body["defaultLanguage"] == "en"
    assert body["defaultPersonaId"] == "astrid"
    # clearing one field leaves the other
    c.put("/api/teacher/prefs", json={"defaultLanguage": None})
    body = c.get("/api/teacher/prefs").json()
    assert body.get("defaultLanguage") is None and body["defaultPersonaId"] == "astrid"


def test_features_opt_in_round_trips():
    c = _client(User(uid="t-1"))
    c.put("/api/teacher/prefs", json={"features": {"authoringCopilot": True}})
    assert c.get("/api/teacher/prefs").json()["features"] == {"authoringCopilot": True}


def test_validation_unknown_field_and_bad_language_422():
    c = _client(User(uid="t-1"))
    assert c.put("/api/teacher/prefs", json={"bogus": 1}).status_code == 422
    assert c.put("/api/teacher/prefs", json={"defaultLanguage": "fr"}).status_code == 422


def test_prefs_are_per_uid():
    a, b = _client(User(uid="t-a")), _client(User(uid="t-b"))
    a.put("/api/teacher/prefs", json={"defaultLanguage": "en"})
    assert b.get("/api/teacher/prefs").json() == {}


def test_anonymous_group_student_is_rejected():
    # ADR-001 corner: a group student (synthetic uid, group_id claim) must not
    # get a teacher prefs doc — the route requires a real teacher identity.
    student = User(uid="student-anon", group_id="grp-1", auth_mode="anonymous_group_id")
    c = _client(student)
    assert c.get("/api/teacher/prefs").status_code == 403
    assert c.put("/api/teacher/prefs", json={"defaultLanguage": "en"}).status_code == 403
