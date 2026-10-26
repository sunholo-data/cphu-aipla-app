"""A kettle reading is still in the tutor's prompt after later pushes (1.1.155 M3).

Design: docs/design/aipla/v1.1.0-feedback/sim-context-and-class-report.md (F3)

Every generic-frame push lands on one latest-value key, so a Capture followed by
a slider commit overwrote the reading: the tutor was asked to probe the
student's efficiency arithmetic and could not see the numbers. This drives the
REAL route against a REAL in-memory session service for one full kettle cycle
and renders the instruction the way the provider does, because the bug lived in
the join between the two, not in either half.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from google.adk.sessions import InMemorySessionService

from adk.agui import APP_NAME
from adk.iframe_context import render_instruction_with_iframe_context
from auth import User, get_current_user
from auth.access_context import AccessContext
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex
from protocols.iframe_context_routes import router

_UID = "workshop-user"
_SID = "sess-kettle"
_SIM = "kettle-efficiency"


def _state(power=2000, volume=1.4, elapsed=0.0, captured=0):
    return {
        "power_W": power,
        "volume_L": volume,
        "mass_kg": volume,
        "temperature_C": 20.0 + elapsed / 2,
        "elapsed_s": elapsed,
        "meter_kWh": 0.0,
        "boiling": False,
        "readings_captured": captured,
    }


def _body(kind: str, *, activity_id: str | None = None, **sc) -> dict:
    """The shape GenericArtefactFrame sends: the artefact's structuredContent
    spread, plus `lastEvent` (useSimSnapshotPush)."""
    full = f"{_SIM}.{kind}"
    body = {
        "serverId": _SIM,
        "toolName": "state",
        "structuredContent": {"kind": full, **sc, "lastEvent": full},
    }
    if "label" in sc:
        body["label"] = sc["label"]
    if activity_id:
        body["activityId"] = activity_id
    return body


_READING = {
    "power_W": 2200,
    "mass_kg": 1.4,
    "t_start_C": 20,
    "t_end_C": 67.3,
    "duration_s": 95.0,
    "meter_kWh": 0.0581,
}


@pytest.fixture(autouse=True)
def _skill_exists():
    """Gate 4 needs the session's skill to exist; a catalogued sim then passes
    the server allowlist by catalogue membership (1.1.41)."""
    with patch("protocols.iframe_context_routes.skill_config") as mod:
        mod.get_skill.return_value = SimpleNamespace(skill_metadata=SimpleNamespace(tool_configs={}))
        yield


@pytest.fixture
def session_service() -> InMemorySessionService:
    svc = InMemorySessionService()
    svc.create_session_sync(app_name=APP_NAME, user_id=_UID, session_id=_SID)
    return svc


@pytest.fixture
def client() -> TestClient:
    user = User(uid=_UID, email="", domain="")
    ctx = AccessContext(uid=_UID, email="", domain="", group_tags=frozenset())
    app = FastAPI()
    app.include_router(router)

    @app.middleware("http")
    async def _inject_access(request, call_next):
        request.state.access = ctx
        return await call_next(request)

    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _index() -> ChatSessionIndex:
    now = datetime.now(UTC)
    return ChatSessionIndex(
        sessionId=_SID,
        documentIds=[],
        skillId="concept-dialogue",
        ownerUid=_UID,
        accessControl=AccessControl(type="public"),
        title=None,
        turnCount=0,
        firstMessageAt=now,
        lastMessageAt=now,
        archivedAt=None,
    )


def _post(client: TestClient, body: dict) -> None:
    resp = client.post(f"/api/sessions/{_SID}/iframe-context", json=body)
    assert resp.status_code == 204, resp.text


def _state_now(svc: InMemorySessionService) -> dict:
    session = svc.get_session_sync(app_name=APP_NAME, user_id=_UID, session_id=_SID)
    assert session is not None
    return dict(session.state)


def _cycle(client: TestClient, activity_id: str | None = None) -> None:
    a = {"activity_id": activity_id}
    _post(client, _body("open", state=_state(), **a))
    _post(client, _body("state-change", state=_state(power=2200), changed=["power_W"], **a))
    _post(client, _body("run", state=_state(power=2200), label="Tændte kedlen: 2200 W, 1,4 L", **a))
    _post(client, _body("stop", state=_state(power=2200, elapsed=95.0), **a))
    _post(
        client,
        _body(
            "reading",
            state=_state(power=2200, elapsed=95.0, captured=1),
            reading=_READING,
            label="Registrerede aflæsning: 67,3 °C efter 95,0 s",
            **a,
        ),
    )
    # The push that used to erase the reading from the tutor's view.
    _post(client, _body("state-change", state=_state(power=1000, captured=1), changed=["power_W"], **a))


@patch("protocols.iframe_context_routes.get_session_index")
@patch("protocols.iframe_context_routes.get_session_service")
def test_reading_one_survives_the_next_push(mock_svc, mock_index, session_service, client):
    mock_svc.return_value = session_service
    mock_index.return_value = _index()

    _cycle(client)

    state = _state_now(session_service)
    # The latest-value key is unchanged in shape: it holds only the last push.
    latest = state[f"mcp_app_context.{_SIM}.state"]["structuredContent"]
    assert latest["kind"] == f"{_SIM}.state-change" and "reading" not in latest

    rendered = render_instruction_with_iframe_context("BASE", state)
    assert "#1 P 2200 W · m 1.4 kg · start 20 °C · slut 67.3 °C · t 95 s" in rendered
    # No reply yet, so the whole session's changes collapse into one span.
    assert "Effekt 2000 → 1000 W" in rendered
    # Raw internal names and host bookkeeping are gone from the prompt.
    assert "power_W" not in rendered and "_pushedAt" not in rendered and "_label" not in rendered


@patch("protocols.iframe_context_routes.get_session_index")
@patch("protocols.iframe_context_routes.get_session_service")
def test_the_ledger_speaks_the_activitys_language(mock_svc, mock_index, session_service, client):
    mock_svc.return_value = session_service
    mock_index.return_value = _index()

    with patch("adk.teacher_focus.resolve_active_config", return_value=SimpleNamespace(language="en")) as resolve:
        _cycle(client, activity_id="act-english")

    # Resolved once, when the ledger was created — not on every push.
    assert resolve.call_count == 1
    rendered = render_instruction_with_iframe_context("BASE", _state_now(session_service))
    assert "Readings so far:" in rendered and "Aflæsninger" not in rendered
    assert "#1 P 2200 W · m 1.4 kg · start 20 °C · end 67.3 °C" in rendered


@patch("protocols.iframe_context_routes.get_session_index")
@patch("protocols.iframe_context_routes.get_session_service")
def test_since_the_last_reply_names_only_what_followed_it(mock_svc, mock_index, session_service, client):
    mock_svc.return_value = session_service
    mock_index.return_value = _index()

    _post(client, _body("open", state=_state()))
    _post(client, _body("run", state=_state(), label="x"))
    state = _state_now(session_service)
    reply_at = state[f"mcp_app_ledger.{_SIM}"]["events"][-1]["at"] + 0.001
    _post(client, _body("reading", state=_state(elapsed=60.0), reading=_READING, label="y"))

    rendered = render_instruction_with_iframe_context("BASE", _state_now(session_service), last_tutor_reply_at=reply_at)
    since = next(line for line in rendered.splitlines() if line.startswith("Siden dit sidste svar"))
    assert "registrerede aflæsning #1" in since
    assert "startede" not in since


@patch("protocols.iframe_context_routes.get_session_index")
@patch("protocols.iframe_context_routes.get_session_service")
def test_a_sim_without_a_record_keeps_the_raw_block(mock_svc, mock_index, session_service, client):
    """Additive: every undeclared sim renders exactly as before, minus the host
    bookkeeping fields."""
    mock_svc.return_value = session_service
    mock_index.return_value = _index()

    _post(
        client,
        {
            "serverId": "boldkast",
            "toolName": "state",
            "structuredContent": {"lastEvent": "boldkast.show_value", "v0": 15.0, "theta": 40.0},
            "label": "Viste y_max",
        },
    )
    state = _state_now(session_service)
    assert not any(k.startswith("mcp_app_ledger.") for k in state)
    rendered = render_instruction_with_iframe_context("BASE", state)
    assert '"v0": 15.0' in rendered
    assert "_pushedAt" not in rendered and "_label" not in rendered
