"""API tests for the live raised-hand signal (1.1.29 call-teacher).

Student side: POST /api/auth/group/raise-hand · /lower-hand · GET /signal
Teacher side: GET /api/classes/{id}/signals · POST .../signals/{group_id}/ack

Uses InMemoryFirestoreClient via LOCAL_MODE. The student's ``group_id`` is the
join code (so it matches ``Class.group_codes``); ``mint_group_codes_under_class``
binds the code to the class via ``anon_groups/<code>.classId``.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class, mint_group_codes_under_class
from db.models.class_ import Class

TEACHER_UID = "teacher-alice"


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _setup_class_with_code(*, owner: str = TEACHER_UID, class_id: str = "cls-1") -> str:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=class_id,
            ownerUid=owner,
            name="Physik 7B",
            tagNamespace=f"class:{owner}:{class_id}",
            createdAt=now,
            updatedAt=now,
        )
    )
    return mint_group_codes_under_class(class_id, count=1)[0]


def _student_client(group_code: str) -> TestClient:
    from auth.group_routes import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: User(
        uid="student-synthetic", group_id=group_code, auth_mode="anonymous_group_id"
    )
    return TestClient(app)


def _teacher_client(*, uid: str = TEACHER_UID, is_researcher: bool = False) -> TestClient:
    from protocols.classes_routes import router

    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", is_teacher=True, is_researcher=is_researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


# --- student side --------------------------------------------------------


def test_raise_hand_sets_raised_and_derives_class():
    code = _setup_class_with_code()
    resp = _student_client(code).post("/api/auth/group/raise-hand", json={"activityTitle": "Energibevarelse"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["raised"] is True
    assert body["raisedHandAt"]
    assert body["activityTitle"] == "Energibevarelse"


def test_raise_hand_is_idempotent():
    code = _setup_class_with_code()
    c = _student_client(code)
    first = c.post("/api/auth/group/raise-hand").json()
    second = c.post("/api/auth/group/raise-hand").json()
    # A second raise while already up is a no-op — same timestamp, not re-stamped.
    assert second["raised"] is True
    assert second["raisedHandAt"] == first["raisedHandAt"]


def test_student_lower_hand_clears():
    code = _setup_class_with_code()
    c = _student_client(code)
    c.post("/api/auth/group/raise-hand")
    lowered = c.post("/api/auth/group/lower-hand").json()
    assert lowered["raised"] is False
    assert lowered["clearedBy"] == "student"
    assert c.get("/api/auth/group/signal").json()["raised"] is False


def test_non_group_user_cannot_raise():
    app = FastAPI()
    from auth.group_routes import router

    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: User(uid="t", email="t@example.com")
    resp = TestClient(app).post("/api/auth/group/raise-hand")
    assert resp.status_code == 404


# --- teacher side --------------------------------------------------------


def test_teacher_sees_and_acks_raised_hand():
    code = _setup_class_with_code()
    _student_client(code).post("/api/auth/group/raise-hand", json={"activityTitle": "Energi"})

    teacher = _teacher_client()
    calls = teacher.get("/api/classes/cls-1/signals").json()["calls"]
    assert [c["groupId"] for c in calls] == [code]
    assert calls[0]["activityTitle"] == "Energi"

    # Acknowledge clears it.
    ack = teacher.post(f"/api/classes/cls-1/signals/{code}/ack")
    assert ack.status_code == 204, ack.text
    assert teacher.get("/api/classes/cls-1/signals").json()["calls"] == []
    # The student reconciles to the acknowledged (cleared-by-teacher) state.
    sig = _student_client(code).get("/api/auth/group/signal").json()
    assert sig["raised"] is False
    assert sig["clearedBy"] == TEACHER_UID


def test_ack_group_not_in_class_404():
    _setup_class_with_code()
    resp = _teacher_client().post("/api/classes/cls-1/signals/not-a-code/ack")
    assert resp.status_code == 404


def test_researcher_can_list_signals():
    code = _setup_class_with_code()
    _student_client(code).post("/api/auth/group/raise-hand")
    calls = _teacher_client(uid="researcher-rae", is_researcher=True).get("/api/classes/cls-1/signals").json()["calls"]
    assert [c["groupId"] for c in calls] == [code]


def test_signals_are_scoped_to_the_class():
    code_a = _setup_class_with_code(class_id="cls-A")
    _setup_class_with_code(class_id="cls-B")
    _student_client(code_a).post("/api/auth/group/raise-hand")
    teacher = _teacher_client()
    assert [c["groupId"] for c in teacher.get("/api/classes/cls-A/signals").json()["calls"]] == [code_a]
    # The raised hand in class A does not bleed into class B.
    assert teacher.get("/api/classes/cls-B/signals").json()["calls"] == []


def test_live_endpoint_composes_calls_groups_and_null_summary(monkeypatch):
    code = _setup_class_with_code()
    _student_client(code).post("/api/auth/group/raise-hand", json={"activityTitle": "Energi"})

    # Stub the deterministic compute so the route-composition is what's under test.
    from analytics.live_class import LiveGroupSignal

    monkeypatch.setattr(
        "analytics.live_class.compute_group_signals",
        lambda codes, now=None: [
            LiveGroupSignal(
                group_code=code,
                status="active",
                turns=4,
                last_activity_at="2026-06-28T12:00:00+00:00",
                idle_seconds=12,
                stuck=False,
                activity_title="Energi",
                skill_id="boldkast",
            )
        ],
    )

    body = _teacher_client().get("/api/classes/cls-1/live").json()
    assert [c["groupId"] for c in body["calls"]] == [code]  # raised hand (real)
    assert body["groups"][0]["groupId"] == code  # deterministic signal (stubbed)
    assert body["groups"][0]["status"] == "active"
    assert body["summary"] is None  # M1 disabled by default → degrades cleanly
    assert body["generatedAt"]


def test_live_endpoint_populates_summary_when_enabled(monkeypatch):
    code = _setup_class_with_code()
    from analytics.live_class import LiveGroupSignal

    monkeypatch.setattr(
        "analytics.live_class.compute_group_signals",
        lambda codes, now=None: [
            LiveGroupSignal(
                group_code=code,
                status="active",
                turns=6,
                last_activity_at="2026-06-28T12:00:00+00:00",
                idle_seconds=12,
                stuck=False,
                activity_title="Energi",
                skill_id="boldkast",
            )
        ],
    )
    # Enable the placeholder-framework summary and mock the Flash call.
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")

    async def fake_gemini(prompt):
        return "Most groups are working steadily."

    monkeypatch.setattr("analytics.live_class_summary._call_gemini", fake_gemini)
    monkeypatch.setattr("analytics.live_class_summary._cache", {})

    body = _teacher_client().get("/api/classes/cls-1/live").json()
    assert body["summary"]["text"] == "Most groups are working steadily."
    assert body["summary"]["framework"] == "AIPLA live-summary v0"
    assert body["summary"]["generatedAt"]


# ---------------------------------------------------------------------------
# 1.1.53 M1 — group live pulse (GET /api/auth/group/pulse)
# ---------------------------------------------------------------------------


def _pulse_client_no_group() -> TestClient:
    from auth.group_routes import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: User(uid="teacher-x", group_id="")
    return TestClient(app)


def test_group_pulse_defaults_to_zero_when_no_turns():
    code = _setup_class_with_code()
    resp = _student_client(code).get("/api/auth/group/pulse?activityId=act-1")
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"revision": 0, "turnInFlight": False, "turnStartedAt": None}


def test_group_pulse_reflects_revision_and_in_flight():
    from db.group_sessions import acquire_turn_lock, bump_turn_revision

    code = _setup_class_with_code()
    bump_turn_revision(code, activity_id="act-1")
    bump_turn_revision(code, activity_id="act-1")
    acquire_turn_lock(code, "tok-1", activity_id="act-1")

    resp = _student_client(code).get("/api/auth/group/pulse?activityId=act-1")
    body = resp.json()
    assert body["revision"] == 2
    assert body["turnInFlight"] is True
    assert body["turnStartedAt"]


def test_group_pulse_is_scoped_to_caller_group():
    """A bump in another group's activity is invisible to this caller."""
    from db.group_sessions import bump_turn_revision

    code = _setup_class_with_code()
    bump_turn_revision("some-other-group", activity_id="act-1")

    resp = _student_client(code).get("/api/auth/group/pulse?activityId=act-1")
    assert resp.json()["revision"] == 0


def test_group_pulse_404_for_non_group_user():
    resp = _pulse_client_no_group().get("/api/auth/group/pulse?activityId=act-1")
    assert resp.status_code == 404
