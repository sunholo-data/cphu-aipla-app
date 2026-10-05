"""1.1.151 F1 — a failed RAG upload is a stored, visible, retryable state.

On 2026-09-07 a teacher's document failed its RAG upload with
``Expecting value: line 1 column 1 (char 0)``; the upload helper swallowed it,
the route logged "Curriculum doc ingested" and returned 200, and the tutor ran
four weeks of lessons without the document. These tests pin the opposite.
"""

from __future__ import annotations

import io
import json
import logging
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import adk.curriculum_retrieval as cretr
import db.curriculum_reingest as reingest_mod
import db.rag_corpus as rag_corpus
import protocols.curriculum_routes as routes
from auth import User, build_access_context, get_current_user
from db.models.activity_config import MaterialRef
from db.models.curriculum import CurriculumDoc
from db.rag_corpus import RagOutcome

OWNER = "teacher-owner"
OTHER = "teacher-other"
CORPUS = "projects/p/locations/europe-west1/ragCorpora/42"


def _user(uid: str = OWNER, *, group_id: str = "", is_researcher: bool = False) -> User:
    return User(
        uid=uid,
        email="" if group_id else f"{uid}@school.dk",
        group_id=group_id,
        is_teacher=not group_id,
        access_tier="pilot",
        is_researcher=is_researcher,
    )


def _client(user: User) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)

    async def _override(request: Request) -> User:
        request.state.access = build_access_context(user)
        return user

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _doc(doc_id: str = "doc-1", *, owner: str = OWNER, artifact: str = "", status: str | None = None) -> CurriculumDoc:
    now = datetime.now(UTC)
    return CurriculumDoc(
        docId=doc_id,
        title="Prompt for Energi",
        source="teacher_upload",
        ownerScope=owner,
        origin="teacher",
        docArtifactId=artifact,
        copyrightStatus="teacher_owned",
        createdAt=now,
        updatedAt=now,
        ragStatus=status,
    )


@pytest.fixture(autouse=True)
def _no_backoff_no_summary(monkeypatch):
    monkeypatch.setattr(rag_corpus, "RETRY_BACKOFF_S", 0)

    async def _fake_summary(text, *, model=None):
        return ""

    monkeypatch.setattr(routes, "summarise_curriculum_text", _fake_summary)


# ---------------------------------------------------------------------------
# F1a — failure is a state, and never logged as "ingested"
# ---------------------------------------------------------------------------


def test_curriculum_upload_rag_failure_is_failed_not_ingested(monkeypatch, caplog):
    """The RAG client raising JSONDecodeError (the 2026-09-07 shape) on BOTH
    attempts leaves ragStatus == "failed", says so in the response, and no log
    line calls the document "ingested"."""
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", CORPUS)
    saved: list[CurriculumDoc] = []
    calls = {"n": 0}

    async def _boom(*a, **k):
        calls["n"] += 1
        raise json.JSONDecodeError("Expecting value", "", 0)

    monkeypatch.setattr(rag_corpus, "_upload_once", _boom)
    monkeypatch.setattr(routes, "create_curriculum_doc", saved.append)
    monkeypatch.setattr(routes, "set_curriculum_content", lambda d, t: None)

    with caplog.at_level(logging.INFO):
        resp = _client(_user()).post(
            "/api/curriculum/ingest",
            files={"file": ("energi.txt", io.BytesIO(b"en parret elevsamtale om energibevarelse"), "text/plain")},
            data={"title": "Prompt for Energi", "origin": "AR"},
        )

    assert resp.status_code == 201, resp.text
    doc = resp.json()["doc"]
    assert doc["ragStatus"] == "failed"
    assert doc["docArtifactId"] == ""
    assert doc["ragAttempts"] == 2
    assert "JSONDecodeError" in doc["ragError"]
    assert calls["n"] == 2, "one automatic retry"
    assert saved[0].rag_status == "failed"
    messages = [r.getMessage() for r in caplog.records]
    assert not any("ingested" in m for m in messages), messages
    assert any("rag_failed" in m for m in messages)


