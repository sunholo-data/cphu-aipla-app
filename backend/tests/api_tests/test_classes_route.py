"""API tests for /api/classes/* endpoints (1.A M4).

Uses InMemoryFirestoreClient via LOCAL_MODE so writes round-trip
without GCP. Auth is overridden to a fixed teacher uid; one swap-able
fixture exercises the "non-teacher" + "other teacher" branches.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from db import firestore as fs_module
from protocols.classes_routes import router

TEACHER_UID = "teacher-alice"
OTHER_TEACHER_UID = "teacher-bob"


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


@pytest.fixture()
def client():
    return TestClient(_make_app())


@pytest.fixture()
def student_client():
    return TestClient(_make_app(uid="anon-X", is_teacher=False))


@pytest.fixture()
def other_teacher_client():
    return TestClient(_make_app(uid=OTHER_TEACHER_UID))


# ---------------------------------------------------------------------------
# POST /api/classes — create
# ---------------------------------------------------------------------------


class TestCreateClass:
    def test_create_class_happy_path(self, client):
        resp = client.post("/api/classes", json={"name": "Physik 9A"})
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["name"] == "Physik 9A"
        assert body["ownerUid"] == TEACHER_UID
        assert body["tagNamespace"].startswith(f"class:{TEACHER_UID}:")
        assert body["revoked"] is False

    def test_create_class_with_description(self, client):
        resp = client.post("/api/classes", json={"name": "Class", "description": "9th grade"})
        assert resp.status_code == 201
        assert resp.json()["description"] == "9th grade"

    def test_create_class_rejects_non_teacher(self, student_client):
        resp = student_client.post("/api/classes", json={"name": "Class"})
        assert resp.status_code == 403

    def test_create_class_rejects_empty_name(self, client):
        resp = client.post("/api/classes", json={"name": ""})
        assert resp.status_code == 422

    def test_create_class_rejects_extra_fields(self, client):
        resp = client.post(
            "/api/classes",
            json={"name": "Class", "tagNamespace": "class:hacker:xxx"},
        )
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/classes — list
# ---------------------------------------------------------------------------


class TestListClasses:
    def test_list_returns_only_my_classes(self, client, other_teacher_client):
        client.post("/api/classes", json={"name": "A1"})
        client.post("/api/classes", json={"name": "A2"})
        other_teacher_client.post("/api/classes", json={"name": "B1"})

        resp = client.get("/api/classes")
        assert resp.status_code == 200
        names = {c["name"] for c in resp.json()["classes"]}
        assert names == {"A1", "A2"}
        assert all(c["ownerUid"] == TEACHER_UID for c in resp.json()["classes"])

    def test_list_excludes_revoked(self, client):
        client.post("/api/classes", json={"name": "Active"})
        b = client.post("/api/classes", json={"name": "ToRevoke"}).json()
        client.delete(f"/api/classes/{b['classId']}")

        resp = client.get("/api/classes")
        names = {c["name"] for c in resp.json()["classes"]}
        assert names == {"Active"}

    def test_list_rejects_non_teacher(self, student_client):
        resp = student_client.get("/api/classes")
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /api/classes/{class_id} — get one
# ---------------------------------------------------------------------------


class TestGetOne:
    def test_get_returns_my_class(self, client):
        created = client.post("/api/classes", json={"name": "Class"}).json()
        resp = client.get(f"/api/classes/{created['classId']}")
        assert resp.status_code == 200
        assert resp.json()["classId"] == created["classId"]

    def test_get_returns_404_for_other_teachers_class(self, client, other_teacher_client):
        """Don't leak existence — 404, not 403."""
        b = other_teacher_client.post("/api/classes", json={"name": "B's"}).json()
        resp = client.get(f"/api/classes/{b['classId']}")
        assert resp.status_code == 404

    def test_get_returns_404_for_missing(self, client):
        resp = client.get("/api/classes/does-not-exist")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/classes/{class_id} — update
# ---------------------------------------------------------------------------


