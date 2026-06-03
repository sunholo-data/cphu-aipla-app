"""API tests for /api/sessions/{id}/proactive-event-check — Phase B gate
(sprint PROACTIVE-SIM-REACTIVE M5).

The endpoint is a pure gate decision — it MUST NOT invoke the agent.
The frontend takes its `trigger` sentinel and POSTs to the existing
AG-UI chat endpoint to actually fire the proactive turn, so the
proactive turn rides the established protocol stack like any
user-driven turn (architecture Path B per the design doc).

Cases:
  1. happy path → 200, shouldFire=true, correct trigger sentinel
  2. skill missing → 404
  3. skill opted out (proactive_event_reactive=false) → 200, skipped reason
  4. event kind not in allowlist (slider_drag, reset, made-up) → 200, skipped
  5. session not found → 404 (frontend shouldn't call before any activity)
  6. student recently active (within heartbeat threshold) → 200, skipped
  7. cooldown active (recent proactive turn) → 200, skipped
  8. cap reached (proactive_turn_count >= max) → 200, skipped
  9. anonymous-group user (no email, synthetic uid) — happy path still works
 10. event_payload accepted and ignored (forward-compat slot)
 11. unknown body fields rejected (422)
 12. agent module is never invoked from this endpoint (belt-and-braces)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

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
ANON_GROUP_UID = "anon-local-demo-xyz"
SESSION_ID = "sess-active"


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
def app_anon():
    """Anonymous-group user variant — email="", no Firebase identity,
    synthetic uid. Memory feedback_anonymous_users_are_corner_case:
    every identity-touching surface must work for this user shape too,
    not only for Firebase teachers."""
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=ANON_GROUP_UID, email="", auth_mode="anonymous_group_id", group_id="local-demo")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


@pytest.fixture()
def client(app):
    return TestClient(app)


@pytest.fixture()
def client_anon(app_anon):
    return TestClient(app_anon)


# --- helpers ---


def _make_skill(
    *,
    name: str = "boldkast",
    proactive_event_reactive: bool = True,
    heartbeat_seconds: int = 10,
    max_per_session: int | None = None,
) -> SkillConfig:
    """Build a SkillConfig fixture for proactive-event-check tests.

    ``max_per_session`` defaults to None matching the post-2026-06-03
    "no cap, cooldown is the throttle" posture. Tests that want to
    exercise the cap-reached branch must pass an explicit positive int.
    """
    return SkillConfig(
        name=name,
        description="A test skill.",
        instructions="You are a helpful tutor.",
        skillId=f"skill-{name}",
        slug=name,
        displayName=name,
        ownerEmail="mark@aitana.ai",
        ownerId="platform",
        proactiveEventReactive=proactive_event_reactive,
        proactiveHeartbeatSeconds=heartbeat_seconds,
        proactiveMaxPerSession=max_per_session,
        reactiveTemplate="Acknowledge what the student just did. Ask one short question.",
    )


def _seed_session(
    *,
    session_id: str = SESSION_ID,
    turn_count: int = 2,
    last_message_at: datetime | None = None,
    last_student_message_at: datetime | None = None,
    last_proactive_turn_at: datetime | None = None,
    proactive_turn_count: int = 0,
    owner_uid: str = TEACHER_UID,
) -> None:
    """Drop a ChatSessionIndex row directly into the in-memory store with
    full control over the time-based gate inputs.

    ``last_student_message_at`` defaults to None which matches a fresh
    session where the student has not typed anything yet (e.g. they
    joined, the auto-greet streamed in, and they pressed Afspil before
    typing). The gate treats None as vacuously passing — a real
    student message has not yet established a "recently active" window.
    """
    base_ts = datetime(2026, 6, 1, 12, 0, 0, tzinfo=UTC)
    idx = ChatSessionIndex(
        sessionId=session_id,
        skillId="skill-boldkast",
        ownerUid=owner_uid,
        accessControl=AccessControl(type="public"),
        firstMessageAt=base_ts,
        lastMessageAt=last_message_at if last_message_at is not None else base_ts,
        lastStudentMessageAt=last_student_message_at,
        turnCount=turn_count,
        proactiveTurnCount=proactive_turn_count,
        lastProactiveTurnAt=last_proactive_turn_at,
    )
    set_document("chat_sessions", session_id, idx.model_dump(by_alias=True, mode="json"))


def _post(client: TestClient, *, session_id: str = SESSION_ID, **body) -> object:
    """Default request body with sensible test values; tests override
    fields via kwargs."""
    default = {"skillId": "skill-boldkast", "eventKind": "sim_run"}
    default.update(body)
    return client.post(f"/api/sessions/{session_id}/proactive-event-check", json=default)


# --- tests ---


def test_happy_path_returns_should_fire_with_trigger_sentinel(client):
    """All six gates pass → shouldFire=true + the [event_reactive:<kind>]
    sentinel the frontend posts to /api/chat/{skill_id} to actually fire
    the proactive AG-UI run."""
    skill = _make_skill()
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    _seed_session(last_message_at=long_ago, proactive_turn_count=0)
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["shouldFire"] is True
    assert data["trigger"] == "[event_reactive:sim_run]"
    assert data["sessionId"] == SESSION_ID
    # No reason field on a positive decision.
    assert "reason" not in data


def test_skill_missing_returns_404(client):
    with patch("protocols.proactive_routes.get_skill", return_value=None):
        resp = _post(client, skillId="no-such-skill")
    assert resp.status_code == 404


def test_skill_opted_out_returns_skipped(client):
    """A skill with proactiveEventReactive=false should never fire a
    reactive turn even when the event kind is meaningful."""
    skill = _make_skill(proactive_event_reactive=False)
    _seed_session()
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is False
    assert "opted out" in data["reason"]
    assert "trigger" not in data


@pytest.mark.parametrize(
    "event_kind",
    ["slider_drag", "reset", "debounced_state_sync", "made_up_kind", "click"],
)
def test_event_kind_not_in_allowlist_returns_skipped(client, event_kind):
    """Excluded by design: slider drag (exploration), reset (undo),
    debounced state sync (noise), arbitrary made-up kinds. None of
    these should ever trigger a proactive turn."""
    skill = _make_skill()
    _seed_session()
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client, eventKind=event_kind)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is False
    assert "not meaningful" in data["reason"]


def test_session_not_found_returns_404(client):
    """Frontend shouldn't call this before any activity has created the
    session index. If it does (e.g. race condition), 404 is the right
    answer — we'd be guessing about last_message_at otherwise."""
    skill = _make_skill()
    # No _seed_session — session doesn't exist.
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 404