def test_upload_retries_once_then_succeeds(monkeypatch):
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", CORPUS)
    attempts = iter([json.JSONDecodeError("Expecting value", "", 0), "rag/ok"])

    async def _flaky(*a, **k):
        outcome = next(attempts)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    monkeypatch.setattr(rag_corpus, "_upload_once", _flaky)
    monkeypatch.setattr(routes, "create_curriculum_doc", lambda d: None)
    monkeypatch.setattr(routes, "set_curriculum_content", lambda d, t: None)

    resp = _client(_user()).post(
        "/api/curriculum/ingest",
        files={"file": ("n.txt", io.BytesIO(b"text"), "text/plain")},
        data={"title": "T", "origin": "o"},
    )
    doc = resp.json()["doc"]
    assert doc["ragStatus"] == "ready"
    assert doc["docArtifactId"] == "rag/ok"
    assert doc["ragAttempts"] == 2
    assert doc["ragError"] is None


def test_unconfigured_corpus_is_failed_with_a_plain_reason(monkeypatch):
    monkeypatch.delenv("CURRICULUM_RAG_CORPUS_NAME", raising=False)
    monkeypatch.setattr(routes, "create_curriculum_doc", lambda d: None)
    monkeypatch.setattr(routes, "set_curriculum_content", lambda d, t: None)
    resp = _client(_user()).post(
        "/api/curriculum/ingest",
        files={"file": ("n.txt", io.BytesIO(b"text"), "text/plain")},
        data={"title": "T", "origin": "o"},
    )
    doc = resp.json()["doc"]
    assert doc["ragStatus"] == "failed"
    assert doc["ragError"] == rag_corpus.NOT_CONFIGURED_ERROR


def test_legacy_row_status_is_derived_on_read():
    """A row written before 1.1.151 has no ragStatus: ready iff it has a RAG
    file, else failed — never silently "fine"."""
    assert _doc(artifact="rag/1").rag_status == "ready"
    assert _doc(artifact="").rag_status == "failed"
    assert _doc(artifact="", status="pending").rag_status == "pending"


# ---------------------------------------------------------------------------
# F1b — reingest
# ---------------------------------------------------------------------------


@pytest.fixture()
def store(monkeypatch):
    docs: dict[str, CurriculumDoc] = {}
    writes: list[str] = []

    def _get(doc_id):
        d = docs.get(doc_id)
        return d.model_copy(deep=True) if d else None

    def _put(doc):
        writes.append(doc.rag_status)
        docs[doc.doc_id] = doc.model_copy(deep=True)

    monkeypatch.setattr(routes, "get_curriculum_doc", _get)
    monkeypatch.setattr(reingest_mod, "create_curriculum_doc", _put)
    monkeypatch.setattr(
        reingest_mod, "get_curriculum_content", lambda doc_id: {"text": "stored text"} if doc_id in docs else None
    )
    return docs, writes


def test_reingest_moves_failed_to_ready(store):
    docs, writes = store
    docs["doc-1"] = _doc(status="failed")
    with patch.object(
        reingest_mod, "upload_with_retry", new_callable=AsyncMock, return_value=RagOutcome("rag/new", None, 1)
    ) as up:
        resp = _client(_user()).post("/api/curriculum/doc-1/reingest")
    assert resp.status_code == 200, resp.text
    body = resp.json()["doc"]
    assert body["ragStatus"] == "ready"
    assert body["docArtifactId"] == "rag/new"
    assert body["ragError"] is None
    assert up.call_args.args[0] == "stored text"
    assert writes == ["pending", "ready"], "pending is written before the upload"
    assert docs["doc-1"].rag_status == "ready"


def test_reingest_failure_keeps_a_working_previous_file(store):
    docs, _ = store
    docs["doc-1"] = _doc(artifact="rag/old", status="ready")
    with (
        patch.object(
            reingest_mod, "upload_with_retry", new_callable=AsyncMock, return_value=RagOutcome(None, "Boom", 2)
        ),
        patch.object(reingest_mod, "delete_rag_file", new_callable=AsyncMock) as delete,
    ):
        resp = _client(_user()).post("/api/curriculum/doc-1/reingest")
    body = resp.json()["doc"]
    assert body["docArtifactId"] == "rag/old"
    assert body["ragStatus"] == "ready"
    assert body["ragError"] == "Boom"
    delete.assert_not_called()


