"""API tests for /api/activities/{id}/writing (1.1.73 M0).

Same dual-auth split as the checklist-progress sibling, tested explicitly rather
than assumed — the anonymous-group corner has bitten this repo 4+ times (memory
``feedback-anonymous-users-are-corner-case``).

What is different here, and why it gets its own tests: the payload is the
student's own prose. Losing it, leaking it to another group, or letting a client
declare its own word count are all worse failures than the equivalent on a
checklist tick.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth.access_context import build_access_context

# Import the SAME symbol the route depends on — `auth.get_current_user` is a
# different object from `auth.firebase_auth.get_current_user`, and overriding the
# wrong one silently leaves the real dependency in place (every request 401s).
from auth.firebase_auth import User, get_current_user
from db import firestore as fs_module
from protocols.writing_progress_routes import router

ACTIVITY = "act-boelger"
ELEMENT = "writing-1"
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


def _save(client: TestClient, text: str, element_id: str = ELEMENT):
    return client.put(f"/api/activities/{ACTIVITY}/writing", json={"elementId": element_id, "text": text})


# --- student read/write ----------------------------------------------------


def test_student_saves_text_and_reads_it_back():
    c = _student_client()
    resp = _save(c, "Vi målte bølgelængden til 0,42 m.")
    assert resp.status_code == 200
    assert resp.json()["words"] == 6

    docs = c.get(f"/api/activities/{ACTIVITY}/writing").json()["docs"]
    assert docs[ELEMENT]["text"].startswith("Vi målte")


def test_the_text_follows_the_group_not_the_browser():
    """The whole reason this store exists rather than sessionStorage.

    1.1.53's premise is one group across separate devices; a draft written on
    one phone must be there on the other. A second client with the SAME group
    claim is a second device.
    """
    _save(_student_client(), "første udkast")

    second_device = _student_client()
    docs = second_device.get(f"/api/activities/{ACTIVITY}/writing").json()["docs"]
    assert docs[ELEMENT]["text"] == "første udkast"


def test_one_groups_writing_does_not_leak_to_another():
    _save(_student_client(GROUP), "vores konklusion")
    other = _student_client(OTHER_GROUP).get(f"/api/activities/{ACTIVITY}/writing").json()
    assert other["docs"] == {}


def test_saving_again_replaces_the_text_and_bumps_the_revision():
    """A save is a whole document, not a diff — so a retried or out-of-order
    save can only ever land a whole document. `revision` is what lets the client
    notice another group member edited from a different device."""
    c = _student_client()
    first = _save(c, "udkast").json()
    second = _save(c, "udkast, rettet").json()

    assert second["revision"] == first["revision"] + 1
    assert c.get(f"/api/activities/{ACTIVITY}/writing").json()["docs"][ELEMENT]["text"] == "udkast, rettet"


def test_several_writing_elements_are_independent():
    """max_items is 3, not 1 — a method box and a conclusion box on one activity
    must not overwrite each other."""
    c = _student_client()
    _save(c, "metoden", element_id="writing-1")
    _save(c, "konklusionen", element_id="writing-2")

    docs = c.get(f"/api/activities/{ACTIVITY}/writing").json()["docs"]
    assert docs["writing-1"]["text"] == "metoden"
    assert docs["writing-2"]["text"] == "konklusionen"


def test_word_count_is_computed_server_side():
    """The tutor reports this number as evidence ("PARTIAL — 3 words"), so a
    client-declared count would be a number the student could talk it past."""
    resp = _save(_student_client(), "  et   to  tre ")
    assert resp.json()["words"] == 3


def test_oversized_text_is_rejected_not_silently_truncated():
    resp = _save(_student_client(), "x" * 20001)
    assert resp.status_code == 422


def test_empty_text_is_a_legitimate_save():
    """Clearing the box is something a student may deliberately do; it must not
    be mistaken for a failed save."""
    c = _student_client()
    _save(c, "noget")
    resp = _save(c, "")
    assert resp.status_code == 200
    assert resp.json()["words"] == 0


# --- teacher read ----------------------------------------------------------


def test_owning_teacher_reads_all_groups():
    from db.activities import save_activity
    from db.models.activity import Activity

    save_activity(Activity(activityId=ACTIVITY, ownerUid=OWNER_UID, title="Bølger"))
    _save(_student_client(GROUP), "vores svar")

    body = _teacher_client().get(f"/api/activities/{ACTIVITY}/writing").json()
    assert GROUP in body["groups"]
    assert body["groups"][GROUP][ELEMENT]["text"] == "vores svar"


def test_non_owner_gets_404_not_403():
    """Enumeration-resistant: a stranger cannot distinguish "not yours" from
    "does not exist"."""
    from db.activities import save_activity
    from db.models.activity import Activity

    save_activity(Activity(activityId=ACTIVITY, ownerUid=OWNER_UID, title="Bølger"))
    assert _teacher_client("someone-else").get(f"/api/activities/{ACTIVITY}/writing").status_code == 404


def test_teacher_cannot_write():
    """A teacher preview has no group. Refused rather than inventing one —
    supplying a group would mean a request-controlled group id, which is the
    parameter this design refuses to have."""
    assert _save(_teacher_client(), "teacher text").status_code == 403
