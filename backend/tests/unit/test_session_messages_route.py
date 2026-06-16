"""Unit tests for GET /api/sessions/{sessionId}/messages.

Verifies:
- Owner gets 200 with chronologically ordered messages
- Non-owner gets 403 (never 404 — avoids existence leak for sessions)
- Empty / no-text events → empty messages list
- Tool call events (no text content) are filtered out
- Text events from user and assistant are both included
- Missing session → 404
"""

from __future__ import annotations

from datetime import UTC
from unittest.mock import AsyncMock, MagicMock, patch

from protocols.sessions_route import _events_to_interactions, _events_to_messages

# ---------------------------------------------------------------------------
# _events_to_messages unit tests (pure function, no HTTP)
# ---------------------------------------------------------------------------


def _make_event(author: str, text: str | None, timestamp: float = 1.0):
    """Build a minimal ADK-shaped event mock."""
    event = MagicMock()
    event.author = author
    event.timestamp = timestamp
    if text is not None:
        part = MagicMock()
        part.text = text
        event.content = MagicMock()
        event.content.parts = [part]
    else:
        event.content = None
    return event


def _make_state_delta_event(state_delta: dict, timestamp: float = 1.0, author: str = "user"):
    """Build an ADK-shaped event carrying ONLY a state_delta (no text content),
    mirroring what iframe_context_routes writes via append_event for an MCP-app
    interaction."""
    event = MagicMock()
    event.author = author
    event.timestamp = timestamp
    event.content = None  # iframe-context events have no content.parts
    event.actions = MagicMock()
    event.actions.state_delta = state_delta
    return event


def _mcp_state(*, label=None, changed=None):
    """Build the namespaced state_value dict the iframe-context handler writes
    under mcp_app_context.{server}.{tool}."""
    sv: dict = {"_pushedAt": 1.0}
    sc: dict = {}
    if changed is not None:
        sc["changed"] = changed
    if sc:
        sv["structuredContent"] = sc
    if label is not None:
        sv["_label"] = label
    return sv


def _make_multi_part_event(author: str, parts: list[str], timestamp: float = 1.0):
    """Build an event with multiple content parts."""
    event = MagicMock()
    event.author = author
    event.timestamp = timestamp
    part_mocks = []
    for t in parts:
        p = MagicMock()
        p.text = t
        part_mocks.append(p)
    event.content = MagicMock()
    event.content.parts = part_mocks
    return event


class TestEventsToMessages:
    def test_user_event_maps_to_user_role(self):
        events = [_make_event("user", "Hello")]
        msgs = _events_to_messages(events)
        assert len(msgs) == 1
        assert msgs[0].role == "user"
        assert msgs[0].content == "Hello"

    def test_non_user_author_maps_to_assistant(self):
        events = [_make_event("some_skill_agent", "Hi there")]
        msgs = _events_to_messages(events)
        assert msgs[0].role == "assistant"

    def test_event_with_no_content_is_skipped(self):
        events = [_make_event("user", None)]
        msgs = _events_to_messages(events)
        assert msgs == []

    def test_event_with_empty_parts_is_skipped(self):
        event = MagicMock()
        event.author = "user"
        event.timestamp = 1.0
        event.content = MagicMock()
        event.content.parts = []
        msgs = _events_to_messages([event])
        assert msgs == []

    def test_event_with_only_none_text_parts_is_skipped(self):
        event = MagicMock()
        event.author = "user"
        event.timestamp = 1.0
        part = MagicMock()
        part.text = None
        event.content = MagicMock()
        event.content.parts = [part]
        msgs = _events_to_messages([event])
        assert msgs == []

    def test_multi_part_text_is_joined(self):
        events = [_make_multi_part_event("user", ["Hello", " world"], 1.0)]
        msgs = _events_to_messages(events)
        assert msgs[0].content == "Hello  world"

    def test_preserves_timestamp(self):
        events = [_make_event("user", "Hi", timestamp=1714000042)]
        msgs = _events_to_messages(events)
        assert msgs[0].timestamp == 1714000042

    def test_chronological_order_preserved(self):
        events = [
            _make_event("user", "first", 1.0),
            _make_event("assistant_agent", "second", 2.0),
            _make_event("user", "third", 3.0),
        ]
        msgs = _events_to_messages(events)
        assert len(msgs) == 3
        assert msgs[0].content == "first"
        assert msgs[1].content == "second"
        assert msgs[2].content == "third"

    def test_empty_event_list(self):
        assert _events_to_messages([]) == []

    def test_state_delta_only_event_skipped_by_messages(self):
        # Regression: an MCP-app interaction event (state_delta, no content)
        # must NOT appear in the text message list — _events_to_messages stays
        # text-only. (This is the 1.1.34 invariant.)
        ev = _make_state_delta_event({"mcp_app_context.boldkast.state": _mcp_state(label="x")})
        assert _events_to_messages([ev]) == []


