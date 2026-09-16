"""Tests for POST /api/documents/upload — bucket migration + folderId + parseStatus."""

from __future__ import annotations

from io import BytesIO
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import User, get_current_user

_USER = User(uid="user1", email="alice@example.com", domain="example.com")


@pytest.fixture()
def client() -> TestClient:
    from tools.documents.upload import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: _USER
    return TestClient(app)


def _file(name: str = "test.docx") -> dict:
    return {"file": (name, BytesIO(b"fake content"), "application/octet-stream")}


class TestUploadBucketResolution:
    def test_uses_per_client_bucket_not_logs_bucket(self, client: TestClient):
        captured = {}

        def fake_gcs_upload(bucket_name, path, data, content_type, uid, filename):
            captured["bucket"] = bucket_name

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="example-documents"),
            patch("tools.documents.upload._upload_to_gcs", side_effect=fake_gcs_upload),
            patch("tools.documents.upload._run_parse", return_value=("parsed", [], 10, None)),
            patch("tools.documents.upload._store_document"),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            resp = client.post("/api/documents/upload", files=_file())

        assert resp.status_code == 200
        assert captured.get("bucket") == "example-documents"

    def test_gcs_path_uses_uid_docs_folder_pattern(self, client: TestClient):
        captured = {}

        def fake_gcs_upload(bucket_name, path, data, content_type, uid, filename):
            captured["path"] = path

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="example-documents"),
            patch("tools.documents.upload._upload_to_gcs", side_effect=fake_gcs_upload),
            patch("tools.documents.upload._run_parse", return_value=("parsed", [], 10, None)),
            patch("tools.documents.upload._store_document"),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            resp = client.post("/api/documents/upload", files=_file())

        assert resp.status_code == 200
        path = captured.get("path", "")
        assert path.startswith(f"users/{_USER.uid}/docs/")

    def test_parse_status_pending_written_immediately(self, client: TestClient):
        immediate_writes = []

        def fake_store(doc_id, *, parse_result, **kwargs):
            if parse_result.status == "pending":
                immediate_writes.append(doc_id)

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._upload_to_gcs"),
            patch("tools.documents.upload._run_parse", return_value=("parsed", [], 10, None)),
            patch("tools.documents.upload._store_document", side_effect=fake_store),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            client.post("/api/documents/upload", files=_file())

        assert len(immediate_writes) >= 1

    def test_auto_creates_folder_when_none_provided(self, client: TestClient):
        calls = []

        def capture_ensure(uid: str) -> str:
            calls.append(uid)
            return "auto-folder"

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._upload_to_gcs"),
            patch("tools.documents.upload._run_parse", return_value=("parsed", [], 10, None)),
            patch("tools.documents.upload._store_document"),
            patch("db.folders.ensure_default_folder", side_effect=capture_ensure),
        ):
            resp = client.post("/api/documents/upload", files=_file())

        assert resp.status_code == 200
        assert calls == ["user1"]

    def test_unsupported_extension_returns_400(self, client: TestClient):
        with patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"):
            resp = client.post("/api/documents/upload", files=_file("test.exe"))
        assert resp.status_code == 400

    def test_oversized_file_returns_413_before_any_firestore_write(self, client: TestClient):
        # 2026-09-15 prod report: a large PDF hung with zero feedback. Also
        # guards against a phantom "pending" tab — the size gate must run
        # BEFORE _store_document's pending write, not after.
        store_calls = []
        big_file = {
            "file": (
                "big.pdf",
                BytesIO(b"x" * 100),
                "application/pdf",
            )
        }
        with (
            patch("tools.documents.upload._MAX_UPLOAD_BYTES", 50),
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._store_document", side_effect=lambda *a, **k: store_calls.append(1)),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            resp = client.post("/api/documents/upload", files=big_file)

        assert resp.status_code == 413
        assert store_calls == []


class TestFormFieldsReachTheRecord:
    """skill_id / folder_id arrive as multipart FORM fields (that is how every
    caller sends them — documentApi.ts, UploadDropZone.tsx, the CLI). A bare
    `str` parameter is a QUERY param to FastAPI, so the form field was silently
    dropped and every upload was stored with skillId="" — invisible to the
    workbench, which lists by skillId (busy-garden-11, 2026-09-15)."""

    def test_skill_id_form_field_is_stored_on_the_record(self, client: TestClient):
        stored = []

        def fake_store(doc_id, *, skill_id, **kwargs):
            stored.append(skill_id)

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._upload_to_gcs"),
            patch("tools.documents.upload._run_parse", return_value=("parsed", [], 10, None)),
            patch("tools.documents.upload._store_document", side_effect=fake_store),
            patch("tools.documents.upload.query_documents", return_value=[]),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            resp = client.post(
                "/api/documents/upload",
                files=_file("essay.pdf"),
                data={"skill_id": "act-84ba348b7d561024"},  # exactly what documentApi.ts appends
            )

        assert resp.status_code == 200
        assert stored, "the record was never written"
        assert all(s == "act-84ba348b7d561024" for s in stored), stored

    def test_folder_id_form_field_targets_that_folder(self, client: TestClient):
        ensure_calls = []

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._upload_to_gcs"),
            patch("tools.documents.upload._run_parse", return_value=("parsed", [], 10, None)),
            patch("tools.documents.upload._store_document"),
            patch("tools.documents.upload.query_documents", return_value=[]),
            patch("db.folders.ensure_default_folder", side_effect=lambda uid: ensure_calls.append(uid) or "auto"),
        ):
            resp = client.post(
                "/api/documents/upload",
                files=_file("essay.pdf"),
                data={"folder_id": "folder-xyz"},
            )

        assert resp.status_code == 200
        assert resp.json()["folderId"] == "folder-xyz"
        # A caller-supplied folder must not be replaced by the auto-created default.
        assert ensure_calls == []


