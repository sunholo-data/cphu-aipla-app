"""API tests for /api/activities/{id}/checklist-progress (1.1.62 M3).

The dual-auth corner has bitten this repo 4+ times (memory
``feedback-anonymous-users-are-corner-case``), so the student / teacher /
neither split is tested explicitly rather than assumed.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context

# Import the SAME symbol the route depends on — `auth.get_current_user` is a
# different object from `auth.firebase_auth.get_current_user`, and overriding
# the wrong one silently leaves the real dependency in place (every request
# 401s). Matches test_concept_progress_routes.py.
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from protocols.checklist_progress_routes import router

ACTIVITY = "act-fald"
GROUP = "aipla-demo-1"
OTHER_GROUP = "aipla-demo-2"
OWNER_UID = "teacher-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _app(user: User) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return app


def _student_client(group_id: str = GROUP) -> TestClient:
    return TestClient(_app(User(uid=f"group:{group_id}", email="", group_id=group_id)))


def _teacher_client(uid: str = OWNER_UID) -> TestClient:
    return TestClient(_app(User(uid=uid, email="teacher@example.dk")))


# --- student read/write ----------------------------------------------------


def test_student_ticks_an_item_and_reads_it_back():
    c = _student_client()
    resp = c.post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": True})
    assert resp.status_code == 200
    assert resp.json()["itemStates"]["a"]["done"] is True

    states = c.get(f"/api/activities/{ACTIVITY}/checklist-progress").json()["itemStates"]
    assert states["a"]["by"] == "student"


def test_student_tick_is_group_scoped_not_browser_scoped():
    """The whole reason this store exists.

    Ticks used to live in sessionStorage keyed by skill, so three students in
    one group had three private checklists (1.1.53: the primary classroom shape
    is one group across separate devices). A second client with the SAME group
    claim is a second device — it must see the first one's ticks.
    """
    _student_client().post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": True})

    second_device = _student_client()
    states = second_device.get(f"/api/activities/{ACTIVITY}/checklist-progress").json()["itemStates"]
    assert states["a"]["done"] is True


def test_one_groups_ticks_do_not_leak_to_another():
    _student_client(GROUP).post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": True})
    other = _student_client(OTHER_GROUP).get(f"/api/activities/{ACTIVITY}/checklist-progress").json()
    assert other["itemStates"] == {}


def test_student_can_untick():
    c = _student_client()
    c.post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": True})
    resp = c.post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": False})
    assert resp.json()["itemStates"]["a"]["done"] is False


def test_a_student_override_flips_provenance_off_the_ai():
    """ "The AI helps auto-grade" stays honest only if the student can take it back.

    An AI tick the student disagrees with must stop being presented as the
    tutor's read.
    """
    from db.checklist_progress import record_item_state

    record_item_state(GROUP, ACTIVITY, "a", done=True, by="ai", evidence_summary="looked done")

    c = _student_client()
    states = c.post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": False}).json()[
        "itemStates"
    ]
    assert states["a"]["by"] == "student"
    assert states["a"]["done"] is False


# --- teacher read ----------------------------------------------------------


def test_owning_teacher_reads_all_groups(monkeypatch):
    from db.activities import save_activity
    from db.models.activity import Activity

    save_activity(Activity(activityId=ACTIVITY, ownerUid=OWNER_UID, title="Fald"))
    _student_client(GROUP).post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": True})

    body = _teacher_client().get(f"/api/activities/{ACTIVITY}/checklist-progress").json()
    assert GROUP in body["groups"]
    assert body["groups"][GROUP]["a"]["done"] is True


def test_non_owner_gets_404_not_403():
    """Enumeration-resistant: a stranger cannot distinguish "not yours" from
    "does not exist". Matches the concept-progress sibling."""
    from db.activities import save_activity
    from db.models.activity import Activity

    save_activity(Activity(activityId=ACTIVITY, ownerUid=OWNER_UID, title="Fald"))
    assert _teacher_client("someone-else").get(f"/api/activities/{ACTIVITY}/checklist-progress").status_code == 404


def test_teacher_cannot_write_a_tick():
    """A teacher preview has no group. Refused rather than inventing one —
    supplying a group would mean a request-controlled group id, which is the
    parameter this design refuses to have."""
    assert (
        _teacher_client()
        .post(f"/api/activities/{ACTIVITY}/checklist-progress", json={"itemId": "a", "done": True})
        .status_code
        == 403
    )
