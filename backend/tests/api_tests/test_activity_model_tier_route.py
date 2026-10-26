"""``POST /api/activities/{id}/model-tier`` — the researcher-only smart-tier
opt-in (1.1.142 M3).

Researcher-only to protect the 1.1.106 envelope (open question 1 in
retry-then-escalate.md). The two ways it could silently undo itself are
pinned too: a teacher's full-payload save (the PATCH has no ``modelTier`` in
its body) must preserve it, and a copy must not inherit it.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.activities import create_activity, get_activity
from db.models.activity import Activity
from protocols.activity_routes import router as activities_router

TEACHER = "teacher-1"
RESEARCHER = "researcher-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(uid: str = TEACHER, *, researcher: bool = False) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", domain="example.test", is_teacher=True, is_researcher=researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _activity() -> str:
    return create_activity(Activity(activityId="", ownerUid=TEACHER, title="Bølger", skillId="concept")).activity_id


def test_a_researcher_opts_an_activity_into_the_smart_tier():
    aid = _activity()
    resp = _client(RESEARCHER, researcher=True).post(f"/api/activities/{aid}/model-tier", json={"modelTier": "smart"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["modelTier"] == "smart"
    assert get_activity(aid).model_tier == "smart"
    # A researcher's write on someone else's activity is attributed (1.1.123 M3).
    assert get_activity(aid).last_edited_by.uid == RESEARCHER

    back = _client(RESEARCHER, researcher=True).post(f"/api/activities/{aid}/model-tier", json={"modelTier": "default"})
    assert back.json()["modelTier"] == "default"


def test_the_owner_without_the_researcher_claim_cannot():
    aid = _activity()
    resp = _client().post(f"/api/activities/{aid}/model-tier", json={"modelTier": "smart"})
    assert resp.status_code == 403
    assert get_activity(aid).model_tier == "default"


def test_an_unknown_tier_is_rejected():
    aid = _activity()
    resp = _client(RESEARCHER, researcher=True).post(f"/api/activities/{aid}/model-tier", json={"modelTier": "pro"})
    assert resp.status_code == 422


def test_a_teachers_full_payload_save_preserves_the_opt_in():
    aid = _activity()
    _client(RESEARCHER, researcher=True).post(f"/api/activities/{aid}/model-tier", json={"modelTier": "smart"})

    saved = _client().patch(f"/api/activities/{aid}", json={"skillId": "concept", "title": "Bølger 2"})

    assert saved.status_code == 200, saved.text
    assert saved.json()["modelTier"] == "smart"
    assert get_activity(aid).title == "Bølger 2"


def test_a_copy_starts_on_the_default_tier():
    aid = _activity()
    _client(RESEARCHER, researcher=True).post(f"/api/activities/{aid}/model-tier", json={"modelTier": "smart"})

    copy = _client().post(f"/api/activities/{aid}/duplicate")

    assert copy.status_code == 201, copy.text
    assert copy.json()["modelTier"] == "default"