class TestImagesAreFilesToo:
    """1.1.122 — a photo of the student's work is accepted by the SAME route as
    a PDF, stored as pixels for the tutor, and never sent through the parser
    (OCR of handwriting is the path 1.1.48 rejected)."""

    def _png(self, size: int = 100) -> dict:
        return {"file": ("ligning.png", BytesIO(b"\x89PNG" + b"\x00" * size), "image/png")}

    def test_image_upload_skips_the_parser_and_is_stored_ready(self, client: TestClient):
        stored = []

        def fake_store(doc_id, *, parse_result, media_kind="document", **kwargs):
            stored.append((parse_result.status, media_kind))

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._upload_to_gcs"),
            patch("tools.documents.upload._run_parse") as run_parse,
            patch("tools.documents.upload._store_document", side_effect=fake_store),
            patch("tools.documents.upload.query_documents", return_value=[]),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            resp = client.post("/api/documents/upload", files=self._png(), data={"skill_id": "act-1"})

        assert resp.status_code == 200
        assert resp.json()["status"] == "parsed"  # ready for the tutor as-is
        run_parse.assert_not_called()
        assert stored == [("pending", "image"), ("parsed", "image")]

    def test_image_content_type_is_canonical(self, client: TestClient):
        captured = {}

        with (
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch(
                "tools.documents.upload._upload_to_gcs",
                side_effect=lambda b, p, d, ct, u, f: captured.setdefault("ct", ct),
            ),
            patch("tools.documents.upload._store_document"),
            patch("tools.documents.upload.query_documents", return_value=[]),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            client.post(
                "/api/documents/upload", files={"file": ("foto.HEIC", BytesIO(b"x"), "application/octet-stream")}
            )

        assert captured["ct"] == "image/heic"

    def test_image_over_5mb_is_413_before_any_write(self, client: TestClient):
        store_calls = []
        with (
            patch("tools.documents.upload._MAX_IMAGE_BYTES", 50),
            patch("tools.documents.upload.resolve_documents_bucket", return_value="bucket"),
            patch("tools.documents.upload._store_document", side_effect=lambda *a, **k: store_calls.append(1)),
            patch("db.folders.ensure_default_folder", return_value="folder1"),
        ):
            resp = client.post("/api/documents/upload", files=self._png(100))

        assert resp.status_code == 413
        assert store_calls == []
