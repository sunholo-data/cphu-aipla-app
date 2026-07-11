"""CONCEPT-1 M3 — GET /api/activities/{id}/concept-progress.

Headline: the ADR-001 dual-audience corner. A GROUP token (anonymous student:
empty email/domain, group_id claim) reads its OWN group's states; the OWNING
teacher reads all groups; anyone else 404s (enumeration-resistant).
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from db.activities import create_activity
from db.concept_progress import record_checkpoint_state
from db.models.activity import Activity
from protocols.concept_progress_routes import router

GROUP = "grp-7b"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _student(group_id: str = GROUP) -> User:
    # The anonymous-group shape: empty email/domain, synthetic uid, group claim.
    return User(uid="student-anon", group_id=group_id, group_tags=frozenset({"class:t-1:cls-1"}))


def _seed_activity(owner: str = "t-1") -> str:
    a = create_activity(Activity(activityId="", skillId="concept", ownerUid=owner, title="A"))
    return a.activity_id


def test_group_token_reads_its_own_states_only():
    aid = _seed_activity()
    record_checkpoint_state(GROUP, aid, "vektorer", "demonstrated", "ok")
    record_checkpoint_state("grp-other", aid, "vektorer", "partial", "x")

    res = _client(_student()).get(f"/api/activities/{aid}/concept-progress")
    assert res.status_code == 200
    body = res.json()
    assert body["nodeStates"]["vektorer"]["status"] == "demonstrated"
    assert "groups" not in body  # a student never sees other groups


def test_group_token_with_no_state_gets_an_empty_map():
    aid = _seed_activity()
    res = _client(_student()).get(f"/api/activities/{aid}/concept-progress")
    assert res.status_code == 200
    assert res.json() == {"nodeStates": {}}


def test_owner_reads_all_groups_coverage():
    aid = _seed_activity(owner="t-1")
    record_checkpoint_state(GROUP, aid, "vektorer", "demonstrated", "ok")
    record_checkpoint_state("grp-other", aid, "vektorer", "partial", "x")

    res = _client(User(uid="t-1")).get(f"/api/activities/{aid}/concept-progress")
    assert res.status_code == 200
    groups = res.json()["groups"]
    assert groups[GROUP]["vektorer"]["status"] == "demonstrated"
    assert groups["grp-other"]["vektorer"]["status"] == "partial"


def test_non_owner_teacher_404s_enumeration_resistant():
    aid = _seed_activity(owner="t-1")
    assert _client(User(uid="t-2")).get(f"/api/activities/{aid}/concept-progress").status_code == 404
    assert _client(User(uid="t-2")).get("/api/activities/act-missing/concept-progress").status_code == 404
