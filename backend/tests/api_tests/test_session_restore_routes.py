"""API tests for POST /api/sessions/{id}/restore (sprint 1.F M3).

The restore endpoint is called by the frontend immediately after a re-join
to load the prior conversation history and workbench state so the student
sees their previous work.

Auth model: same can_access() check as the existing /messages endpoint.
Archived sessions return 404 (the teacher-reset path).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import AccessContext


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LOCAL_MODE", "1")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_app_with_user(user: User, access_ctx: AccessContext) -> FastAPI:
    from protocols.session_restore_routes import router

    app = FastAPI()
    app.include_router(router)

    @app.middleware("http")
    async def _inject(request, call_next):
        request.state.access = access_ctx
        return await call_next(request)

    app.dependency_overrides[get_current_user] = lambda: user
    return app


def _anon_user(uid: str = "anon-local-demo-abc", group_id: str = "local-demo") -> User:
    return User(uid=uid, email="", domain="", auth_mode="anonymous_group_id", group_id=group_id)


def _anon_ctx(uid: str = "anon-local-demo-abc") -> AccessContext:
    return AccessContext(uid=uid, email="", domain="")


def _mock_session_index(session_id: str, archived: bool = False, group_code: str | None = None):
    from datetime import UTC, datetime

    from db.models.access import AccessControl
    from db.models.chat_session import ChatSessionIndex

    idx = MagicMock(spec=ChatSessionIndex)
    idx.session_id = session_id
    idx.owner_uid = "anon-local-demo-abc"
    idx.skill_id = "problem-set-hints"
    # Legacy ``archived_at``-only path (teacher reset) still goes through
    # this fixture's ``archived`` boolean; new tests opt into the
    # explicit-archive flag by setting both ``archived`` and the new
    # ``archived`` attribute via the QUICK-WINS-V11 flag.
    idx.archived_at = datetime.now(UTC) if archived else None
    idx.archived = False
    idx.access_control = AccessControl(type="public")
    idx.group_code = group_code
    return idx


def _mock_event(role: str, text: str, ts: float = 1.0):
    evt = MagicMock()
    evt.author = "user" if role == "user" else "model"
    evt.timestamp = ts
    part = MagicMock()
    part.text = text
    evt.content = MagicMock()
    evt.content.parts = [part]
    return evt


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestSessionRestore:
    def test_restore_returns_messages_and_workbench_state(self):
        user = _anon_user()
        ctx = _anon_ctx()
        app = _make_app_with_user(user, ctx)
        client = TestClient(app)

        session_id = "sess-restore-001"
        events = [
            _mock_event("user", "Hello tutor", ts=1.0),
            _mock_event("assistant", "Hello! Ready to help.", ts=2.0),
        ]
        mock_session = MagicMock()
        mock_session.events = events
        mock_session.state = {"mcp_app_context.boldkast.set_params": {"v0": 20, "theta": 45}}

        with (
            patch("protocols.session_restore_routes.get_session_index", return_value=_mock_session_index(session_id)),
            patch("protocols.session_restore_routes.get_session_service") as mock_svc_factory,
        ):
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=mock_session)
            mock_svc_factory.return_value = mock_svc

            resp = client.post(f"/api/sessions/{session_id}/restore")

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["messages"]) == 2
        assert body["messages"][0]["role"] == "user"
        assert body["messages"][1]["role"] == "assistant"
        assert body["workbenchState"] == {"mcp_app_context.boldkast.set_params": {"v0": 20, "theta": 45}}
        assert body["olderTurnsSummary"] is None

    def test_restore_caps_messages_at_50(self):
        user = _anon_user()
        ctx = _anon_ctx()
        app = _make_app_with_user(user, ctx)
        client = TestClient(app)

        session_id = "sess-restore-long"
        events = [_mock_event("user", f"msg {i}", ts=float(i)) for i in range(80)]
        mock_session = MagicMock()
        mock_session.events = events
        mock_session.state = {}

        with (
            patch("protocols.session_restore_routes.get_session_index", return_value=_mock_session_index(session_id)),
            patch("protocols.session_restore_routes.get_session_service") as mock_svc_factory,
        ):
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=mock_session)
            mock_svc_factory.return_value = mock_svc

            resp = client.post(f"/api/sessions/{session_id}/restore")

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["messages"]) == 50

    def test_restore_returns_404_for_archived_session(self):
        user = _anon_user()
        ctx = _anon_ctx()
        app = _make_app_with_user(user, ctx)
        client = TestClient(app)

        session_id = "sess-archived"
        with patch(
            "protocols.session_restore_routes.get_session_index",
            return_value=_mock_session_index(session_id, archived=True),
        ):
            resp = client.post(f"/api/sessions/{session_id}/restore")

        assert resp.status_code == 404

    def test_restore_returns_404_for_unknown_session(self):
        user = _anon_user()
        ctx = _anon_ctx()
        app = _make_app_with_user(user, ctx)
        client = TestClient(app)

        with patch("protocols.session_restore_routes.get_session_index", return_value=None):
            resp = client.post("/api/sessions/sess-unknown/restore")

        assert resp.status_code == 404

    def test_restore_returns_empty_when_no_adk_session(self):
        """ADK session not yet created (e.g. bootstrap ran but no messages sent)."""
        user = _anon_user()
        ctx = _anon_ctx()
        app = _make_app_with_user(user, ctx)
        client = TestClient(app)

        session_id = "sess-empty"
        with (
            patch("protocols.session_restore_routes.get_session_index", return_value=_mock_session_index(session_id)),
            patch("protocols.session_restore_routes.get_session_service") as mock_svc_factory,
        ):
            mock_svc = AsyncMock()
            mock_svc.get_session = AsyncMock(return_value=None)
            mock_svc_factory.return_value = mock_svc

            resp = client.post(f"/api/sessions/{session_id}/restore")

        assert resp.status_code == 200
        body = resp.json()
        assert body["messages"] == []
        assert body["workbenchState"] == {}
