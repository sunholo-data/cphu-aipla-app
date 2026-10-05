"""1.1.145 M1 — the server decides a group's session (D2).

``get_or_create_active_session`` is a create-if-absent under a transaction, so
devices opening one activity in the same second end up on ONE session — by
construction, not by narrowing the client race that left a seminar device on a
private session nobody else watched (V2).

Also drives ``POST /api/auth/group/session`` with REAL minted group tokens
through the REAL ``auth`` dispatcher (no ``dependency_overrides``): per the
footgun table, a test that overrides the symbol the route imports passes in
lockstep with the bug.
"""

from __future__ import annotations

import threading
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from auth.group_routes import router as group_router
from db import firestore as fs_module
from db.models import SkillConfig, SkillMetadata


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


# --------------------------------------------------------------------------
# The repository function
# --------------------------------------------------------------------------


def test_concurrent_calls_for_one_group_activity_return_one_id():
    """Sixteen threads, one (group, activity): one id, exactly one creator."""
    from db.group_sessions import get_active_session_for_group, get_or_create_active_session

    # Build the lazy client singleton first: sixteen threads constructing it at
    # once would each get their own in-memory store and "disagree" for reasons
    # that have nothing to do with the transaction under test.
    fs_module.get_client()
    barrier = threading.Barrier(16)
    results: list[tuple[str, bool]] = []
    lock = threading.Lock()

    def _open() -> None:
        barrier.wait()
        r = get_or_create_active_session("grp", "act-1")
        with lock:
            results.append(r)

    threads = [threading.Thread(target=_open) for _ in range(16)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    ids = {sid for sid, _ in results}
    assert len(ids) == 1, results
    assert sum(1 for _, created in results if created) == 1
    assert get_active_session_for_group("grp", "act-1") == ids.pop()


def test_different_activities_get_different_sessions():
    from db.group_sessions import get_or_create_active_session

    a, _ = get_or_create_active_session("grp", "act-1")
    b, _ = get_or_create_active_session("grp", "act-2")
    assert a != b
    # And a second call on the first returns the first, not a new one.
    assert get_or_create_active_session("grp", "act-1") == (a, False)


def test_archived_pointer_yields_a_new_session():
    """A teacher [Reset session] is the only way a group reaches a fresh one."""
    from db.group_sessions import archive_session_for_group, get_or_create_active_session

    first, created = get_or_create_active_session("grp", "act-1")
    assert created
    archive_session_for_group("grp", "act-1")
    second, created_again = get_or_create_active_session("grp", "act-1")
    assert created_again
    assert second != first


def test_get_or_create_keeps_lock_and_presence_fields():
    """The pointer rides the same doc as the turn-lock, revision and presence —
    creating it must merge, not overwrite them."""
    from db.group_sessions import (
        bump_turn_revision,
        get_or_create_active_session,
        read_group_pulse,
        touch_presence,
    )

    touch_presence("grp", "tab-1", activity_id="act-1")
    bump_turn_revision("grp", activity_id="act-1")
    get_or_create_active_session("grp", "act-1")
    assert read_group_pulse("grp", activity_id="act-1")["revision"] == 1
    assert touch_presence("grp", "tab-1", activity_id="act-1") == 1


def test_get_or_create_refuses_an_empty_scope():
    from db.group_sessions import get_or_create_active_session

    with pytest.raises(ValueError):
        get_or_create_active_session("grp", "")


# --------------------------------------------------------------------------
# The route, with real tokens through the real dispatcher
# --------------------------------------------------------------------------


def _skill() -> SkillConfig:
    return SkillConfig(
        name="concept-dialogue",
        description="Under test.",
        instructions="Be helpful.",
        skillId="concept-dialogue",
        ownerId="platform",
        skillMetadata=SkillMetadata(model="gemini-2.5-flash"),
        accessControl={"type": "public"},
    )


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(group_router)  # REAL get_current_user — no overrides
    return TestClient(app)


def _two_tokens_one_group() -> tuple[str, str, str]:
    rec = create_group(title="Seminar", skill_ids=["concept-dialogue"], creator_uid="teacher-1")
    a = join_group(rec.group_id, client_ip="203.0.113.7").token
    b = join_group(rec.group_id, client_ip="203.0.113.8").token
    return rec.group_id, a, b


def _post(client: TestClient, token: str, body: dict) -> dict:
    resp = client.post(
        "/api/auth/group/session",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_two_devices_on_one_code_get_one_session(client):
    _, tok_a, tok_b = _two_tokens_one_group()
    with patch("skills.skill_config.get_skill", return_value=_skill()):
        a = _post(client, tok_a, {"skillId": "concept-dialogue", "activityId": "act-1"})
        b = _post(client, tok_b, {"skillId": "concept-dialogue", "activityId": "act-1"})
    assert a["sessionId"] == b["sessionId"]
    assert a["created"] is True
    assert b["created"] is False


def test_route_stamps_the_session_index_with_its_scope(client):
    """M3 — the index records which activity (or legacy lesson) it belongs to."""
    from db.chat_sessions import get_session_index

    group_id, tok_a, _ = _two_tokens_one_group()
    with patch("skills.skill_config.get_skill", return_value=_skill()):
        act = _post(client, tok_a, {"skillId": "concept-dialogue", "activityId": "act-1"})
        legacy = _post(client, tok_a, {"skillId": "concept-dialogue"})
    assert get_session_index(act["sessionId"]).activity_id == "act-1"
    idx = get_session_index(legacy["sessionId"])
    assert idx.activity_id == "concept-dialogue"
    assert idx.group_code == group_id
    assert act["sessionId"] != legacy["sessionId"]


def test_route_refuses_an_invisible_skill(client):
    _, tok_a, _ = _two_tokens_one_group()
    with patch("skills.skill_config.get_skill", return_value=None):
        resp = client.post(
            "/api/auth/group/session",
            json={"skillId": "nope", "activityId": "act-1"},
            headers={"Authorization": f"Bearer {tok_a}"},
        )
    assert resp.status_code == 403


def test_route_requires_a_token(client):
    resp = client.post("/api/auth/group/session", json={"skillId": "concept-dialogue"})
    assert resp.status_code == 401