def test_student_recently_active_returns_skipped(client):
    """If the student SENT A CHAT MESSAGE within proactive_heartbeat_seconds,
    the gate blocks the reactive turn — they're conversing, don't
    interrupt. M8-fix #2 (2026-06-03): gate now reads
    last_student_message_at specifically (NOT last_message_at) so tutor
    turns alone don't constitute "recent activity"."""
    skill = _make_skill(heartbeat_seconds=10)
    recent = datetime.now(UTC) - timedelta(seconds=3)
    _seed_session(last_student_message_at=recent)
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is False
    assert "recently active" in data["reason"]


def test_greet_just_streamed_does_not_block_first_reactive_turn(client):
    """REGRESSION: the actual bug reported on dev 2026-06-03.

    Scenario:
      1. Student opens a new session.
      2. Phase A auto-greet fires — last_message_at gets stamped (tutor
         turn). last_student_message_at stays None (student didn't type).
      3. Student presses Afspil ~2s after the greet finishes streaming.
      4. Frontend posts /iframe-context THEN /proactive-event-check.

    Pre-fix behaviour: the gate read last_message_at (which was just
    stamped by the greet ~2s ago), saw "student recently active", and
    blocked the reactive turn. User reported "AI doesn't proactively
    respond to Boldkast values being set" — because no reactive turn
    ever fired even once.

    Fix: gate now reads last_student_message_at. None means "student
    has not yet typed", which vacuously passes the heartbeat threshold.
    Pressing Afspil right after the greet now DOES trigger a reactive
    turn — exactly what the brief asked for ("after every serious
    student interaction the tutor can respond").
    """
    skill = _make_skill(heartbeat_seconds=10)
    just_now = datetime.now(UTC) - timedelta(seconds=2)  # greet ~2s ago
    _seed_session(
        last_message_at=just_now,
        last_student_message_at=None,  # student hasn't typed
        proactive_turn_count=1,  # the greet counts
        last_proactive_turn_at=just_now,  # but it was JUST now
    )
    # Cooldown is 90s — the greet 2s ago will block via cooldown, which
    # is the correct gate for THIS scenario. To isolate the heartbeat
    # gate, push the proactive turn outside the cooldown window so only
    # the heartbeat gate could plausibly fire. (Real user case: same;
    # the bug was the heartbeat gate firing PRE-cooldown.)
    long_past_cooldown = datetime.now(UTC) - timedelta(seconds=120)
    _seed_session(
        last_message_at=just_now,
        last_student_message_at=None,
        proactive_turn_count=1,
        last_proactive_turn_at=long_past_cooldown,
    )
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["shouldFire"] is True, (
        f"expected shouldFire=true (greet doesn't block); got reason={data.get('reason')!r}"
    )
    assert data["trigger"] == "[event_reactive:sim_run]"


