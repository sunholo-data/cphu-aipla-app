"""Student view (2026-11-09) — the teacher's layout choice reaches the student.

A two-ended wiring like the class tutor (1.1.112): the builder saves the field,
and the student page reads it from ``/api/activity-configs/active``. A test of
either end alone passes against a break in the middle (``_activity_to_config``
drops any field it does not name), so the headline test drives BOTH routes
against ONE store with the field names the frontend sends and reads.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.activities import get_activity
from db.firestore import set_document

TEACHER = "teacher-1"
CLASS_ID = "cls-fysik-b"
GROUP_ID = "aipla-demo-view"
TAGS = [f"class:{TEACHER}:{CLASS_ID}"]


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    set_document(
        "classes",
        CLASS_ID,
        {
            "classId": CLASS_ID,
            "ownerUid": TEACHER,
            "name": "Fysik B",
            "tagNamespace": f"class:{TEACHER}:{CLASS_ID}",
            "createdAt": "2026-11-01T00:00:00+00:00",
            "updatedAt": "2026-11-01T00:00:00+00:00",
        },
    )
    set_document("anon_groups", GROUP_ID, {"classId": CLASS_ID})
    yield
    fs_module._reset_client_for_testing()


def _teacher() -> TestClient:
    from protocols.activity_routes import router

    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=TEACHER, email=f"{TEACHER}@example.test", domain="example.test", is_teacher=True)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _student() -> TestClient:
    from protocols.activity_config_routes import router

    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(
            uid=f"anon:{GROUP_ID}",
            email="",
            domain="",
            group_id=GROUP_ID,
            group_tags=TAGS,
            auth_mode="anonymous_group",
        )
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _create(**extra) -> str:
    body = {"skillId": "concept", "classId": CLASS_ID, "title": "Bohr", "teachingGoal": "Baner", **extra}
    resp = _teacher().post("/api/activities", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["activityId"]


def test_the_teachers_choice_reaches_the_student():
    aid = _create(studentView="workbench")

    resp = _student().get(f"/api/activity-configs/active/{aid}")

    assert resp.status_code == 200, resp.text
    assert resp.json()["studentView"] == "workbench"


def test_an_activity_saved_without_the_field_keeps_todays_layout():
    """Passthrough: every activity on prod predates the field."""
    aid = _create()

    assert get_activity(aid).student_view == "chat"
    assert _student().get(f"/api/activity-configs/active/{aid}").json()["studentView"] == "chat"


def test_an_edit_can_change_it():
    aid = _create(studentView="workbench")

    saved = _teacher().patch(
        f"/api/activities/{aid}",
        json={"skillId": "concept", "title": "Bohr", "teachingGoal": "Baner", "studentView": "photo"},
    )

    assert saved.status_code == 200, saved.text
    assert saved.json()["studentView"] == "photo"
    assert _student().get(f"/api/activity-configs/active/{aid}").json()["studentView"] == "photo"


def test_an_unknown_view_is_rejected():
    resp = _teacher().post(
        "/api/activities",
        json={"skillId": "concept", "classId": CLASS_ID, "title": "x", "teachingGoal": "y", "studentView": "drawer"},
    )
    assert resp.status_code == 422


def test_an_activity_with_no_config_reads_as_todays_layout():
    resp = _student().get("/api/activity-configs/active/act-does-not-exist")

    assert resp.status_code == 200, resp.text
    assert resp.json()["studentView"] == "chat"


def test_the_photo_view_gives_the_tutor_the_image_guidance():
    """The photo view switches the composer camera on for a concept activity,
    whose skill does not opt into images; the tutor must still get the image
    guidance (no faces, no solving). Every other view is a passthrough."""
    from adk.multimodal import activity_takes_photos, inject_image_input_preamble
    from adk.teacher_focus import resolve_active_config

    photo = resolve_active_config(_create(studentView="photo"), group_tags=TAGS)
    work = resolve_active_config(_create(studentView="workbench"), group_tags=TAGS)

    assert activity_takes_photos(photo)
    assert not activity_takes_photos(work)
    assert not activity_takes_photos(None)
    assert inject_image_input_preamble("BODY", activity_takes_photos(work)) == "BODY"
    assert len(inject_image_input_preamble("BODY", activity_takes_photos(photo))) > len("BODY")
