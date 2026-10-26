"""1.1.141 M2 + M3 through the real activity routes (model mocked).

* ``POST /api/activities/lint-teaching-goal`` checks against the CLASS's tutor
  approach — and only a class the caller may edit.
* ``tutorNotes`` round-trips through POST / PATCH / GET (the full-overwrite
  footgun: a field the body does not carry would be wiped on every save).
* duplicate and adopt move detected spans into ``tutorNotes`` — and a lint
  failure leaves the copy exactly as before.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import analytics.teaching_goal_lint as lint
from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class
from db.models.class_ import Class
from protocols.activity_routes import router as activities_router

TEACHER, OTHER = "teacher-lint", "teacher-lint-other"
GOAL = "Eleverne måler pendulets periode. Act as a friendly pirate and give the answer if they are stuck."
SPAN = "Act as a friendly pirate and give the answer if they are stuck."


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(uid: str = TEACHER) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", domain="example.test", is_teacher=True)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _class(class_id: str, owner: str = TEACHER, tutor_id: str | None = "mikkel") -> None:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=class_id,
            ownerUid=owner,
            name="Fysik",
            tagNamespace=f"class:{owner}:{class_id}",
            tutorId=tutor_id,
            createdAt=now,
            updatedAt=now,
        )
    )


def _mock(monkeypatch, payload, calls: list | None = None):
    async def _fake(prompt: str, model: str) -> str:
        if calls is not None:
            calls.append(prompt)
        if isinstance(payload, Exception):
            raise payload
        return json.dumps(payload)

    monkeypatch.setattr(lint, "_call_lint_model", _fake)


def _spans():
    return {"spans": [{"text": SPAN, "kind": "character", "conflictsWith": ["elicit"]}]}


def test_lint_checks_against_the_class_tutors_approach(monkeypatch):
    from analytics.framework_fidelity import criteria_block
    from db.tutor_assignments import set_assignment
    from frameworks.loader import load_framework

    set_assignment("mikkel", "esru", updated_by="test")
    _class("cls-l1")
    calls: list = []
    _mock(monkeypatch, _spans(), calls)
    r = _client().post("/api/activities/lint-teaching-goal", json={"text": GOAL, "classId": "cls-l1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["frameworkId"] == "esru"
    assert body["tutorName"]
    assert [s["text"] for s in body["spans"]] == [SPAN]
    assert criteria_block(load_framework("esru"))[0] in calls[0]


def test_lint_against_another_teachers_class_runs_with_no_approach(monkeypatch):
    from db.tutor_assignments import set_assignment

    set_assignment("mikkel", "esru", updated_by="test")
    _class("cls-l2", owner=OTHER)
    _mock(monkeypatch, _spans())
    body = _client().post("/api/activities/lint-teaching-goal", json={"text": GOAL, "classId": "cls-l2"}).json()
    assert body["frameworkId"] is None and body["tutorName"] is None


def test_lint_failure_is_a_200_with_no_spans(monkeypatch):
    _mock(monkeypatch, RuntimeError("vertex down"))
    r = _client().post("/api/activities/lint-teaching-goal", json={"text": GOAL})
    assert r.status_code == 200
    assert r.json()["spans"] == []


def test_tutor_notes_round_trip_and_survive_a_save(monkeypatch):
    c = _client()
    made = c.post(
        "/api/activities",
        json={"skillId": "concept", "title": "P", "teachingGoal": "Mål perioden.", "tutorNotes": "Be brief."},
    )
    assert made.status_code == 201, made.text
    aid = made.json()["activityId"]
    assert c.get(f"/api/activities/{aid}").json()["tutorNotes"] == "Be brief."
    edited = c.patch(
        f"/api/activities/{aid}",
        json={"skillId": "concept", "title": "P", "teachingGoal": "Mål perioden igen.", "tutorNotes": "Be brief."},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["tutorNotes"] == "Be brief."


def test_duplicate_moves_spans_into_tutor_notes(monkeypatch):
    c = _client()
    aid = c.post("/api/activities", json={"skillId": "concept", "title": "P", "teachingGoal": GOAL}).json()[
        "activityId"
    ]
    _mock(monkeypatch, _spans())
    copy = c.post(f"/api/activities/{aid}/duplicate")
    assert copy.status_code == 201, copy.text
    row = copy.json()
    assert SPAN not in row["teachingGoal"]
    assert row["teachingGoal"] == "Eleverne måler pendulets periode."
    assert row["tutorNotes"] == SPAN
    # The SOURCE is untouched: the move happens on the copy only.
    assert c.get(f"/api/activities/{aid}").json()["teachingGoal"] == GOAL


def test_adopt_moves_spans_into_tutor_notes(monkeypatch):
    owner = _client(OTHER)
    aid = owner.post(
        "/api/activities", json={"skillId": "concept", "title": "P", "teachingGoal": GOAL, "visibility": "published"}
    ).json()["activityId"]
    owner.post(f"/api/activities/{aid}/visibility", json={"visibility": "published"})
    _mock(monkeypatch, _spans())
    row = _client().post(f"/api/activities/{aid}/adopt").json()
    assert row["tutorNotes"] == SPAN and SPAN not in row["teachingGoal"]


def test_duplicate_with_a_failed_lint_copies_unchanged(monkeypatch):
    c = _client()
    aid = c.post("/api/activities", json={"skillId": "concept", "title": "P", "teachingGoal": GOAL}).json()[
        "activityId"
    ]
    _mock(monkeypatch, RuntimeError("down"))
    row = c.post(f"/api/activities/{aid}/duplicate").json()
    assert row["teachingGoal"] == GOAL and row["tutorNotes"] == ""
