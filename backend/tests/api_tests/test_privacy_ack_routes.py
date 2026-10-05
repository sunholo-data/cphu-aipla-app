"""Teacher privacy notice — /api/teacher/privacy-notice.

KU legal (2026-10-05): teachers must be informed in writing how their data is
handled before using the platform. The record must show who acknowledged which
version, and when — so: own-uid only, server time, first acknowledgement wins,
and a stale tab cannot acknowledge a version it never showed.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import get_current_user
from auth.access_context import build_access_context
from auth.firebase_auth import User
from db import firestore as fs_module
from db.privacy_ack import PRIVACY_NOTICE_VERSION, list_acknowledgements
from protocols.privacy_ack_routes import router


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


TEACHER = User(uid="t-1", email="t1@school.dk", is_teacher=True)


def test_unacknowledged_until_acknowledged():
    c = _client(TEACHER)
    body = c.get("/api/teacher/privacy-notice").json()
    assert body == {"version": PRIVACY_NOTICE_VERSION, "acknowledged": False, "acknowledgedAt": None}

    r = c.post("/api/teacher/privacy-notice/ack", json={"version": PRIVACY_NOTICE_VERSION})
    assert r.status_code == 200 and r.json()["acknowledged"] is True

    body = c.get("/api/teacher/privacy-notice").json()
    assert body["acknowledged"] is True and body["acknowledgedAt"]


def test_record_holds_who_which_version_and_when():
    _client(TEACHER).post("/api/teacher/privacy-notice/ack", json={"version": PRIVACY_NOTICE_VERSION})
    rows = list_acknowledgements(PRIVACY_NOTICE_VERSION)
    assert len(rows) == 1
    row = rows[0]
    assert row["uid"] == "t-1" and row["email"] == "t1@school.dk"
    assert row["version"] == PRIVACY_NOTICE_VERSION and row["acknowledgedAt"]


def test_first_acknowledgement_wins():
    c = _client(TEACHER)
    first = c.post("/api/teacher/privacy-notice/ack", json={"version": PRIVACY_NOTICE_VERSION}).json()
    again = c.post("/api/teacher/privacy-notice/ack", json={"version": PRIVACY_NOTICE_VERSION}).json()
    assert again["acknowledgedAt"] == first["acknowledgedAt"]


def test_stale_version_is_refused():
    r = _client(TEACHER).post("/api/teacher/privacy-notice/ack", json={"version": "1999-01-01"})
    assert r.status_code == 409
    assert list_acknowledgements() == []


def test_acknowledgement_is_per_teacher():
    _client(TEACHER).post("/api/teacher/privacy-notice/ack", json={"version": PRIVACY_NOTICE_VERSION})
    other = _client(User(uid="t-2", email="t2@school.dk", is_teacher=True))
    assert other.get("/api/teacher/privacy-notice").json()["acknowledged"] is False


def test_students_are_rejected():
    student = User(uid="anon-g1", email="", is_teacher=False, group_id="g1")
    c = _client(student)
    assert c.get("/api/teacher/privacy-notice").status_code == 403
    assert c.post("/api/teacher/privacy-notice/ack", json={"version": PRIVACY_NOTICE_VERSION}).status_code == 403
