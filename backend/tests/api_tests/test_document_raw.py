"""GET /api/documents/{docId}/raw — original-bytes streaming for the viewer (1.1.45 M2).

Owner-ACL (the uploader — student-viewing-own-upload or teacher-viewing-own). The
GCS read is patched; these cover the 404/403/owner gates + the mime + the
no-original-bytes fallback. Reading from the stored gs:// URL avoids re-deriving
the bucket (the anonymous-group bucket-resolution corner).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import tools.documents.routes as routes
from auth import User, build_access_context, get_current_user

OWNER = "user-1"


def _client(uid: str = OWNER) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router)

    async def _override(request: Request) -> User:
        u = User(uid=uid, email="t@school.dk")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


_DOC = {
    "userId": OWNER,
    "sourceUrl": "gs://bucket/users/user-1/docs/f/report.pdf",
    "storagePath": "users/user-1/docs/f/report.pdf",
    "originalName": "report.pdf",
}


def test_missing_doc_404():
    with patch.object(routes, "_get_firestore_doc", return_value=None):
        resp = _client().get("/api/documents/nope/raw")
    assert resp.status_code == 404


def test_not_owner_403():
    with patch.object(routes, "_get_firestore_doc", return_value=_DOC):
        resp = _client(uid="someone-else").get("/api/documents/d1/raw")
    assert resp.status_code == 403


def test_no_original_bytes_404():
    doc = {"userId": OWNER, "originalName": "notes.txt"}  # no sourceUrl
    with patch.object(routes, "_get_firestore_doc", return_value=doc):
        resp = _client().get("/api/documents/d1/raw")
    assert resp.status_code == 404


def test_owner_gets_pdf_bytes():
    with (
        patch.object(routes, "_get_firestore_doc", return_value=_DOC),
        patch.object(routes, "_read_doc_bytes", new=AsyncMock(return_value=b"%PDF-1.7 real")),
    ):
        resp = _client().get("/api/documents/d1/raw")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.content == b"%PDF-1.7 real"


def test_read_failure_404():
    with (
        patch.object(routes, "_get_firestore_doc", return_value=_DOC),
        patch.object(routes, "_read_doc_bytes", new=AsyncMock(side_effect=FileNotFoundError())),
    ):
        resp = _client().get("/api/documents/d1/raw")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# 1.1.45 M3b — list the caller's (group's) uploads (viewer file tabs)
# ---------------------------------------------------------------------------


def test_list_my_documents_returns_trimmed_group_uploads():
    rows = [
        {"__id": "d1", "originalFilename": "Rapport.pdf", "sourceFormat": "pdf", "userId": OWNER},
        {"__id": "d2", "originalFilename": "Noter.docx", "sourceFormat": "docx", "userId": OWNER},
    ]
    with patch("tools.documents.context.list_documents_for_user", return_value=rows) as q:
        resp = _client(uid=OWNER).get("/api/documents?skillId=act-1")
    assert resp.status_code == 200
    docs = resp.json()["documents"]
    assert [d["docId"] for d in docs] == ["d1", "d2"]
    assert docs[0]["name"] == "Rapport.pdf"
    # Listed for the CALLER's uid (the group-stable uid for students) + the skill.
    assert q.call_args.args[0] == OWNER
    assert q.call_args.kwargs.get("skill_id") == "act-1"