# ---------------------------------------------------------------------------
# _events_to_interactions unit tests (1.1.34 — MCP-app interaction restore)
# ---------------------------------------------------------------------------


class TestEventsToInteractions:
    def test_label_used_when_present(self):
        sd = {"mcp_app_context.boldkast.state": _mcp_state(label="Sent question with v0=15, theta=40")}
        out, truncated = _events_to_interactions([_make_state_delta_event(sd, timestamp=5.0)])
        assert truncated is False
        assert len(out) == 1
        assert out[0].label == "Sent question with v0=15, theta=40"
        assert out[0].timestamp == 5.0
        assert out[0].server_id == "boldkast"
        assert out[0].tool_name == "state"

    def test_generic_fallback_when_no_label(self):
        sd = {"mcp_app_context.boldkast.state": _mcp_state()}
        out, _ = _events_to_interactions([_make_state_delta_event(sd)])
        assert len(out) == 1
        assert out[0].label  # non-empty fallback, no crash

    def test_changed_fallback_label(self):
        sd = {"mcp_app_context.ledplanck.state": _mcp_state(changed=["voltage"])}
        out, _ = _events_to_interactions([_make_state_delta_event(sd)])
        assert "voltage" in out[0].label

    def test_non_mcp_state_delta_ignored(self):
        out, _ = _events_to_interactions([_make_state_delta_event({"some.other.key": {"x": 1}})])
        assert out == []

    def test_text_event_does_not_crash_or_match(self):
        # Text events have no real actions.state_delta dict; the reader must
        # tolerate them (the handler passes the SAME event list to both helpers).
        out, _ = _events_to_interactions([_make_event("user", "hello")])
        assert out == []

    def test_coalesces_consecutive_identical(self):
        sv = _mcp_state(label="Played with current config")
        evs = [_make_state_delta_event({"mcp_app_context.boldkast.state": sv}, timestamp=float(i)) for i in range(5)]
        out, _ = _events_to_interactions(evs)
        assert len(out) == 1

    def test_does_not_coalesce_non_consecutive(self):
        a = {"mcp_app_context.boldkast.state": _mcp_state(label="A")}
        b = {"mcp_app_context.boldkast.state": _mcp_state(label="B")}
        evs = [
            _make_state_delta_event(a, 1.0),
            _make_state_delta_event(b, 2.0),
            _make_state_delta_event(a, 3.0),
        ]
        out, _ = _events_to_interactions(evs)
        assert [o.label for o in out] == ["A", "B", "A"]

    def test_cap_and_truncated_flag(self):
        evs = [
            _make_state_delta_event({"mcp_app_context.boldkast.state": _mcp_state(label=f"L{i}")}, timestamp=float(i))
            for i in range(250)
        ]
        out, truncated = _events_to_interactions(evs)
        assert truncated is True
        assert len(out) == 200
        assert out[-1].label == "L249"  # keeps the most-recent 200
        assert out[0].label == "L50"

    def test_empty(self):
        assert _events_to_interactions([]) == ([], False)


# ---------------------------------------------------------------------------
# HTTP endpoint tests (FastAPI TestClient)
# ---------------------------------------------------------------------------


def _make_idx(session_id: str = "sess-1", owner_uid: str = "u1"):
    from datetime import datetime

    from db.models.access import AccessControl
    from db.models.chat_session import ChatSessionIndex

    return ChatSessionIndex(
        sessionId=session_id,
        documentIds=[],
        skillId="skill-x",
        ownerUid=owner_uid,
        accessControl=AccessControl(type="private"),
        firstMessageAt=datetime.now(UTC),
        lastMessageAt=datetime.now(UTC),
    )


