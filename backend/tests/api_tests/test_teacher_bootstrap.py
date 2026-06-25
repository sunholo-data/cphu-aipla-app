"""Tests for the teacher onboarding demo seed + bootstrap endpoint."""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import list_classes_for_owner
from onboarding.demo_seed import seed_demo_for_teacher
from protocols.teacher_bootstrap_routes import router as bootstrap_router

TEACHER = "teacher-new"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    # The demo seed mints a class join code → anonymous-group auth needs a secret.
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-not-for-production-use")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _client(uid: str = TEACHER, *, is_teacher: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(bootstrap_router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", domain="example.test", is_teacher=is_teacher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def test_seed_creates_demo_class_and_two_activities():
    result = seed_demo_for_teacher(TEACHER)
    assert result is not None
    assert result["className"] == "Demo class"
    assert len(result["activityIds"]) == 2
    assert result["joinCode"]  # a code was minted
    classes = list_classes_for_owner(TEACHER)
    assert len(classes) == 1
    assert classes[0].name == "Demo class"
    # Both activities assigned to the demo class.
    assert set(result["activityIds"]) <= set(classes[0].activity_ids)


def test_seed_is_a_no_op_when_teacher_already_has_a_class():
    seed_demo_for_teacher(TEACHER)
    second = seed_demo_for_teacher(TEACHER)  # already has the demo class
    assert second is None
    assert len(list_classes_for_owner(TEACHER)) == 1  # not duplicated


def test_bootstrap_seeds_then_is_idempotent():
    c = _client()
    first = c.post("/api/teacher/bootstrap").json()
    assert first["seeded"] is True
    assert first["className"] == "Demo class"

    second = c.post("/api/teacher/bootstrap").json()
    assert second["seeded"] is False  # nothing created the second time


def test_bootstrap_forbidden_for_non_teacher():
    resp = _client(uid="anon-x", is_teacher=False).post("/api/teacher/bootstrap")
    assert resp.status_code == 403
