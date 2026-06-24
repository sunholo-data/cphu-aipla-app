"""FastAPI routes for user document folders — /api/folders and /api/sessions context.

User-facing document organization layer. Distinct from the storage-ACL
bucket/folder system in backend/buckets/ which manages GCS namespace config.

These folders group user uploads within their per-client GCS bucket, keyed
by the user's email domain (see db/clients.py).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

import db.folders as folders_db
from auth import User, get_current_user
from db.clients import resolve_documents_bucket
from db.firestore import delete_document as _delete_firestore_doc
from db.firestore import get_document as _get_firestore_doc
from db.firestore import set_document as _set_firestore_doc

log = logging.getLogger(__name__)

router = APIRouter(tags=["doc-folders"])

_CurrentUser = Annotated[User, Depends(get_current_user)]
_ACCESS_DENIED = "Access denied"


class _CreateFolderRequest(BaseModel):
    name: str


class _FolderResponse(BaseModel):
    id: str
    name: str
    userId: str
    docCount: int = 0
    parsedCount: int = 0


class _FoldersListResponse(BaseModel):
    folders: list[_FolderResponse]


class _DocumentsListResponse(BaseModel):
    documents: list[dict]


@router.post("/api/folders", status_code=201)
def create_folder(body: _CreateFolderRequest, user: _CurrentUser) -> _FolderResponse:
    result = folders_db.create_folder(user_id=user.uid, name=body.name)
    return _FolderResponse(**result)


@router.get("/api/folders")
def list_folders(user: _CurrentUser) -> _FoldersListResponse:
    items = folders_db.list_folders(user_id=user.uid)
    return _FoldersListResponse(folders=[_FolderResponse(**f) for f in items])


@router.get("/api/folders/{folder_id}/documents")
def list_folder_documents(folder_id: str, user: _CurrentUser) -> _DocumentsListResponse:
    folder = folders_db.get_folder(user_id=user.uid, folder_id=folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    if folder.get("userId") != user.uid:
        raise HTTPException(status_code=403, detail=_ACCESS_DENIED)
    docs = folders_db.list_folder_documents(user_id=user.uid, folder_id=folder_id)
    return _DocumentsListResponse(documents=docs)


_PARSED_DOCS_COLLECTION = "parsed_documents"


@router.get("/api/documents/{doc_id}")
def get_document(doc_id: str, user: _CurrentUser) -> dict:
    """Fetch a single parsed document by ID.

    Returns the full document record including blocks for frontend rendering.
    """
    doc = _get_firestore_doc(_PARSED_DOCS_COLLECTION, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("userId") != user.uid:
        raise HTTPException(status_code=403, detail=_ACCESS_DENIED)
    doc.setdefault("id", doc_id)
    return doc


_MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _doc_mime(doc: dict) -> str:
    """Best-effort content type for the original bytes (1.1.45 M2)."""
    name = str(doc.get("originalName") or doc.get("filename") or doc.get("name") or "").lower()
    for ext, mime in _MIME_BY_EXT.items():
        if name.endswith(ext):
            return mime
    return str(doc.get("mimeType") or doc.get("contentType") or "application/octet-stream")


async def _read_doc_bytes(doc: dict) -> bytes:
    """Read a document's original bytes from its stored ``gs://`` URL.

    Reading from the stored URL (not a re-derived bucket) keeps this correct for
    anonymous-group uploads, whose owner has no email domain to resolve a bucket
    from (the CLAUDE.md anon-group corner). Raises on a missing/unreadable object.
    """
    import asyncio

    source_url = str(doc.get("sourceUrl") or "")
    if not source_url.startswith("gs://"):
        raise FileNotFoundError("no gs:// source")
    bucket_name, _, blob_path = source_url[len("gs://") :].partition("/")
    if not bucket_name or not blob_path:
        raise FileNotFoundError("malformed gs:// source")

    from google.cloud import storage as gcs

    blob = gcs.Client().bucket(bucket_name).blob(blob_path)
    return await asyncio.to_thread(blob.download_as_bytes)


@router.get("/api/documents/{doc_id}/raw")
async def get_document_raw(doc_id: str, user: _CurrentUser) -> Response:
    """Stream a document's ORIGINAL bytes (e.g. the real PDF) for the workbench
    viewer (1.1.45 M2). Owner-only: the uploader — a student viewing their own
    upload, or a teacher viewing their own. (A teacher-shared doc the student may
    view is the dual-audience activity-material case — handled by the rich render
    today; original-bytes sharing is a follow-up.) 404 when no original bytes are
    stored, so the viewer falls back to the rich render."""
    doc = _get_firestore_doc(_PARSED_DOCS_COLLECTION, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("userId") != user.uid:
        raise HTTPException(status_code=403, detail=_ACCESS_DENIED)
    if not str(doc.get("sourceUrl") or "").startswith("gs://"):
        raise HTTPException(status_code=404, detail="No original file stored for this document")
    try:
        data = await _read_doc_bytes(doc)
    except Exception as exc:
        log.warning("raw bytes read failed for doc %s: %s", doc_id, exc)
        raise HTTPException(status_code=404, detail="Original file unavailable") from exc
    if not data:
        raise HTTPException(status_code=404, detail="Original file is empty")
    return Response(
        content=data,
        media_type=_doc_mime(doc),
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/api/documents/{doc_id}/reparse")
async def reparse_document(doc_id: str, user: _CurrentUser) -> dict:
    """Re-run AILANG Parse on an existing document using its stored GCS URL.

    Use this to populate blocks for documents uploaded before the AI pipeline
    was wired, or to retry a failed parse after a transient AILANG error.
    Returns the updated parseStatus and blockCount.
    """
    from tools.documents.upload import _run_parse

    doc = _get_firestore_doc(_PARSED_DOCS_COLLECTION, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("userId") != user.uid:
        raise HTTPException(status_code=403, detail=_ACCESS_DENIED)

    gs_url: str | None = doc.get("sourceUrl")
    if not gs_url:
        raise HTTPException(status_code=422, detail="Document has no GCS source URL — cannot reparse")

    log.info("Reparsing doc %s from %s", doc_id, gs_url)
    status, blocks, elapsed_ms, error = await _run_parse(gs_url)

    now = datetime.now(UTC)
    update: dict = {
        "parseStatus": status,
        "status": status,
        "blocks": blocks if status == "parsed" else [],
        "blockCount": len(blocks) if status == "parsed" else None,
        "tableCount": sum(1 for b in blocks if isinstance(b, dict) and b.get("type") == "table") if blocks else None,
        "imageCount": sum(1 for b in blocks if isinstance(b, dict) and b.get("type") == "image") if blocks else None,
        "changeCount": sum(1 for b in blocks if isinstance(b, dict) and b.get("type") == "change") if blocks else None,
        "parsedMs": elapsed_ms if status == "parsed" else None,
        "parseError": error if status == "failed" else None,
        "parsedAt": now.isoformat() if status == "parsed" else None,
        "updatedAt": now.isoformat(),
    }
    _set_firestore_doc(_PARSED_DOCS_COLLECTION, doc_id, update, merge=True)
    log.info("Reparse complete for doc %s: status=%s blocks=%d", doc_id, status, len(blocks))
    return {"docId": doc_id, "parseStatus": status, "blockCount": len(blocks), "parseError": error}


@router.delete("/api/documents/{doc_id}", status_code=204)
async def delete_document(doc_id: str, user: _CurrentUser) -> None:
    """Delete a document: removes the Firestore record and the GCS file."""
    doc = _get_firestore_doc(_PARSED_DOCS_COLLECTION, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("userId") != user.uid:
        raise HTTPException(status_code=403, detail=_ACCESS_DENIED)

    # Delete GCS file — best-effort, don't fail the whole request if it's missing
    storage_path: str | None = doc.get("storagePath")
    if storage_path:
        try:
            from google.cloud import storage as gcs

            bucket_name = resolve_documents_bucket(user)
            gcs.Client().bucket(bucket_name).blob(storage_path).delete()
            log.info("Deleted GCS object gs://%s/%s", bucket_name, storage_path)
        except Exception as exc:
            log.warning("GCS delete failed for %s (continuing): %s", storage_path, exc)

    _delete_firestore_doc(_PARSED_DOCS_COLLECTION, doc_id)
    log.info("Deleted document %s", doc_id)
