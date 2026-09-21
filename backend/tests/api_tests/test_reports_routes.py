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
    # No BQ creds in test -> the BQ latest-session finder returns None and we
    # fall back to the Firestore index (which picks the newest by lastMessageAt).
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


def test_group_report_prefers_bq_latest_over_index(client):
    """The chat-turn log (BigQuery) wins: even with a newer but turn-less index
    session, the report shows the session BQ says actually has the latest chat.
    Reproduces the tilted-petal-71 bug — a bare join shadowing the real one."""
    from reports.session_summary import SessionSummary, SessionTurn

    # Index "latest" is a bare join with no conversation (the empty shell).
    _seed_session(
        session_id="bare-join",
        owner_uid="anon-boldkazoo87-zzz",
        last_at=datetime(2026, 5, 26, 9, 0, 0, tzinfo=UTC),
    )
    real = SessionSummary(
        sessionId="bq-real",
        groupCode="bold-kazoo-87",
        activityId="boldkast",
        startedAt=datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC),
        endedAt=datetime(2026, 5, 25, 14, 5, 0, tzinfo=UTC),
        durationSeconds=300,
        messageCount=2,
        simRunCount=0,
        conversation=[SessionTurn(timestamp="2026-05-25T14:00:00+00:00", role="student", content="hej")],
    )

    async def _resolve(session_id: str):
        return real if session_id == "bq-real" else None

    with (
        patch("protocols.reports_routes.find_latest_session_id_for_group_bq", return_value="bq-real"),
        patch("protocols.reports_routes.resolve_session_summary", side_effect=_resolve),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
    ):
        resp = client.get("/api/reports/groups/bold-kazoo-87")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sessionId"] == "bq-real"  # NOT "bare-join"
    assert body["messageCount"] == 2


def test_group_report_enriches_class_link_and_activity_name(client):
    """The report carries the class (for a back-link) + a real activity name,
    not the raw skill UUID — so a teacher landing on a group report knows which
    class/activity it came from."""
    from reports.session_summary import SessionSummary, SessionTurn

    summary = SessionSummary(
        sessionId="s",
        groupCode="bold-kazoo-87",
        activityId="ec34861d-uuid",
        startedAt=datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC),
        durationSeconds=0,
        messageCount=1,
        simRunCount=0,
        conversation=[SessionTurn(timestamp="2026-05-25T14:00:00+00:00", role="student", content="hej")],
    )
    fake_class = MagicMock()
    fake_class.class_id = "cls-xyz"
    fake_class.name = "My class 1"

    async def _resolve(_sid):
        return summary

    with (
        patch("protocols.reports_routes.find_latest_session_id_for_group_bq", return_value="s"),
        patch("protocols.reports_routes.resolve_session_summary", side_effect=_resolve),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
        patch("db.classes.get_class_for_group", return_value=fake_class),
        patch("db.firestore.get_document", return_value={"displayName": "Boldkast Projectile"}),
    ):
        resp = client.get("/api/reports/groups/bold-kazoo-87")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["classId"] == "cls-xyz"
    assert body["className"] == "My class 1"
    assert body["activityName"] == "Boldkast Projectile"  # resolved, not the UUID


# ── 1.1.107 M5: the "Teaching approach" section, role-split ──────────────────


def _fidelity_result(**over):
    from analytics.framework_fidelity import FidelityResult

    return FidelityResult(
        sessionId="s-9",
        frameworkId="esru",
        frameworkLabel="Question-and-use cycle (ESRU)",
        model="gemini-x",
        summary="The tutor elicited and recognised, but rarely used the answers.",
        drift=["Use phase missing in the second half."],
        overallBand="partial",
        constructs={"elicit": {"band": "strong", "score": 2, "rationale": "r", "evidence": [0]}},
        evidenceSummary={"units": 8, "tutor": 4, "student": 4},
        basedOnMessageCount=8,
        **over,
    )


def _summary_for_fidelity():
    from reports.session_summary import SessionSummary, SessionTurn

    return SessionSummary(
        sessionId="s-9",
        groupCode="bold-kazoo-87",
        activityId="boldkast",
        startedAt=datetime(2026, 9, 21, 10, 0, tzinfo=UTC),
        endedAt=datetime(2026, 9, 21, 10, 20, tzinfo=UTC),
        durationSeconds=1200,
        messageCount=8,
        simRunCount=0,
        conversation=[SessionTurn(timestamp="2026-09-21T10:00:00+00:00", role="student", content="hej")],
        frameworkId="esru",
    )


def _client_as(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def test_teacher_gets_the_prose_but_no_bands():
    """Fit is not quality: a teacher reads what the approach looked like and
    where it drifted, never a score about their own tutor (1.1.65 R1)."""

    async def _resolve(session_id: str):
        return _summary_for_fidelity()

    with (
        patch("protocols.reports_routes.resolve_session_summary", side_effect=_resolve),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
        patch("protocols.reports_routes.resolve_fidelity", new=AsyncMock(return_value=_fidelity_result())),
    ):
        resp = _client_as(User(uid="t-1", email="t@x.dk", is_teacher=True)).get("/api/reports/sessions/s-9")
    assert resp.status_code == 200, resp.text
    fid = resp.json()["fidelity"]
    assert fid["frameworkLabel"] == "Question-and-use cycle (ESRU)"
    assert fid["summary"].startswith("The tutor elicited")
    assert fid["drift"] == ["Use phase missing in the second half."]
    assert "constructs" not in fid and "overallBand" not in fid


def test_researcher_gets_the_construct_detail():
    async def _resolve(session_id: str):
        return _summary_for_fidelity()

    with (
        patch("protocols.reports_routes.resolve_session_summary", side_effect=_resolve),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
        patch("protocols.reports_routes.resolve_fidelity", new=AsyncMock(return_value=_fidelity_result())),
    ):
        resp = _client_as(User(uid="r-1", email="r@x.dk", is_teacher=True, is_researcher=True)).get(
            "/api/reports/sessions/s-9"
        )
    fid = resp.json()["fidelity"]
    assert fid["overallBand"] == "partial"
    assert fid["constructs"]["elicit"]["score"] == 2
    assert fid["evidenceSummary"]["tutor"] == 4


def test_verify_path_stays_llm_free(client):
    """`narrative=false` (the pipeline-verify path) runs neither the narrative
    nor the fidelity judge."""

    async def _resolve(session_id: str):
        return _summary_for_fidelity()

    with (
        patch("protocols.reports_routes.resolve_session_summary", side_effect=_resolve),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()) as narr,
        patch("protocols.reports_routes.resolve_fidelity", new=AsyncMock()) as fid,
    ):
        resp = client.get("/api/reports/sessions/s-9?narrative=false")
    assert resp.status_code == 200
    assert resp.json()["fidelity"] is None
    narr.assert_not_called()
    fid.assert_not_called()


def test_a_failed_fidelity_read_never_breaks_the_report(client):
    async def _resolve(session_id: str):
        return _summary_for_fidelity()

    with (
        patch("protocols.reports_routes.resolve_session_summary", side_effect=_resolve),
        patch("protocols.reports_routes.resolve_narrative", new=AsyncMock()),
        patch("protocols.reports_routes.resolve_fidelity", new=AsyncMock(return_value=None)),
    ):
        resp = client.get("/api/reports/sessions/s-9")
    assert resp.status_code == 200
    assert resp.json()["fidelity"] is None
