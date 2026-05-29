"""API tests for /api/reports endpoints."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.firestore import set_document
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex
from protocols.reports_routes import router


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


@pytest.fixture()
def app():
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid="teacher-1", email="teacher@example.test")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


def _seed_session(*, session_id: str, owner_uid: str, last_at: datetime) -> None:
    idx = ChatSessionIndex(
        sessionId=session_id,
        skillId="boldkast",
        ownerUid=owner_uid,
        accessControl=AccessControl(type="public"),
        firstMessageAt=last_at,
        lastMessageAt=last_at,
    )
    set_document("chat_sessions", session_id, idx.model_dump(by_alias=True, mode="json"))


def _fake_adk_session():
    s = MagicMock()
    part = MagicMock()
    part.text = "hello"
    content = MagicMock()
    content.parts = [part]
    event = MagicMock()
    event.author = "user"
    event.timestamp = 1.0
    event.content = content
    s.events = [event]
    s.state = {}
    return s


def test_session_report_404_when_missing(client):
    resp = client.get("/api/reports/sessions/nope")
    assert resp.status_code == 404


def test_session_report_returns_summary(client):
    _seed_session(
        session_id="s1",
        owner_uid="anon-boldkazoo87-aaa",
        last_at=datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC),
    )
    service = MagicMock()
    service.get_session = AsyncMock(return_value=_fake_adk_session())

    with patch("reports.session_summary.get_session_service", return_value=service):
        resp = client.get("/api/reports/sessions/s1")

    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["sessionId"] == "s1"
    # Session-state fallback derives the code from the hyphen-stripped uid, so
    # it returns the cleaned form. Only the BigQuery path (which stores the real
    # user.group_id) round-trips the display code "bold-kazoo-87".
    assert data["groupCode"] == "boldkazoo87"
    assert data["activityId"] == "boldkast"


def test_group_report_404_when_no_sessions(client):
    resp = client.get("/api/reports/groups/bold-kazoo-87")
    assert resp.status_code == 404


def test_group_report_returns_latest(client):
    _seed_session(
        session_id="early",
        owner_uid="anon-boldkazoo87-aaa",
        last_at=datetime(2026, 5, 25, 12, 0, 0, tzinfo=UTC),
    )
    _seed_session(
        session_id="late",
        owner_uid="anon-boldkazoo87-bbb",
        last_at=datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC),
    )
    service = MagicMock()
    service.get_session = AsyncMock(return_value=_fake_adk_session())

    with patch("reports.session_summary.get_session_service", return_value=service):
        resp = client.get("/api/reports/groups/bold-kazoo-87")

    assert resp.status_code == 200, resp.text
    assert resp.json()["sessionId"] == "late"
