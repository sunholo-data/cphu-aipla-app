"""API tests for /api/sessions/{id}/greet — proactive tutor Phase A."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.firestore import set_document
from db.models import SkillConfig
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex
from protocols.proactive_routes import router

TEACHER_UID = "teacher-1"
NEW_SESSION_ID = "sess-fresh"
ESTABLISHED_SESSION_ID = "sess-old"


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
        u = User(uid=TEACHER_UID, email="teacher@example.test")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


# --- helpers ---


def _make_skill(*, name: str, proactive_greet: bool, opening: str = "") -> SkillConfig:
    return SkillConfig(
        name=name,
        description="A test skill.",
        instructions="You are a helpful tutor.",
        skillId=f"skill-{name}",
        slug=name,
        displayName=name,
        ownerEmail="mark@aitana.ai",
        ownerId="platform",
        proactiveGreet=proactive_greet,
        openingTemplate=opening,
    )


def _seed_existing_session(*, turn_count: int) -> None:
    """Drop a ChatSessionIndex row directly into the in-memory store."""
    idx = ChatSessionIndex(
        sessionId=ESTABLISHED_SESSION_ID,
        skillId="skill-prior",
        ownerUid=TEACHER_UID,
        accessControl=AccessControl(type="public"),
        firstMessageAt=datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC),
        lastMessageAt=datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC),
        turnCount=turn_count,
    )
    set_document("chat_sessions", ESTABLISHED_SESSION_ID, idx.model_dump(by_alias=True, mode="json"))


async def _fake_process_skill_request(*args, **kwargs):
    """Yield two TEXT_MESSAGE_CONTENT events that concatenate to the
    full assistant message. Mirrors the AG-UI wire shape."""
    yield {"type": "TEXT_MESSAGE_CONTENT", "delta": "Hej! "}
    yield {"type": "TEXT_MESSAGE_CONTENT", "delta": "Velkommen til Boldkast."}


# --- tests ---


def test_greet_fires_on_fresh_session(client):
    skill = _make_skill(name="boldkast", proactive_greet=True, opening="Greet the student in Danish.")
    with (
        patch("protocols.proactive_routes.get_skill", return_value=skill),
        patch(
            "protocols.proactive_routes.process_skill_request",
            side_effect=_fake_process_skill_request,
        ),
    ):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["skipped"] is False
    assert data["text"] == "Hej! Velkommen til Boldkast."
    assert data["sessionId"] == NEW_SESSION_ID


def test_greet_skipped_when_group_turn_in_flight(client):
    """1.1.53 M0 — a proactive greet must not race a student turn already in
    flight on the shared group session; it skips gracefully (skipped=True)."""
    from skills.skill_processor import TurnLockedError

    async def _raise_turn_locked(*_args, **_kwargs):
        raise TurnLockedError("grp-1")
        yield  # pragma: no cover — makes this an async generator

    skill = _make_skill(name="boldkast", proactive_greet=True, opening="Greet the student in Danish.")
    with (
        patch("protocols.proactive_routes.get_skill", return_value=skill),
        patch("protocols.proactive_routes.process_skill_request", side_effect=_raise_turn_locked),
    ):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["skipped"] is True
    assert data["text"] == ""


def test_greet_skipped_when_session_has_prior_turns(client):
    _seed_existing_session(turn_count=4)
    skill = _make_skill(name="boldkast", proactive_greet=True, opening="…")
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = client.post(
            f"/api/sessions/{ESTABLISHED_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["skipped"] is True
    assert "prior turns" in data["reason"]


def test_greet_skipped_when_skill_opts_out(client):
    skill = _make_skill(name="legacy", proactive_greet=False)
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["skipped"] is True
    assert "opted out" in data["reason"]


def test_greet_skipped_when_skill_has_no_opening_template(client):
    skill = _make_skill(name="bare", proactive_greet=True, opening="")
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["skipped"] is True
    assert "opening template" in data["reason"]


def test_greet_404_when_skill_missing(client):
    with patch("protocols.proactive_routes.get_skill", return_value=None):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": "no-such-skill"},
        )
    assert resp.status_code == 404


def test_greet_rejects_unknown_body_fields(client):
    resp = client.post(
        f"/api/sessions/{NEW_SESSION_ID}/greet",
        json={"skillId": "x", "evilExtra": True},
    )
    assert resp.status_code == 422


def test_greet_idempotent_on_resume_does_not_invoke_agent(client):
    """Belt-and-braces — second call on an established session must
    NOT call process_skill_request (no token cost on every reload)."""
    _seed_existing_session(turn_count=4)
    skill = _make_skill(name="boldkast", proactive_greet=True, opening="…")
    process_mock = AsyncMock(side_effect=_fake_process_skill_request)
    with (
        patch("protocols.proactive_routes.get_skill", return_value=skill),
        patch("protocols.proactive_routes.process_skill_request", process_mock),
    ):
        resp = client.post(
            f"/api/sessions/{ESTABLISHED_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200
    assert resp.json()["skipped"] is True
    process_mock.assert_not_called()


def test_greet_increments_proactive_turn_count_on_success(client):
    """Sprint PROACTIVE-SIM-REACTIVE M4: a successful greet stamps
    proactiveTurnCount + lastProactiveTurnAt on the session doc so the
    /proactive-event-check gate (M5) sees auto-greet as counting toward
    the per-session cap. Without this, the effective cap of 2 would
    silently become 3 (1 greet + 2 reactive)."""
    skill = _make_skill(name="boldkast", proactive_greet=True, opening="Greet in Danish.")
    with (
        patch("protocols.proactive_routes.get_skill", return_value=skill),
        patch(
            "protocols.proactive_routes.process_skill_request",
            side_effect=_fake_process_skill_request,
        ),
        patch("protocols.proactive_routes.increment_proactive_turn_count_no_stamp") as mock_incr,
    ):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200
    assert resp.json()["skipped"] is False
    mock_incr.assert_called_once_with(NEW_SESSION_ID)


def test_greet_does_not_increment_when_skipped(client):
    """Skipped greets (skill opted out, no opening template, prior turns)
    must NOT burn a cap slot — only turns that actually produce text
    count. Otherwise opting in to proactiveGreet=False would still
    consume the same session's proactive budget."""
    skill = _make_skill(name="legacy", proactive_greet=False)
    with (
        patch("protocols.proactive_routes.get_skill", return_value=skill),
        patch("protocols.proactive_routes.increment_proactive_turn_count_no_stamp") as mock_incr,
    ):
        resp = client.post(
            f"/api/sessions/{NEW_SESSION_ID}/greet",
            json={"skillId": skill.skill_id},
        )
    assert resp.status_code == 200
    assert resp.json()["skipped"] is True
    mock_incr.assert_not_called()
