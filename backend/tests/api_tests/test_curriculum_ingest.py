"""Curriculum library M2 — ingest endpoint tests.

All Firestore writes and RAG uploads are mocked. AILANG Parse is mocked where
the format requires it (docx); plain-text (.txt) goes through the direct-read
path without any external calls.
"""

from __future__ import annotations

import io
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import protocols.curriculum_routes as routes
from auth import User, build_access_context, get_current_user
from tools.documents.ailang_parse import ParseOutcome

TEACHER_UID = "teacher-42"


def _teacher_user(group_id: str = "") -> User:
    return User(uid=TEACHER_UID, email="t@school.dk", group_id=group_id)


def _client(group_id: str = "") -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)

    async def _override(request: Request) -> User:
        u = _teacher_user(group_id)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _txt_upload(filename: str = "notes.txt", content: bytes = b"Newton's first law.") -> tuple[str, dict]:
    return "/api/curriculum/ingest", {
        "files": {"file": (filename, io.BytesIO(content), "text/plain")},
        "data": {"title": "Test Doc", "level": "B", "origin": "uvm.dk"},
    }


# ---------------------------------------------------------------------------
# Auth / deny-by-default
# ---------------------------------------------------------------------------


def test_ingest_student_forbidden():
    """Anonymous group students cannot ingest (deny-by-default)."""
    url, kw = _txt_upload()
    resp = _client(group_id="grp-1").post(url, **kw)
    assert resp.status_code == 403
    assert "teacher-only" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Copyright gate
# ---------------------------------------------------------------------------


def test_ingest_shared_pending_copyright_rejected():
    """Shared ingestion with copyright_status=pending is refused."""
    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("notes.txt", io.BytesIO(b"content"), "text/plain")},
        data={
            "title": "Shared Doc",
            "level": "A",
            "origin": "uvm.dk",
            "shared": "true",
            "copyright_status": "pending",
        },
    )
    assert resp.status_code == 422
    assert "cleared" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Format validation
# ---------------------------------------------------------------------------


def test_ingest_unsupported_format_rejected():
    """Files with unsupported extensions are rejected with 422."""
    resp = _client().post(
        "/api/curriculum/ingest",
        files={"file": ("curriculum.pdf", io.BytesIO(b"%PDF"), "application/pdf")},
        data={"title": "PDF Doc", "level": "B", "origin": "Haka Fysik"},
    )
    assert resp.status_code == 422
    assert "pdf" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Happy path — plain text, no corpus
# ---------------------------------------------------------------------------


def test_ingest_teacher_owned_txt_no_corpus():
    """Teacher uploads a .txt; no corpus configured → doc created, doc_artifact_id empty."""
    url, kw = _txt_upload(content=b"F = ma. Newton's second law.")

    with (
        patch.object(routes, "create_curriculum_doc") as mock_create,
        patch.object(routes, "upload_text_as_rag_file", new_callable=AsyncMock, return_value=None),
    ):
        resp = _client().post(url, **kw)

    assert resp.status_code == 201
    doc = resp.json()["doc"]
    assert doc["level"] == "B"
    assert doc["source"] == "teacher_upload"
    assert doc["ownerScope"] == TEACHER_UID
    assert doc["copyrightStatus"] == "teacher_owned"
    assert doc["docArtifactId"] == ""
    assert doc["origin"] == "uvm.dk"
    mock_create.assert_called_once()


# ---------------------------------------------------------------------------
# Happy path — RAG upload wired
# ---------------------------------------------------------------------------


def test_ingest_with_rag_corpus():
    """When RAG upload succeeds, doc_artifact_id is set to the RagFile resource name."""
    fake_rag_name = "projects/proj/locations/eu-north1/ragCorpora/42/ragFiles/99"
    url, kw = _txt_upload(content=b"Keplers tre love.")

    with (
        patch.object(routes, "create_curriculum_doc"),
        patch.object(
            routes,
            "upload_text_as_rag_file",
            new_callable=AsyncMock,
            return_value=fake_rag_name,
        ),
    ):
        resp = _client().post(url, **kw)

    assert resp.status_code == 201
    assert resp.json()["doc"]["docArtifactId"] == fake_rag_name


# ---------------------------------------------------------------------------
# Happy path — shared corpus, cleared copyright
# ---------------------------------------------------------------------------


def test_ingest_shared_cleared_ok():
    """Shared ingestion with cleared copyright is accepted; owner_scope == 'shared'."""
    resp_data: dict = {}

    def _capture(doc):
        resp_data["doc"] = doc

    with (
        patch.object(routes, "create_curriculum_doc", side_effect=_capture),
        patch.object(routes, "upload_text_as_rag_file", new_callable=AsyncMock, return_value=None),
    ):
        resp = _client().post(
            "/api/curriculum/ingest",
            files={"file": ("uvm.txt", io.BytesIO(b"Laereplansindhold A-niveau."), "text/plain")},
            data={
                "title": "Laereplan A",
                "level": "A",
                "origin": "uvm.dk",
                "shared": "true",
                "copyright_status": "cleared",
            },
        )

    assert resp.status_code == 201
    doc = resp.json()["doc"]
    assert doc["source"] == "shared"
    assert doc["ownerScope"] == "shared"
    assert doc["copyrightStatus"] == "cleared"
    # The captured CurriculumDoc should have the same owner_scope.
    assert resp_data["doc"].owner_scope == "shared"


# ---------------------------------------------------------------------------
# AILANG Parse path (docx) — mocked
# ---------------------------------------------------------------------------


def test_ingest_docx_via_ailang_parse():
    """For .docx uploads, AILANG Parse is called; text feeds the RAG upload."""
    parsed_text = "Parsed markdown from the docx file."

    with (
        patch.object(
            routes,
            "_parse_file_sync",
            return_value=ParseOutcome(content=parsed_text, output_format="markdown"),
        ),
        patch.object(routes, "create_curriculum_doc"),
        patch.object(routes, "upload_text_as_rag_file", new_callable=AsyncMock, return_value=None) as mock_rag,
    ):
        resp = _client().post(
            "/api/curriculum/ingest",
            files={"file": ("chapter.docx", io.BytesIO(b"PK fake docx"), "application/octet-stream")},
            data={"title": "Chapter 3", "level": "C", "origin": "Haka Fysik"},
        )

    assert resp.status_code == 201
    # RAG upload receives the parsed text.
    rag_call_kwargs = mock_rag.call_args
    assert parsed_text in rag_call_kwargs.args or rag_call_kwargs.args[0] == parsed_text
