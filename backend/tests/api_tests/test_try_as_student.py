"""1.1.133 — "Try as student": the builder opens the real student view, no code.

Teacher feedback 2026-09-24: *"Kan man lave en knap … der viser elevernes
interface, så man ikke skal lave en elevkode hver gang (som ofte ikke virker)?"*

The route mints a short-lived ``preview-`` group bound to the activity's class
and hands back a join link that lands straight in the activity. These tests pin
the two properties that make that safe: it IS a working student group (the real
pipeline, no teacher token on the chat page), and it is NEVER counted as one.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from auth.group_id_auth import GroupNotFound, join_group, normalize_join_code
from db import firestore as fs_module
from db.classes import create_class, get_class
from db.firestore import get_document
from db.models.class_ import Class
from protocols.activity_routes import router as activities_router
from protocols.classes_routes import router as classes_router

TEACHER = "teacher-1"
OTHER = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(uid: str = TEACHER, *, researcher: bool = False) -> TestClient:
    app = FastAPI()
    app.include_router(activities_router)
    app.include_router(classes_router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", domain="example.test", is_teacher=True, is_researcher=researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _make_class(class_id: str, owner: str = TEACHER) -> None:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=class_id,
            ownerUid=owner,
            name=f"Class {class_id}",
            tagNamespace=f"class:{owner}:{class_id}",
            createdAt=now,
            updatedAt=now,
        )
    )


def _activity(*, class_id: str | None = "c1") -> str:
    body = {"skillId": "concept-dialogue", "title": "Den svingende streng", "teachingGoal": "g"}
    if class_id:
        body["classId"] = class_id
    resp = _client().post("/api/activities", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["activityId"]


def test_owner_gets_a_preview_group_that_lands_in_the_activity():
    _make_class("c1")
    aid = _activity()
    resp = _client().post(f"/api/activities/{aid}/preview-student", json={})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["code"].startswith("preview-")
    assert body["classId"] == "c1"
    assert body["next"] == f"/chat/concept-dialogue?activity_id={aid}"
    assert body["joinUrl"].startswith(f"/group?code={body['code']}&next=%2Fchat%2F")


def test_the_preview_group_is_a_real_working_student_group():
    _make_class("c1")
    aid = _activity()
    code = _client().post(f"/api/activities/{aid}/preview-student", json={}).json()["code"]
    result = join_group(code, client_ip="10.0.0.1")
    assert result.token
    # Bound to the class, so the activity + tutor resolve exactly as for a student.
    anon = get_document("anon_groups", code)
    assert anon["classId"] == "c1"
    assert anon["preview"] is True


def test_the_preview_group_is_never_counted_as_a_student():
    _make_class("c1")
    aid = _activity()
    code = _client().post(f"/api/activities/{aid}/preview-student", json={}).json()["code"]
    # Not on the roster → not in any class analytic, which all read groupCodes.
    assert code not in get_class("c1").group_codes
    # And the research lens drops it by prefix.
    from analytics.research_logs import NON_STUDENT_PREFIXES

    assert any(code.startswith(p) for p in NON_STUDENT_PREFIXES)


def test_every_click_is_a_fresh_group_that_expires_within_a_day():
    _make_class("c1")
    aid = _activity()
    c = _client()
    a = c.post(f"/api/activities/{aid}/preview-student", json={}).json()["code"]
    b = c.post(f"/api/activities/{aid}/preview-student", json={}).json()["code"]
    assert a != b
    rec = get_document("anon_groups", a)
    assert rec["expires_at"] - rec["created_at"] <= 86400


def test_researcher_may_preview_another_teachers_activity():
    _make_class("c1")
    aid = _activity()
    resp = _client("researcher-r", researcher=True).post(f"/api/activities/{aid}/preview-student", json={})
    assert resp.status_code == 201, resp.text


def test_a_stranger_gets_the_same_404_as_a_missing_activity():
    _make_class("c1")
    aid = _activity()
    assert _client(OTHER).post(f"/api/activities/{aid}/preview-student", json={}).status_code == 404
    assert _client(OTHER).post("/api/activities/act-nope/preview-student", json={}).status_code == 404


def test_an_activity_in_no_class_says_what_to_do():
    aid = _activity(class_id=None)
    resp = _client().post(f"/api/activities/{aid}/preview-student", json={})
    assert resp.status_code == 409
    assert "class" in resp.json()["detail"]


def test_an_explicit_class_must_contain_the_activity():
    _make_class("c1")
    _make_class("c2")
    aid = _activity(class_id="c1")
    assert _client().post(f"/api/activities/{aid}/preview-student", json={"classId": "c2"}).status_code == 409
    assert _client().post(f"/api/activities/{aid}/preview-student", json={"classId": "c1"}).status_code == 201


# ── the pasted-link bug, fixed on the way (prod, 2026-09-22) ─────────────────


@pytest.mark.parametrize(
    ("raw", "code"),
    [
        ("bright-fox-42", "bright-fox-42"),
        ("  BRIGHT-FOX-42 ", "bright-fox-42"),
        ("https://aipla.ku.dk/group?code=merry-grove-47", "merry-grove-47"),
        ("HTTPS://AIPLA.KU.DK/GROUP?CODE=MERRY-GROVE-47&next=/chat/x", "merry-grove-47"),
    ],
)
def test_normalize_join_code(raw, code):
    assert normalize_join_code(raw) == code


def test_a_pasted_link_joins_instead_of_crashing():
    _make_class("c1")
    aid = _activity()
    code = _client().post(f"/api/activities/{aid}/preview-student", json={}).json()["code"]
    assert join_group(f"https://aipla.ku.dk/group?code={code}", client_ip="10.0.0.2").token


def test_a_slash_is_not_found_not_a_firestore_crash():
    with pytest.raises(GroupNotFound):
        join_group("https://aipla.ku.dk/group", client_ip="10.0.0.3")
