"""API tests for /api/analytics/* endpoints (sprint
ANALYTICS-CHAT-AND-INSIGHTS, M5).

Three properties under test:

1. ``GET /api/analytics/tools`` returns six tools for a teacher;
   forbidden for non-teachers.
2. ``POST /api/analytics/probe/{tool}`` returns the tool's result for
   an owned class.
3. **HARD GATE preservation.** Cross-tenant probe (a teacher probing a
   class they don't own) returns a 404 with the same byte-identical
   ``class not accessible`` detail as a probe against a class that
   doesn't exist. Tests assert equality of the response payloads, not
   just status codes.

BigQuery is mocked at the ``analytics.queries`` boundary — these tests
exercise the route + auth surface, not the SQL.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from db.classes import create_class, mint_group_codes_under_class
from db.models.class_ import Class
from protocols.analytics_routes import router

TEACHER_UID = "teacher-alice"
OTHER_TEACHER_UID = "teacher-bob"
MISSING_CLASS_ID = "this-class-does-not-exist"


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


def _make_app(*, uid: str = TEACHER_UID, is_teacher: bool = True) -> FastAPI:
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email=f"{uid}@example.test", is_teacher=is_teacher)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return app


def _create_owned_class(owner_uid: str, *, name: str = "9A Physics") -> str:
    cls = Class.create_for_teacher(owner_uid=owner_uid, name=name)
    create_class(cls)
    mint_group_codes_under_class(cls.class_id, count=2)
    return cls.class_id


@pytest.fixture()
def teacher_client():
    return TestClient(_make_app())


@pytest.fixture()
def other_teacher_client():
    return TestClient(_make_app(uid=OTHER_TEACHER_UID))


@pytest.fixture()
def student_client():
    return TestClient(_make_app(uid="anon-X", is_teacher=False))


# ---------------------------------------------------------------------------
# GET /api/analytics/tools
# ---------------------------------------------------------------------------


class TestListTools:
    def test_teacher_sees_six_tools(self, teacher_client):
        resp = teacher_client.get("/api/analytics/tools")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        names = {t["name"] for t in body["tools"]}
        assert names == {
            "count_messages",
            "time_on_task",
            "sim_runs_per_skill",
            "most_active_groups",
            "group_summary",
            "summarise_chat_excerpts",
        }

    def test_each_tool_has_description_and_params(self, teacher_client):
        resp = teacher_client.get("/api/analytics/tools")
        body = resp.json()
        for tool in body["tools"]:
            assert tool["description"], f"{tool['name']} missing description"
            assert isinstance(tool["parameters"], list)
            # class_id is the required first param for every analytics tool.
            class_param = next(p for p in tool["parameters"] if p["name"] == "class_id")
            assert class_param["required"] is True
            # tool_context must NOT be exposed via the REST contract.
            assert all(p["name"] != "tool_context" for p in tool["parameters"])

    def test_student_forbidden(self, student_client):
        resp = student_client.get("/api/analytics/tools")
        assert resp.status_code == 403
        assert resp.json()["detail"] == "teacher access required"


# ---------------------------------------------------------------------------
# POST /api/analytics/probe/{tool}
# ---------------------------------------------------------------------------


class TestProbe:
    def test_owned_class_count_messages_returns_result(self, teacher_client, monkeypatch):
        class_id = _create_owned_class(TEACHER_UID)

        captured: dict[str, Any] = {}

        def _fake(**kwargs):
            captured.update(kwargs)
            return {"total": 42, "per_group": [{"group_code": "g1", "count": 42}]}

        monkeypatch.setattr("analytics.queries.count_messages", _fake)

        resp = teacher_client.post(
            "/api/analytics/probe/count_messages",
            json={"class_id": class_id, "kwargs": {}},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["tool"] == "count_messages"
        assert body["class_id"] == class_id
        assert body["result"]["total"] == 42
        # The query saw the auth-resolved group codes, not raw user input.
        assert isinstance(captured["allowed_group_codes"], list)
        assert isinstance(captured["class_group_codes"], list)

    def test_unknown_tool_returns_404(self, teacher_client):
        class_id = _create_owned_class(TEACHER_UID)
        resp = teacher_client.post(
            "/api/analytics/probe/no_such_tool",
            json={"class_id": class_id, "kwargs": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "tool not found"

    def test_student_forbidden(self, student_client):
        resp = student_client.post(
            "/api/analytics/probe/count_messages",
            json={"class_id": "any", "kwargs": {}},
        )
        assert resp.status_code == 403

    # ----- HARD GATE: cross-tenant must look identical to missing -----

    def test_missing_class_returns_class_not_accessible(self, teacher_client):
        resp = teacher_client.post(
            "/api/analytics/probe/count_messages",
            json={"class_id": MISSING_CLASS_ID, "kwargs": {}},
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "class not accessible"

    def test_cross_tenant_class_returns_identical_payload_as_missing(self, teacher_client, other_teacher_client):
        # Bob creates a class; Alice probes it.
        bob_class = _create_owned_class(OTHER_TEACHER_UID, name="Bob's class")

        cross_tenant = teacher_client.post(
            "/api/analytics/probe/count_messages",
            json={"class_id": bob_class, "kwargs": {}},
        )
        missing = teacher_client.post(
            "/api/analytics/probe/count_messages",
            json={"class_id": MISSING_CLASS_ID, "kwargs": {}},
        )

        assert cross_tenant.status_code == missing.status_code == 404
        # The HARD GATE: byte-identical bodies for missing vs not-owned.
        assert cross_tenant.json() == missing.json()
        assert cross_tenant.content == missing.content

    def test_bad_kwargs_returns_400(self, teacher_client):
        class_id = _create_owned_class(TEACHER_UID)
        resp = teacher_client.post(
            "/api/analytics/probe/count_messages",
            json={"class_id": class_id, "kwargs": {"definitely_not_a_param": 1}},
        )
        assert resp.status_code == 400
        assert "invalid arguments" in resp.json()["detail"]