class TestPatchClass:
    def test_patch_name(self, client):
        created = client.post("/api/classes", json={"name": "Old"}).json()
        resp = client.patch(
            f"/api/classes/{created['classId']}",
            json={"name": "New"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New"

    def test_patch_other_teachers_class_404(self, client, other_teacher_client):
        b = other_teacher_client.post("/api/classes", json={"name": "B"}).json()
        resp = client.patch(f"/api/classes/{b['classId']}", json={"name": "Hijacked"})
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/classes/{class_id} — soft-delete
# ---------------------------------------------------------------------------


class TestDeleteClass:
    def test_delete_marks_revoked(self, client):
        created = client.post("/api/classes", json={"name": "C"}).json()
        resp = client.delete(f"/api/classes/{created['classId']}")
        assert resp.status_code == 200
        assert resp.json()["revoked"] is True

        # GET still works (owner-side audit trail)
        get_resp = client.get(f"/api/classes/{created['classId']}")
        assert get_resp.status_code == 200
        assert get_resp.json()["revoked"] is True

    def test_delete_other_teachers_class_404(self, client, other_teacher_client):
        b = other_teacher_client.post("/api/classes", json={"name": "B"}).json()
        resp = client.delete(f"/api/classes/{b['classId']}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/classes/{class_id}/lessons — manage lessons
# ---------------------------------------------------------------------------


class TestPatchLessons:
    def _seed_skill(self, skill_id: str) -> None:
        """Drop a minimal skill doc into the in-memory store so the
        lessons-PATCH can read + write its accessControl."""
        from db.firestore import set_document

        set_document(
            "skills",
            skill_id,
            {
                "skillId": skill_id,
                "name": skill_id,
                "slug": skill_id,
                "accessControl": {"type": "public"},
            },
        )

    def test_add_lessons_writes_class_only_for_public_skills(self, client):
        """Public skills stay public when assigned to a class.

        Assignment is tracked in Class.lessons only — the skill's
        accessControl is NOT mutated. Teachers always see public skills
        regardless of which class they're in. Students receive the
        assigned skill_ids via their group token (live-resolved from
        Class.lessons at join time).
        """
        self._seed_skill("skill-a")
        self._seed_skill("skill-b")
        created = client.post("/api/classes", json={"name": "C"}).json()
        cid = created["classId"]

        resp = client.patch(
            f"/api/classes/{cid}/lessons",
            json={"add": ["skill-a", "skill-b"]},
        )
        assert resp.status_code == 200
        assert set(resp.json()["lessons"]) == {"skill-a", "skill-b"}

        # Public skill's accessControl is untouched — stays public.
        from db.firestore import get_document

        sa = get_document("skills", "skill-a")
        assert sa["accessControl"]["type"] == "public"

    def test_add_lessons_idempotent(self, client):
        self._seed_skill("skill-a")
        created = client.post("/api/classes", json={"name": "C"}).json()
        cid = created["classId"]

        client.patch(f"/api/classes/{cid}/lessons", json={"add": ["skill-a"]})
        client.patch(f"/api/classes/{cid}/lessons", json={"add": ["skill-a"]})

        # lessons appears exactly once on the class side even after double-add.
        c = client.get(f"/api/classes/{cid}").json()
        assert c["lessons"] == ["skill-a"]

    def test_remove_lessons_updates_class_only_for_public_skills(self, client):
        """Removing a public lesson from a class updates Class.lessons only.
        The skill's accessControl is never touched (it was never tagged)."""
        self._seed_skill("skill-a")
        created = client.post("/api/classes", json={"name": "C"}).json()
        cid = created["classId"]
        client.patch(f"/api/classes/{cid}/lessons", json={"add": ["skill-a"]})
        client.patch(f"/api/classes/{cid}/lessons", json={"remove": ["skill-a"]})

        # Class side: lesson removed.
        c = client.get(f"/api/classes/{cid}").json()
        assert c["lessons"] == []

        # Skill side: still public (was never mutated to tagged).
        from db.firestore import get_document

        sa = get_document("skills", "skill-a")
        assert sa["accessControl"]["type"] == "public"

    def test_add_lesson_missing_skill_returns_404(self, client):
        created = client.post("/api/classes", json={"name": "C"}).json()
        resp = client.patch(
            f"/api/classes/{created['classId']}/lessons",
            json={"add": ["does-not-exist"]},
        )
        assert resp.status_code == 404

    def test_lessons_on_other_teachers_class_returns_404(self, client, other_teacher_client):
        b = other_teacher_client.post("/api/classes", json={"name": "B"}).json()
        resp = client.patch(
            f"/api/classes/{b['classId']}/lessons",
            json={"add": ["skill-a"]},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/classes/{class_id}/groups — mint codes
# ---------------------------------------------------------------------------


class TestMintGroups:
    def test_mint_default_one_code(self, client):
        created = client.post("/api/classes", json={"name": "C"}).json()
        resp = client.post(f"/api/classes/{created['classId']}/groups", json={})
        assert resp.status_code == 201
        body = resp.json()
        assert len(body["codes"]) == 1

    def test_mint_multiple_codes(self, client):
        created = client.post("/api/classes", json={"name": "C"}).json()
        resp = client.post(
            f"/api/classes/{created['classId']}/groups",
            json={"count": 3},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert len(body["codes"]) == 3
        # All distinct.
        assert len(set(body["codes"])) == 3

    def test_mint_rejects_excessive_count(self, client):
        created = client.post("/api/classes", json={"name": "C"}).json()
        resp = client.post(
            f"/api/classes/{created['classId']}/groups",
            json={"count": 9999},
        )
        assert resp.status_code == 422

    def test_mint_on_other_teachers_class_404(self, client, other_teacher_client):
        b = other_teacher_client.post("/api/classes", json={"name": "B"}).json()
        resp = client.post(
            f"/api/classes/{b['classId']}/groups",
            json={"count": 1},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/classes/{class_id}/groups/{code} — revoke
# ---------------------------------------------------------------------------


class TestRevokeGroup:
    def test_revoke_drops_code_from_class(self, client):
        created = client.post("/api/classes", json={"name": "C"}).json()
        cid = created["classId"]
        codes = client.post(f"/api/classes/{cid}/groups", json={"count": 2}).json()["codes"]

        resp = client.delete(f"/api/classes/{cid}/groups/{codes[0]}")
        assert resp.status_code == 200
        assert resp.json()["revoked"] is True

        # Class.groupCodes no longer contains the revoked code.
        c = client.get(f"/api/classes/{cid}").json()
        assert codes[0] not in c["groupCodes"]
        assert codes[1] in c["groupCodes"]

    def test_revoke_other_teachers_group_404(self, client, other_teacher_client):
        b = other_teacher_client.post("/api/classes", json={"name": "B"}).json()
        codes = other_teacher_client.post(f"/api/classes/{b['classId']}/groups", json={"count": 1}).json()["codes"]

        resp = client.delete(f"/api/classes/{b['classId']}/groups/{codes[0]}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/classes/{class_id}/groups/{code}/reset-session — archive session
# ---------------------------------------------------------------------------


class TestResetGroupSession:
    def test_reset_archives_session(self, client):
        """Happy path: reset-session returns 204 and archives the group's session."""
        from db.group_sessions import get_active_session_for_group, set_active_session_for_group

        cid = client.post("/api/classes", json={"name": "C"}).json()["classId"]
        codes = client.post(f"/api/classes/{cid}/groups", json={"count": 1}).json()["codes"]
        code = codes[0]

        # Seed a session for the group so archive_session_for_group has something to do.
        set_active_session_for_group(code, "session-abc-123")
        assert get_active_session_for_group(code) == "session-abc-123"

        resp = client.post(f"/api/classes/{cid}/groups/{code}/reset-session")
        assert resp.status_code == 204

        # Session is now archived — next join will start fresh.
        assert get_active_session_for_group(code) is None

    def test_reset_idempotent_no_session(self, client):
        """Reset on a group with no active session is a no-op (204, not 500)."""
        cid = client.post("/api/classes", json={"name": "C"}).json()["classId"]
        codes = client.post(f"/api/classes/{cid}/groups", json={"count": 1}).json()["codes"]
        code = codes[0]

        resp = client.post(f"/api/classes/{cid}/groups/{code}/reset-session")
        assert resp.status_code == 204

    def test_reset_rejects_non_teacher(self, student_client, client):
        cid = client.post("/api/classes", json={"name": "C"}).json()["classId"]
        codes = client.post(f"/api/classes/{cid}/groups", json={"count": 1}).json()["codes"]

        resp = student_client.post(f"/api/classes/{cid}/groups/{codes[0]}/reset-session")
        assert resp.status_code == 403

    def test_reset_other_teachers_class_404(self, client, other_teacher_client):
        b = other_teacher_client.post("/api/classes", json={"name": "B"}).json()
        codes = other_teacher_client.post(f"/api/classes/{b['classId']}/groups", json={"count": 1}).json()["codes"]

        resp = client.post(f"/api/classes/{b['classId']}/groups/{codes[0]}/reset-session")
        assert resp.status_code == 404

    def test_reset_unknown_code_404(self, client):
        cid = client.post("/api/classes", json={"name": "C"}).json()["classId"]

        resp = client.post(f"/api/classes/{cid}/groups/XXXX-XXXX/reset-session")
        assert resp.status_code == 404
