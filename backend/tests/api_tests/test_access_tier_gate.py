"""The spend gate, end to end on the real routes (ACCESS-1 M1).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

The other ACCESS-1 test files check the pieces (the register resolves tiers,
spend authority walks group -> teacher). This one checks the property that
actually matters for publicising `aipla.ku.dk`:

    a signed-in visitor can navigate, and cannot spend.

Both halves are asserted, because a gate that also blocks navigation would have
failed the requirement just as badly as one that lets spend through.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from auth.access_tiers import TIER_PILOT, TIER_VISITOR
from auth.spend_authority import clear_cache

VISITOR_UID = "visitor-uid"
PILOT_UID = "pilot-uid"


@pytest.fixture(autouse=True)
def _fresh_cache():
    clear_cache()
    yield
    clear_cache()


@pytest.fixture()
def local_mode(monkeypatch):
    """A real in-memory Firestore for the tests that actually write.

    The session conftest swaps the Firestore client for a MagicMock, which is
    fine for read-shaped tests but makes create-then-read fail. LOCAL_MODE gives
    the genuine in-memory client instead (same fixture as
    test_teacher_bootstrap.py).
    """
    from db import firestore as fs_module

    monkeypatch.setenv("LOCAL_MODE", "1")
    # Seeding a class mints a join code -> anonymous-group auth needs a secret.
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-not-for-production-use")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client_for(router, tier: str, *, uid: str = VISITOR_UID) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(
            uid=uid,
            email=f"{uid}@example.test",
            domain="example.test",
            is_teacher=True,
            access_tier=tier,
        )
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app, raise_server_exceptions=True)


# --- Navigation: a visitor is STILL a teacher -------------------------------


def test_visitor_can_still_read_their_own_classes():
    """The requirement is 'people can log in and explore the app'. If the gate
    caught navigation too, the feature would have failed its own brief."""
    from protocols.classes_routes import router

    client = _client_for(router, TIER_VISITOR)
    resp = client.get("/api/classes")
    assert resp.status_code == 200, f"a visitor must be able to browse: {resp.text}"


def test_visitor_can_bootstrap(local_mode):
    from protocols.teacher_bootstrap_routes import router

    client = _client_for(router, TIER_VISITOR)
    resp = client.post("/api/teacher/bootstrap")
    assert resp.status_code == 200
    body = resp.json()
    assert body["accessTier"] == TIER_VISITOR
    # The one thing withheld — see test_teacher_bootstrap.py for the seeder half.
    assert body.get("joinCode") is None


# --- Spend: a visitor is refused with 402, not 403 --------------------------


def test_visitor_is_402_on_curriculum_query():
    from protocols.curriculum_routes import router

    resp = _client_for(router, TIER_VISITOR).post("/api/curriculum/query", json={"query": "hooke's law"})
    assert resp.status_code == 402, f"expected 402, got {resp.status_code}: {resp.text}"


def test_visitor_is_402_on_curriculum_ingest():
    """Ingest is a multipart upload (it runs Vertex RAG embedding, which bills).

    Sent as real multipart on purpose: a JSON body would 422 in FastAPI's
    validation layer BEFORE the handler runs, so the test would pass without
    the guard existing at all.
    """
    from protocols.curriculum_routes import router

    resp = _client_for(router, TIER_VISITOR).post(
        "/api/curriculum/ingest",
        files={"file": ("notes.txt", b"hello", "text/plain")},
        data={"title": "Notes", "origin": "test"},
    )
    assert resp.status_code == 402, f"expected 402, got {resp.status_code}: {resp.text}"


def test_402_not_403_so_the_frontend_can_tell_them_apart():
    """403 means 'you are the wrong kind of user'; 402 means 'you are the right
    kind, you just are not in the programme'. The frontend renders a nudge for
    one and an error for the other, and a distinct status keeps that from
    depending on string-matching a message."""
    from protocols.curriculum_routes import router

    resp = _client_for(router, TIER_VISITOR).post("/api/curriculum/query", json={"query": "x"})
    assert resp.status_code == 402
    assert resp.status_code != 403


def test_pilot_is_not_blocked_by_the_tier_gate():
    """A pilot must get PAST the tier gate. It may still fail downstream for
    unrelated reasons (no corpus configured in a unit test), which is fine —
    what must not happen is a 402."""
    from protocols.curriculum_routes import router

    resp = _client_for(router, TIER_PILOT, uid=PILOT_UID).post("/api/curriculum/query", json={"query": "x"})
    assert resp.status_code != 402


# --- The agent chokepoint ---------------------------------------------------


@pytest.mark.asyncio
async def test_process_skill_request_refuses_a_visitor():
    """One gate covers all four agent entry points (AG-UI stream, /greet,
    proactive-event-check, MCP/channel) because they all funnel through here."""
    from skills.skill_processor import SpendNotAuthorisedError, process_skill_request

    visitor = User(uid=VISITOR_UID, email="v@example.test", is_teacher=True, access_tier=TIER_VISITOR)

    with pytest.raises(SpendNotAuthorisedError) as exc:
        async for _ in process_skill_request(
            skill_id="any-skill",
            user=visitor,
            access=build_access_context(visitor),
            session_id=None,
            message="hello",
        ):
            pass

    assert exc.value.tier == TIER_VISITOR
    assert exc.value.reason == "firebase_claim"


@pytest.mark.asyncio
async def test_the_gate_runs_before_any_expensive_work():
    """The refusal must not depend on the skill existing, the session loading,
    or the turn lock being free — otherwise a visitor still costs us Firestore
    reads and a lock round-trip per attempt."""
    from skills.skill_processor import SpendNotAuthorisedError, process_skill_request

    visitor = User(uid=VISITOR_UID, email="v@example.test", is_teacher=True, access_tier=TIER_VISITOR)

    # A skill id that certainly does not exist. If the gate ran after skill
    # resolution we would get SkillNotFoundError instead.
    with pytest.raises(SpendNotAuthorisedError):
        async for _ in process_skill_request(
            skill_id="definitely-not-a-real-skill-id",
            user=visitor,
            access=build_access_context(visitor),
            session_id=None,
            message="hello",
        ):
            pass
