"""1.1.163 M1 — GET /api/classes/{id}/groups/{code}/recent.

Owner or researcher; the code must be a live code of THIS class; the window is
5, 10 or 20 minutes; a BigQuery failure is a 503, never an empty window.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from analytics.group_window import GroupWindow, SheetChange
from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class, mint_group_codes_under_class
from db.models.class_ import Class

OWNER = "teacher-alice"


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    from auth.group_id_auth import AnonymousGroupAuth

    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _class(class_id: str, owner: str = OWNER) -> str:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=class_id,
            ownerUid=owner,
            name="Fysik B",
            tagNamespace=f"class:{owner}:{class_id}",
            createdAt=now,
            updatedAt=now,
        )
    )
    return mint_group_codes_under_class(class_id, count=1)[0]


def _client(uid: str = OWNER, *, is_researcher: bool = False) -> TestClient:
    from protocols.classes_routes import router

    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", is_teacher=True, is_researcher=is_researcher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _window(code: str) -> GroupWindow:
    now = datetime(2026, 11, 25, 9, 50, tzinfo=UTC)
    return GroupWindow(
        group_code=code,
        since=datetime(2026, 11, 25, 9, 40, tzinfo=UTC),
        until=now,
        questions=3,
        feedback_requests=5,
        tutor_turns=8,
        tools={"calculate": 1},
        sheets=[SheetChange(title="Undervejs (Del 2-5)", words_before=42, words_now=85)],
        documents_opened=3,
        last_activity_at=now,
    )


def test_owner_reads_the_counted_window():
    code = _class("cls-1")
    with patch("analytics.group_window.read_group_window", return_value=_window(code)) as read:
        resp = _client().get(f"/api/classes/cls-1/groups/{code}/recent?minutes=10")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["groupId"] == code and body["minutes"] == 10
    assert (body["questions"], body["feedbackRequests"], body["tutorTurns"]) == (3, 5, 8)
    assert body["sheets"] == [{"title": "Undervejs (Del 2-5)", "wordsBefore": 42, "wordsNow": 85}]
    assert body["empty"] is False and body["synopsis"] is None
    read.assert_called_once_with(code, 10)


def test_a_code_from_another_class_is_not_found():
    _class("cls-1")
    other = _class("cls-2")
    with patch("analytics.group_window.read_group_window") as read:
        resp = _client().get(f"/api/classes/cls-1/groups/{other}/recent")
    assert resp.status_code == 404
    read.assert_not_called()


def test_another_teachers_class_is_not_found():
    code = _class("cls-1")
    with patch("analytics.group_window.read_group_window") as read:
        resp = _client("teacher-bob").get(f"/api/classes/cls-1/groups/{code}/recent")
    assert resp.status_code == 404
    read.assert_not_called()


def test_a_researcher_may_read_any_class():
    code = _class("cls-1")
    with patch("analytics.group_window.read_group_window", return_value=_window(code)):
        resp = _client("researcher-r", is_researcher=True).get(f"/api/classes/cls-1/groups/{code}/recent")
    assert resp.status_code == 200, resp.text


@pytest.mark.parametrize("minutes", [0, 7, 60])
def test_only_the_offered_windows(minutes):
    code = _class("cls-1")
    resp = _client().get(f"/api/classes/cls-1/groups/{code}/recent?minutes={minutes}")
    assert resp.status_code == 422


def test_an_unreadable_window_is_503_never_an_empty_one():
    code = _class("cls-1")
    with patch("analytics.group_window.read_group_window", side_effect=RuntimeError("bq down")):
        resp = _client().get(f"/api/classes/cls-1/groups/{code}/recent")
    assert resp.status_code == 503