def test_reingest_another_teachers_doc_is_404_but_a_researcher_may(store):
    docs, _ = store
    docs["doc-1"] = _doc(owner=OTHER, status="failed")
    assert _client(_user()).post("/api/curriculum/doc-1/reingest").status_code == 404
    with patch.object(
        reingest_mod, "upload_with_retry", new_callable=AsyncMock, return_value=RagOutcome("rag/new", None, 1)
    ):
        resp = _client(_user(is_researcher=True)).post("/api/curriculum/doc-1/reingest")
    assert resp.status_code == 200
    assert resp.json()["doc"]["ragStatus"] == "ready"


def test_reingest_without_stored_text_is_409(store, monkeypatch):
    docs, _ = store
    docs["doc-1"] = _doc(status="failed")
    monkeypatch.setattr(reingest_mod, "get_curriculum_content", lambda doc_id: None)
    assert _client(_user()).post("/api/curriculum/doc-1/reingest").status_code == 409


# ---------------------------------------------------------------------------
# F1b — a REAL student token is rejected (not a hand-built User)
# ---------------------------------------------------------------------------


def test_reingest_rejects_a_real_group_token(monkeypatch):
    from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
    from db import firestore as fs_module

    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    try:
        record = create_group(title="F1 class", skill_ids=["concept-dialogue"], creator_uid=OWNER)
        token = join_group(record.group_id, client_ip="203.0.113.9").token
        app = FastAPI()
        app.include_router(routes.router)  # REAL get_current_user, no override
        resp = TestClient(app).post("/api/curriculum/any-doc/reingest", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403, resp.text
    finally:
        fs_module._reset_client_for_testing()
        AnonymousGroupAuth.reset_for_tests()


# ---------------------------------------------------------------------------
# F1a backfill plan
# ---------------------------------------------------------------------------


def test_backfill_plan_stamps_only_rows_without_status():
    from scripts.backfill_rag_status import LEGACY_ERROR, plan_stamps

    plan = dict(
        plan_stamps(
            [
                {"docId": "a", "docArtifactId": "rag/1"},
                {"docId": "b", "docArtifactId": ""},
                {"docId": "c", "docArtifactId": "", "ragStatus": "failed"},
            ]
        )
    )
    assert set(plan) == {"a", "b"}
    assert plan["a"]["ragStatus"] == "ready"
    assert plan["b"]["ragStatus"] == "failed"
    assert plan["b"]["ragError"] == LEGACY_ERROR


# ---------------------------------------------------------------------------
# F1d — retrieval logs a failed doc once per session, with the activity
# ---------------------------------------------------------------------------


def test_retrieval_logs_a_failed_doc_once_per_session(monkeypatch, caplog):
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", CORPUS)
    cretr._unreadable_logged.clear()
    failed = _doc("b594", status="failed")
    monkeypatch.setattr(cretr, "get_curriculum_doc", lambda doc_id: failed)
    mats = [MaterialRef(docId="b594", origin="AR")]

    with caplog.at_level(logging.INFO):
        for _ in range(5):
            assert (
                cretr.build_curriculum_retrieval_tool(mats, activity_id="act-ball", session_key="g1:act-ball") is None
            )
        cretr.build_curriculum_retrieval_tool(mats, activity_id="act-ball", session_key="g2:act-ball")

    warnings = [r.getMessage() for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 2, warnings  # once for g1, once for g2
    assert "curriculum_rag_failed" in warnings[0]
    assert "act-ball" in warnings[0]
    assert not any("pending ingest" in r.getMessage() for r in caplog.records)


# ---------------------------------------------------------------------------
# F1c — batch status for activity cards / class view
# ---------------------------------------------------------------------------


def test_rag_status_batch_is_acl_scoped(store):
    docs, _ = store
    docs["mine"] = _doc("mine", status="failed")
    docs["theirs"] = _doc("theirs", owner=OTHER, status="failed")
    resp = _client(_user()).get("/api/curriculum/rag-status", params=[("ids", "mine"), ("ids", "theirs"), ("ids", "x")])
    assert resp.status_code == 200
    statuses = resp.json()["statuses"]
    assert set(statuses) == {"mine"}
    assert statuses["mine"]["ragStatus"] == "failed"
    assert statuses["mine"]["canRetry"] is True
