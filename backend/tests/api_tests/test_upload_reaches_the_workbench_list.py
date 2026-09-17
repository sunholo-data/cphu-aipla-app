"""The upload → list join, end to end (2026-09-16).

`StudentDocumentWorkbench` does two things in a row: POST the file with the
activity's `skill_id` as a multipart form field, then GET
`/api/documents?skillId=<activity>` and show what comes back. For four months
those two halves each had green tests and the join had none — the upload
route read `skill_id` as a QUERY parameter, so every record carried
`skillId=""` and the list (which filters `skillId == activity`) never returned
the file the student had just uploaded. Aswin's "I cannot upload the document
in the workbench" (busy-garden-11, 2026-09-15): the upload returned 200, the
PDF parsed, and it was invisible — for every upload, on every environment,
since the fork.

Same shape as `test_class_tutor_reaches_the_student.py`: the only test that
witnesses this bug is one that drives BOTH routes against ONE store, sending
exactly what the frontend sends. Patching either route's helper in isolation
passes in lockstep with the bug.
"""

from __future__ import annotations

from io import BytesIO
from typing import Any
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user

# A group-owned student identity (ADR-001): synthetic uid, no email/domain.
_STUDENT = User(uid="anon-busygarden11", email="", domain="", group_id="busy-garden-11")
_ACTIVITY = "act-84ba348b7d561024"


class _InMemoryParsedDocuments:
    """Just enough of db.firestore for the two routes: set/query on ONE dict."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}

    def set_document(self, collection: str, doc_id: str, data: dict[str, Any], merge: bool = False) -> None:
        assert collection == "parsed_documents"
        self.rows[doc_id] = {**self.rows.get(doc_id, {}), **data} if merge else dict(data)

    def query_documents(self, collection: str, filters=None, order_by=None, order_direction="DESCENDING", limit=None):
        assert collection == "parsed_documents"
        out = []
        for doc_id, row in self.rows.items():
            if all(op == "==" and row.get(field) == value for field, op, value in (filters or [])):
                out.append({**row, "__id": doc_id})
        return out[:limit] if limit else out


@pytest.fixture()
def store() -> _InMemoryParsedDocuments:
    return _InMemoryParsedDocuments()


@pytest.fixture()
def client(store: _InMemoryParsedDocuments) -> TestClient:
    from tools.documents.routes import router as list_router
    from tools.documents.upload import router as upload_router

    app = FastAPI()
    app.include_router(upload_router)
    app.include_router(list_router)
    app.dependency_overrides[get_current_user] = lambda: _STUDENT
    with (
        # One store behind BOTH routes — the join is the thing under test.
        patch("tools.documents.upload.set_document", side_effect=store.set_document),
        patch("tools.documents.upload.query_documents", side_effect=store.query_documents),
        patch("tools.documents.context.query_documents", side_effect=store.query_documents),
        # Everything off the Firestore path is stubbed: bucket, GCS, parser, folders.
        patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
        patch("tools.documents.upload._upload_to_gcs"),
        patch(
            "tools.documents.upload._run_parse",
            return_value=("parsed", [{"type": "paragraph", "text": "hi"}], 10, None),
        ),
        patch("db.folders.ensure_default_folder", return_value="folder1"),
    ):
        yield TestClient(app)


def _upload_as_the_workbench_does(client: TestClient, name: str = "Doc4_compressed.pdf") -> str:
    # Mirror documentApi.uploadDocument(): the file plus `skill_id` as FORM
    # fields, nothing on the query string. If that contract changes, change it
    # here AND in frontend/src/lib/__tests__/documentApi.test.ts.
    resp = client.post(
        "/api/documents/upload",
        files={"file": (name, BytesIO(b"%PDF-1.4 fake"), "application/pdf")},
        data={"skill_id": _ACTIVITY},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["docId"]


def test_uploaded_file_is_listed_for_its_activity(client: TestClient, store: _InMemoryParsedDocuments) -> None:
    doc_id = _upload_as_the_workbench_does(client)

    # The record carries the activity (the half the query-param bug dropped)…
    assert store.rows[doc_id]["skillId"] == _ACTIVITY
    assert store.rows[doc_id]["groupId"] == "busy-garden-11"

    # …and the workbench's very next call finds it.
    listed = client.get("/api/documents", params={"skillId": _ACTIVITY}).json()["documents"]
    assert [d["docId"] for d in listed] == [doc_id]
    assert listed[0]["name"] == "Doc4_compressed.pdf"


def test_another_activity_does_not_see_it(client: TestClient) -> None:
    # The scoping the skillId exists for: one activity's workbench never shows
    # another's files. (Also guards against "fixing" the bug by dropping the filter.)
    _upload_as_the_workbench_does(client)
    other = client.get("/api/documents", params={"skillId": "act-other"}).json()["documents"]
    assert other == []


def test_uploaded_image_is_listed_like_any_other_file(client: TestClient, store: _InMemoryParsedDocuments) -> None:
    # 1.1.122 — the student does not choose a route by file type. A photo goes
    # through the same button, the same route, and lands in the same tabs.
    resp = client.post(
        "/api/documents/upload",
        files={"file": ("ligning.png", BytesIO(b"\x89PNG fake"), "image/png")},
        data={"skill_id": _ACTIVITY},
    )
    assert resp.status_code == 200, resp.text
    doc_id = resp.json()["docId"]
    assert store.rows[doc_id]["mediaKind"] == "image"
    assert store.rows[doc_id]["parseStatus"] == "parsed"

    listed = client.get("/api/documents", params={"skillId": _ACTIVITY}).json()["documents"]
    assert [d["docId"] for d in listed] == [doc_id]
    assert listed[0]["sourceFormat"] == "png"


def test_uploaded_plain_text_is_listed_without_any_parser(client: TestClient, store: _InMemoryParsedDocuments) -> None:
    # 2026-09-17 — a .txt used to land as `pending_ai_extraction` and, since
    # nothing resolved that status and the list filters status == "parsed",
    # it never appeared. Now it is paragraphs the moment it is stored. Note
    # `_run_parse` is stubbed to return "parsed" in this client, so this only
    # witnesses the bug if the .txt genuinely bypasses it — assert the blocks.
    resp = client.post(
        "/api/documents/upload",
        files={"file": ("noter.txt", BytesIO(b"first\n\nsecond"), "text/plain")},
        data={"skill_id": _ACTIVITY},
    )
    assert resp.status_code == 200, resp.text
    doc_id = resp.json()["docId"]
    assert store.rows[doc_id]["parseStatus"] == "parsed"
    assert store.rows[doc_id]["blocks"] == [
        {"type": "paragraph", "text": "first"},
        {"type": "paragraph", "text": "second"},
    ]

    listed = client.get("/api/documents", params={"skillId": _ACTIVITY}).json()["documents"]
    assert [d["docId"] for d in listed] == [doc_id]
    assert listed[0]["sourceFormat"] == "txt"
