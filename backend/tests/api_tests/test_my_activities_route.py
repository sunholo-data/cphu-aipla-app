"""API test for GET /api/auth/group/my-activities (ALS-1 M0.3).

The activity-keyed student lesson list — the surface that lets a class show
MANY concept activities (each its own act- id) instead of colliding on one.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user
from auth.group_routes import router
from db import firestore as fs_module
from db.activities import create_activity
from db.classes import add_activities, create_class
from db.firestore import set_document
from db.models.activity import Activity
from db.models.class_ import Class

OWNER = "teacher-1"
GROUP_ID = "grp-abc"
CLASS_ID = "cls-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _student_client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: User(
        uid="student-synthetic", group_id=GROUP_ID, auth_mode="anonymous_group_id"
    )
    return TestClient(app)


def _bind_class_with_activities(activity_ids: list[str]) -> None:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=CLASS_ID,
            ownerUid=OWNER,
            name="Physics 7B",
            tagNamespace=f"class:{OWNER}:{CLASS_ID}",
            createdAt=now,
            updatedAt=now,
        )
    )
    add_activities(CLASS_ID, activity_ids)
    # The student's group is bound to the class via the anon_groups doc.
    set_document("anon_groups", GROUP_ID, {"classId": CLASS_ID})


def test_lists_two_concept_activities_in_one_class():
    """The bug fix, end-to-end at the student surface: two concept activities
    sharing one skill, distinct act- ids, BOTH listed."""
    create_activity(Activity(activityId="act-1", skillId="concept-skill", title="Energy", ownerUid=OWNER))
    create_activity(Activity(activityId="act-2", skillId="concept-skill", title="Momentum", ownerUid=OWNER))
    _bind_class_with_activities(["act-1", "act-2"])

    resp = _student_client().get("/api/auth/group/my-activities")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["class_name"] == "Physics 7B"
    titles = {a["title"] for a in body["activities"]}
    assert titles == {"Energy", "Momentum"}
    # Each carries the SAME running skill but a DISTINCT activity id.
    assert {a["skillId"] for a in body["activities"]} == {"concept-skill"}
    assert {a["activityId"] for a in body["activities"]} == {"act-1", "act-2"}


def test_skips_dangling_activity_reference():
    create_activity(Activity(activityId="act-live", skillId="concept-skill", title="Live", ownerUid=OWNER))
    _bind_class_with_activities(["act-live", "act-deleted"])  # second id has no doc
    resp = _student_client().get("/api/auth/group/my-activities")
    assert [a["activityId"] for a in resp.json()["activities"]] == ["act-live"]


def test_falls_back_to_legacy_lessons_when_not_backfilled():
    """Rollout safety: a class with lessons but no activity_ids (pre-backfill)
    still shows its lessons as synthetic activities (activityId == skillId)."""
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=CLASS_ID,
            ownerUid=OWNER,
            name="Physics 7B",
            tagNamespace=f"class:{OWNER}:{CLASS_ID}",
            lessons=["boldkast", "concept-x"],
            createdAt=now,
            updatedAt=now,
        )
    )
    set_document("anon_groups", GROUP_ID, {"classId": CLASS_ID})
    body = _student_client().get("/api/auth/group/my-activities").json()
    # Each legacy lesson surfaces as a synthetic activity keyed by the skill id.
    assert {a["activityId"] for a in body["activities"]} == {"boldkast", "concept-x"}
    assert all(a["activityId"] == a["skillId"] for a in body["activities"])


def test_non_group_user_404s():
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: User(uid="teacher", email="t@example.com")
    resp = TestClient(app).get("/api/auth/group/my-activities")
    assert resp.status_code == 404