def test_no_heartbeat_block_when_student_never_typed(client):
    """Belt-and-braces companion to test_greet_just_streamed_…: a
    pristine session where neither the greet nor the student has set
    last_student_message_at must vacuously pass the heartbeat gate.
    Pressing Afspil immediately on session start (no prior chat at all)
    should fire."""
    skill = _make_skill(heartbeat_seconds=10)
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    _seed_session(
        last_message_at=long_ago,
        last_student_message_at=None,
        proactive_turn_count=0,
        last_proactive_turn_at=None,
    )
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is True, data.get("reason")
    assert data["trigger"] == "[event_reactive:sim_run]"


def test_cooldown_active_returns_skipped(client):
    """A proactive turn within the last 90 seconds blocks further
    proactive turns (session-wide cooldown — greet + sim-reactive share
    the same clock)."""
    skill = _make_skill()
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    recent_proactive = datetime.now(UTC) - timedelta(seconds=30)  # < 90s cooldown
    _seed_session(
        last_message_at=long_ago,
        last_proactive_turn_at=recent_proactive,
        proactive_turn_count=1,
    )
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is False
    assert "cooldown" in data["reason"]


def test_cap_reached_returns_skipped_when_explicit_cap_set(client):
    """When a skill OPTS IN to a hard cap via an explicit positive int,
    proactive_turn_count >= cap blocks further proactive turns. This is
    the opt-in path for skills whose pedagogy requires a per-session
    ceiling — most skills leave the cap at None (the default) and rely
    on the 90s cooldown alone."""
    skill = _make_skill(max_per_session=2)
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    long_ago_proactive = datetime.now(UTC) - timedelta(seconds=600)  # past cooldown
    _seed_session(
        last_message_at=long_ago,
        last_proactive_turn_at=long_ago_proactive,
        proactive_turn_count=2,  # already at the explicit cap
    )
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is False


