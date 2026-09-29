"""Who may read every group's progress on an activity (1.1.136 M3).

Before this, the four ``*_progress`` all-groups GETs admitted ONLY the
activity's owner, so a researcher evaluating a group could read the
conversation and not the table it was about. Now:

- a **researcher** reads any activity's groups (200);
- a **class owner** reads their own class's groups via ``?classId=``, narrowed
  to that class — even on an activity someone else authored;
- a **teacher of a different class** gets the same 404 as "no such activity";
- a **student** — a REAL minted group token through the REAL dispatcher, the
  shape of ``test_dual_auth_rejection`` — never reaches the all-groups view,
  whatever ``classId`` they pass: they get their own group's row and nothing
  of another group's.

Staff callers override ``auth.get_current_user`` (the dispatcher symbol the
routes import — overriding ``auth.firebase_auth.get_current_user`` would leave
the real dependency in place); the student half uses no override at all.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.access_context import build_access_context
from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from db import firestore as fs_module
from protocols.checklist_progress_routes import router as checklist_router
from protocols.concept_progress_routes import router as concept_router
from protocols.table_progress_routes import router as table_router
from protocols.writing_progress_routes import router as writing_router

ACTIVITY = "act-fald"
AUTHOR = "author-1"
G1, G2 = "fald-grp-11", "fald-grp-22"

CLASSES = {
    "cls-1": SimpleNamespace(class_id="cls-1", owner_uid="teacher-1", group_codes=[G1]),
    "cls-2": SimpleNamespace(class_id="cls-2", owner_uid="teacher-2", group_codes=[G2]),
}

RESEARCHER = User(uid="r-1", email="r@ku.dk", is_teacher=True, is_researcher=True)
TEACHER_1 = User(uid="teacher-1", email="t1@ku.dk", is_teacher=True)
TEACHER_2 = User(uid="teacher-2", email="t2@ku.dk", is_teacher=True)
AUTHOR_USER = User(uid=AUTHOR, email="a@ku.dk", is_teacher=True)

PATHS = {
    "table": f"/api/activities/{ACTIVITY}/table",
    "writing": f"/api/activities/{ACTIVITY}/writing",
    "checklist": f"/api/activities/{ACTIVITY}/checklist-progress",
    "concept": f"/api/activities/{ACTIVITY}/concept-progress",
}
STORES = {
    "table": ("table_progress", "cells", {"t1:0:h": "1.2"}),
    "writing": ("writing_progress", "docs", {"w1": {"text": "Vi målte faldet."}}),
    "checklist": ("checklist_progress", "itemStates", {"step-1": {"done": True}}),
    "concept": ("concept_progress", "nodeStates", {}),
}


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    for collection, field, value in STORES.values():
        for gid in (G1, G2):
            fs_module.set_document(
                collection, f"{gid}:{ACTIVITY}", {"groupId": gid, "activityId": ACTIVITY, field: value}
            )
    activity = SimpleNamespace(activity_id=ACTIVITY, owner_uid=AUTHOR)
    monkeypatch.setattr(
        "protocols.progress_read_access.get_activity", lambda aid: activity if aid == ACTIVITY else None
    )
    monkeypatch.setattr("protocols.progress_read_access.get_class", lambda cid: CLASSES.get(cid))
    monkeypatch.setattr("analytics.auth.get_class", lambda cid: CLASSES.get(cid))
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _app() -> FastAPI:
    app = FastAPI()
    for r in (table_router, writing_router, checklist_router, concept_router):
        app.include_router(r)
    return app


def _staff(user: User) -> TestClient:
    app = _app()

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


@pytest.mark.parametrize("kind", PATHS)
def test_a_researcher_reads_every_group(kind):
    resp = _staff(RESEARCHER).get(PATHS[kind])
    assert resp.status_code == 200, resp.text
    assert set(resp.json()["groups"]) == {G1, G2}


@pytest.mark.parametrize("kind", PATHS)
def test_the_activity_owner_still_reads_every_group(kind):
    """Unchanged behaviour — the fix widens the door, it does not move it."""
    resp = _staff(AUTHOR_USER).get(PATHS[kind])
    assert resp.status_code == 200
    assert set(resp.json()["groups"]) == {G1, G2}


@pytest.mark.parametrize("kind", PATHS)
def test_a_class_owner_reads_only_their_class(kind):
    resp = _staff(TEACHER_1).get(PATHS[kind], params={"classId": "cls-1"})
    assert resp.status_code == 200, resp.text
    assert set(resp.json()["groups"]) == {G1}


@pytest.mark.parametrize("kind", PATHS)
def test_a_researcher_can_narrow_to_a_class(kind):
    resp = _staff(RESEARCHER).get(PATHS[kind], params={"classId": "cls-2"})
    assert resp.status_code == 200
    assert set(resp.json()["groups"]) == {G2}


@pytest.mark.parametrize("kind", PATHS)
def test_a_teacher_of_a_different_class_is_refused(kind):
    other_class = _staff(TEACHER_2).get(PATHS[kind], params={"classId": "cls-1"})
    no_class = _staff(TEACHER_2).get(PATHS[kind])
    unknown = _staff(RESEARCHER).get(PATHS[kind].replace(ACTIVITY, "act-nope"))
    assert other_class.status_code == no_class.status_code == unknown.status_code == 404
    # Enumeration-resistant: "not yours" and "does not exist" read the same.
    assert other_class.json() == no_class.json() == unknown.json()


@pytest.mark.parametrize("kind", PATHS)
def test_a_student_never_reaches_another_groups_work(kind):
    """A REAL group token through the REAL dispatcher (no override). Passing a
    classId does not open the all-groups view: the student gets their own
    group's row, and nothing from the seeded groups."""
    record = create_group(title="fald", skill_ids=["concept-dialogue"], creator_uid="teacher-1")
    token = join_group(record.group_id, client_ip="203.0.113.7").token
    resp = TestClient(_app()).get(
        PATHS[kind], params={"classId": "cls-1"}, headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "groups" not in body
    assert G1 not in resp.text and G2 not in resp.text
