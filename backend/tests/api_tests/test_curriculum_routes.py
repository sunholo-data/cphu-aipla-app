"""Curriculum library M1 — browse ACL + CRUD filtering (mocked Firestore)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import db.curriculum as dbc
from auth import User, build_access_context, get_current_user
from db.models.curriculum import CurriculumDoc
from protocols.curriculum_routes import router

TEACHER = "teacher-1"


def _doc(doc_id, level, owner, topic=None, source="teacher_upload"):
    now = datetime.now(UTC)
    return CurriculumDoc(
        docId=doc_id,
        title=f"Doc {doc_id}",
        level=level,
        topic=topic,
        source=source,
        ownerScope=owner,
        origin="uvm.dk" if source == "shared" else "teacher",
        copyrightStatus="cleared" if source == "shared" else "teacher_owned",
        createdAt=now,
        updatedAt=now,
    )


def _wire_store(monkeypatch, shared, mine):
    """Mock query_documents by ownerScope filter -> shared / teacher's docs."""

    def fake_query(collection, filters=None):
        owner = filters[0][2] if filters else None
        src = shared if owner == "shared" else (mine if owner == TEACHER else [])
        return [d.model_dump(by_alias=True, mode="json") for d in src]

    monkeypatch.setattr(dbc, "query_documents", fake_query)


def _client(group_id=None):
    app = FastAPI()
    app.include_router(router)

    async def _override(request: Request) -> User:
        u = User(uid=TEACHER, email="t@x.dk", group_id=group_id) if group_id else User(uid=TEACHER, email="t@x.dk")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


# --- CRUD/ACL lib ---


def test_list_returns_shared_union_own(monkeypatch):
    _wire_store(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[_doc("m1", "B", TEACHER)])
    out = dbc.list_curriculum_for_teacher(TEACHER)
    assert {d.doc_id for d in out} == {"s1", "m1"}


def test_scope_mine_excludes_shared(monkeypatch):
    _wire_store(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[_doc("m1", "B", TEACHER)])
    out = dbc.list_curriculum_for_teacher(TEACHER, scope="mine")
    assert {d.doc_id for d in out} == {"m1"}


def test_level_and_topic_filter(monkeypatch):
    _wire_store(
        monkeypatch,
        shared=[],
        mine=[_doc("a", "A", TEACHER, topic="mechanics"), _doc("b", "B", TEACHER, topic="optics")],
    )
    out = dbc.list_curriculum_for_teacher(TEACHER, level="A")
    assert [d.doc_id for d in out] == ["a"]
    out2 = dbc.list_curriculum_for_teacher(TEACHER, topic="OPTICS")  # case-insensitive
    assert [d.doc_id for d in out2] == ["b"]


# --- browse endpoint ---


def test_browse_teacher_ok(monkeypatch):
    _wire_store(monkeypatch, shared=[_doc("s1", "B", "shared", source="shared")], mine=[])
    resp = _client().get("/api/curriculum?scope=shared")
    assert resp.status_code == 200
    assert [d["docId"] for d in resp.json()["docs"]] == ["s1"]


def test_browse_student_forbidden(monkeypatch):
    resp = _client(group_id="grp-1").get("/api/curriculum")
    assert resp.status_code == 403


def test_browse_rejects_bad_scope():
    resp = _client().get("/api/curriculum?scope=everything")
    assert resp.status_code == 422  # pattern guard