def test_no_cap_when_max_per_session_is_none(client):
    """Default posture (2026-06-03+): proactiveMaxPerSession=None means
    the 90s cooldown is the only throttle. A session with many prior
    proactive turns can still fire another, provided cooldown has
    elapsed. Retracted from the original 'max 2' draft constraint once
    JB confirmed no numeric cap was agreed."""
    skill = _make_skill(max_per_session=None)
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    long_ago_proactive = datetime.now(UTC) - timedelta(seconds=600)  # past cooldown
    _seed_session(
        last_message_at=long_ago,
        last_proactive_turn_at=long_ago_proactive,
        proactive_turn_count=20,  # would have been at cap before retraction
    )
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is True, f"expected shouldFire=True with no cap; got reason={data.get('reason')!r}"
    assert data["trigger"] == "[event_reactive:sim_run]"


def test_zero_or_negative_cap_treated_as_no_cap(client):
    """Defensive: a SKILL.md author writing proactiveMaxPerSession: 0
    likely meant 'no cap' not 'fire zero turns'. The gate treats <=0 the
    same as None to avoid that footgun. Negative values likewise."""
    skill = _make_skill(max_per_session=0)
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    long_ago_proactive = datetime.now(UTC) - timedelta(seconds=600)
    _seed_session(
        last_message_at=long_ago,
        last_proactive_turn_at=long_ago_proactive,
        proactive_turn_count=5,
    )
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client)
    assert resp.status_code == 200
    assert resp.json()["shouldFire"] is True


def test_anonymous_group_user_happy_path(client_anon):
    """Memory feedback_anonymous_users_are_corner_case: anon-group users
    have email="" and a synthetic uid. The endpoint must work for them
    too — they're the dominant pilot user shape (students). Owner-uid
    on the session matches the caller's synthetic uid."""
    skill = _make_skill()
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    _seed_session(last_message_at=long_ago, owner_uid=ANON_GROUP_UID)
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(client_anon)
    assert resp.status_code == 200
    data = resp.json()
    assert data["shouldFire"] is True
    assert data["trigger"] == "[event_reactive:sim_run]"


def test_event_payload_accepted_and_ignored(client):
    """eventPayload is a forward-compat slot — v1.1 accepts the field
    but doesn't act on it. A future version can use it for richer
    triggering signals without a wire-shape change."""
    skill = _make_skill()
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    _seed_session(last_message_at=long_ago)
    with patch("protocols.proactive_routes.get_skill", return_value=skill):
        resp = _post(
            client,
            eventPayload={"angle": 45, "velocity": 15, "arbitrary": {"nested": "data"}},
        )
    assert resp.status_code == 200
    assert resp.json()["shouldFire"] is True


def test_unknown_body_fields_rejected(client):
    """Pydantic extra=forbid on the request schema rejects unknown
    fields — guards against typos and future fields slipping through
    without a deliberate schema bump."""
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/proactive-event-check",
        json={"skillId": "x", "eventKind": "sim_run", "evilExtra": True},
    )
    assert resp.status_code == 422


def test_agent_module_never_invoked_from_gate_endpoint(client):
    """Belt-and-braces — this endpoint MUST be a pure gate decision.
    Any agent invocation here would break the Path B architecture (the
    frontend is supposed to fire the AG-UI run, not the backend). If
    this test fails, someone has refactored the endpoint to bypass the
    frontend trigger step."""
    skill = _make_skill()
    long_ago = datetime.now(UTC) - timedelta(seconds=300)
    _seed_session(last_message_at=long_ago)
    with (
        patch("protocols.proactive_routes.get_skill", return_value=skill),
        patch("protocols.proactive_routes.process_skill_request") as mock_agent,
        patch("protocols.proactive_routes.increment_proactive_turn_count_no_stamp") as mock_incr,
    ):
        resp = _post(client)
    assert resp.status_code == 200
    assert resp.json()["shouldFire"] is True
    # The endpoint must not invoke the agent — the frontend does that.
    mock_agent.assert_not_called()
    # And must not stamp the counter — that happens after the AG-UI run
    # streams the actual proactive turn (M7 will wire that increment).
    mock_incr.assert_not_called()