def _make_test_client(caller_uid: str = "u1"):
    """Build a FastAPI TestClient with auth + access middleware stubbed."""
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient

    from auth import get_current_user
    from auth.access_context import AccessContext
    from auth.firebase_auth import User
    from protocols.sessions_route import router

    stub_user = User(uid=caller_uid, email=f"{caller_uid}@example.com", domain="example.com")

    app = FastAPI()

    @app.middleware("http")
    async def inject_access(request: Request, call_next):
        request.state.access = AccessContext(uid=caller_uid, domain="example.com")
        return await call_next(request)

    app.dependency_overrides[get_current_user] = lambda: stub_user
    app.include_router(router)
    return TestClient(app)


class TestGetSessionMessages:
    def test_owner_gets_200_with_messages(self):
        idx = _make_idx(owner_uid="u1")
        session_mock = MagicMock()
        session_mock.events = [_make_event("user", "hello", 1.0)]

        with (
            patch("protocols.sessions_route.get_session_index", return_value=idx),
            patch("protocols.sessions_route.get_messages_session_service") as svc_fn,
        ):
            svc = MagicMock()
            svc.get_session = AsyncMock(return_value=session_mock)
            svc_fn.return_value = svc

            resp = _make_test_client(caller_uid="u1").get("/api/sessions/sess-1/messages")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == "sess-1"
        assert len(data["messages"]) == 1
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][0]["content"] == "hello"

    def test_non_owner_gets_403(self):
        idx = _make_idx(owner_uid="u1")

        with patch("protocols.sessions_route.get_session_index", return_value=idx):
            resp = _make_test_client(caller_uid="u2").get("/api/sessions/sess-1/messages")

        assert resp.status_code == 403

    def test_missing_session_gets_404(self):
        with patch("protocols.sessions_route.get_session_index", return_value=None):
            resp = _make_test_client(caller_uid="u1").get("/api/sessions/nonexistent/messages")

        assert resp.status_code == 404

    def test_empty_session_returns_empty_list(self):
        idx = _make_idx(owner_uid="u1")
        session_mock = MagicMock()
        session_mock.events = []

        with (
            patch("protocols.sessions_route.get_session_index", return_value=idx),
            patch("protocols.sessions_route.get_messages_session_service") as svc_fn,
        ):
            svc = MagicMock()
            svc.get_session = AsyncMock(return_value=session_mock)
            svc_fn.return_value = svc

            resp = _make_test_client(caller_uid="u1").get("/api/sessions/sess-1/messages")

        assert resp.status_code == 200
        assert resp.json()["messages"] == []

    def test_tool_events_filtered_only_text_included(self):
        idx = _make_idx(owner_uid="u1")
        session_mock = MagicMock()
        session_mock.events = [
            _make_event("user", "query", 1.0),
            _make_event("agent", None, 2.0),  # tool call — no text content
            _make_event("agent", "result", 3.0),
        ]

        with (
            patch("protocols.sessions_route.get_session_index", return_value=idx),
            patch("protocols.sessions_route.get_messages_session_service") as svc_fn,
        ):
            svc = MagicMock()
            svc.get_session = AsyncMock(return_value=session_mock)
            svc_fn.return_value = svc

            resp = _make_test_client(caller_uid="u1").get("/api/sessions/sess-1/messages")

        messages = resp.json()["messages"]
        assert len(messages) == 2
        assert messages[0]["content"] == "query"
        assert messages[1]["content"] == "result"

    def test_interactions_in_response(self):
        idx = _make_idx(owner_uid="u1")
        session_mock = MagicMock()
        session_mock.events = [
            _make_event("user", "hello", 1.0),
            _make_state_delta_event(
                {"mcp_app_context.boldkast.state": _mcp_state(label="Sent question with v0=15")},
                timestamp=2.0,
            ),
            _make_event("agent", "Good question", 3.0),
        ]

        with (
            patch("protocols.sessions_route.get_session_index", return_value=idx),
            patch("protocols.sessions_route.get_messages_session_service") as svc_fn,
        ):
            svc = MagicMock()
            svc.get_session = AsyncMock(return_value=session_mock)
            svc_fn.return_value = svc

            resp = _make_test_client(caller_uid="u1").get("/api/sessions/sess-1/messages")

        data = resp.json()
        # the state_delta event is NOT a message...
        assert len(data["messages"]) == 2
        # ...but IS surfaced as an interaction
        assert data["interactions_truncated"] is False
        assert len(data["interactions"]) == 1
        assert data["interactions"][0]["label"] == "Sent question with v0=15"
        assert data["interactions"][0]["timestamp"] == 2.0
        assert data["interactions"][0]["server_id"] == "boldkast"
