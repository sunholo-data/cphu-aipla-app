"""Curriculum-library routes (1.1.25).

  GET /api/curriculum?level=B&topic=mechanics&scope=shared|mine — browse (M1)
  POST /api/curriculum/ingest — ingest a file into the library + RAG corpus (M2)
  POST /api/curriculum/query — test retrieval over the teacher's corpus (M5, ops/eval)

Deny-by-default: all endpoints are TEACHER-ONLY. Anonymous-group students never
see the open corpus — they only receive an activity's cited materials via the
tutor (M3 retrieval tool).

M2 ingestion flow:
  UploadFile → AILANG Parse (deterministic) | plain-text read → text
            → RAG corpus upload (if CURRICULUM_RAG_CORPUS_NAME set)
            → CurriculumDoc metadata → Firestore
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from adk.teacher_focus import resolve_active_config
from auth import User, get_current_user
from db.curriculum import (
    create_curriculum_doc,
    get_curriculum_content,
    get_curriculum_doc,
    list_curriculum_for_teacher,
    set_curriculum_content,
)
from db.models.curriculum import SHARED_SCOPE, CopyrightStatus, CurriculumDoc, StxLevel
from db.rag_corpus import query_rag_files, upload_text_as_rag_file
from tools.documents.ailang_parse import DETERMINISTIC_EXTENSIONS, _parse_file_sync

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])

# Plain-text extensions we can read directly (no AILANG Parse needed).
_PLAINTEXT_EXTENSIONS = {".txt", ".md"}

# 1.1.33 — PDFs go through Gemini multimodal (OCR-capable: handles scanned
# PDFs too). AILANG Parse's deterministic path doesn't do PDF; Gemini-for-now.
_PDF_EXTENSIONS = {".pdf"}

# All extensions accepted by this endpoint.
_ALLOWED_EXTENSIONS = _PLAINTEXT_EXTENSIONS | _PDF_EXTENSIONS | DETERMINISTIC_EXTENSIONS

# 1.1.33 M4 — cap the parse preview returned to the teacher (full char count is
# reported separately). Generous: most uploads are worksheets, not books.
_PARSE_PREVIEW_CAP = 20000

# Vertex Gemini model for PDF text extraction (override via env).
_PDF_PARSE_MODEL = os.environ.get("PDF_PARSE_MODEL", "gemini-2.5-flash")


async def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract a PDF's text as Markdown via Gemini (Vertex). OCR-capable, so
    scanned PDFs work too. Raises 422 on failure / empty output."""
    from google import genai
    from google.genai import types as genai_types

    prompt = (
        "Extract ALL text from this document as clean Markdown. Preserve headings, "
        "lists, and tables in reading order. Do NOT summarise, translate, comment, "
        "or add anything — output only the document's own content."
    )
    try:
        client = genai.Client(vertexai=True)
        response = await client.aio.models.generate_content(
            model=_PDF_PARSE_MODEL,
            contents=[
                prompt,
                genai_types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            ],
        )
    except Exception as exc:
        logger.warning("PDF extraction via Gemini failed: %s", exc)
        raise HTTPException(status_code=422, detail="Couldn't read this PDF. Try another file.") from exc
    text = (response.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="No text could be extracted from this PDF.")
    return text


# ---------------------------------------------------------------------------
# M1 — browse
# ---------------------------------------------------------------------------


@router.get("")
async def browse_curriculum(
    level: StxLevel | None = None,
    topic: str | None = None,
    scope: Literal["shared", "mine"] | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Browse the curriculum library, ACL-scoped to the teacher (shared + own).
    FastAPI validates ``level``/``scope`` against their Literals → 422 on bad input."""
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum browse is teacher-only.")
    docs = list_curriculum_for_teacher(user.uid, level=level, topic=topic, scope=scope)
    return {"docs": [d.model_dump(by_alias=True, mode="json") for d in docs]}


# ---------------------------------------------------------------------------
# M2 — ingest
# ---------------------------------------------------------------------------


async def _extract_text(tmp_path: str, filename: str) -> str:
    """Extract plain text from a local file using AILANG Parse or direct read."""
    ext = PurePosixPath(filename).suffix.lower()
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=(f"Unsupported format for curriculum ingestion: {ext!r}. Supported: {sorted(_ALLOWED_EXTENSIONS)}."),
        )

    if ext in _PLAINTEXT_EXTENSIONS:
        content = await asyncio.to_thread(lambda: open(tmp_path, encoding="utf-8", errors="replace").read())
        if not content.strip():
            raise HTTPException(status_code=422, detail="File is empty.")
        return content

    if ext in _PDF_EXTENSIONS:
        pdf_bytes = await asyncio.to_thread(lambda: open(tmp_path, "rb").read())
        return await _extract_pdf_text(pdf_bytes)

    # AILANG Parse path (docx, pptx, xlsx, odt, …)
    outcome = await asyncio.to_thread(_parse_file_sync, tmp_path, "markdown")
    if not outcome.ok:
        raise HTTPException(
            status_code=422,
            detail=f"AILANG Parse failed ({outcome.error_code}): {outcome.error}",
        )
    if not outcome.markdown:
        raise HTTPException(status_code=422, detail="AILANG Parse returned empty content.")
    return outcome.markdown


@router.post("/ingest", status_code=201)
async def ingest_curriculum(
    file: UploadFile,
    title: Annotated[str, Form(min_length=1, max_length=300)],
    origin: Annotated[str, Form(min_length=1, max_length=200)],
    # 1.1.33: optional — uploads are level-less unless the teacher assigns one.
    level: Annotated[StxLevel | None, Form()] = None,
    topic: Annotated[str | None, Form(max_length=120)] = None,
    shared: Annotated[bool, Form()] = False,
    copyright_status: Annotated[CopyrightStatus, Form()] = "teacher_owned",
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Ingest a curriculum document into the library and ADK RAG corpus.

    Teacher uploads are always ``copyright_status=teacher_owned`` (un-gated).
    Shared corpus ingestion requires ``copyright_status=cleared`` — the endpoint
    refuses ``pending`` to prevent accidental clearance-bypass.
    """
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum ingest is teacher-only.")

    if shared and copyright_status != "cleared":
        raise HTTPException(
            status_code=422,
            detail="Shared corpus ingestion requires copyright_status=cleared.",
        )

    filename = file.filename or "upload"
    doc_id = str(uuid.uuid4())
    owner_scope = SHARED_SCOPE if shared else user.uid

    tmp_dir = tempfile.mkdtemp(prefix="curriculum_ingest_")
    tmp_path = os.path.join(tmp_dir, filename.replace("/", "_").replace("\\", "_"))
    try:
        # Stream upload to temp file.
        chunk_bytes = await file.read()
        await asyncio.to_thread(lambda: open(tmp_path, "wb").write(chunk_bytes))

        text = await _extract_text(tmp_path, filename)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # RAG upload (graceful: returns None when corpus not configured).
    rag_file_name = await upload_text_as_rag_file(
        text,
        doc_id,
        title=title,
        level=level,
        topic=topic,
        owner_scope=owner_scope,
    )

    now = datetime.now(UTC)
    doc = CurriculumDoc(
        docId=doc_id,
        title=title,
        level=level,
        topic=topic,
        source="shared" if shared else "teacher_upload",
        ownerScope=owner_scope,
        origin=origin,
        docArtifactId=rag_file_name or "",
        copyrightStatus=copyright_status,
        createdAt=now,
        updatedAt=now,
    )
    create_curriculum_doc(doc)
    # 1.1.33 M3 — persist the parsed text so a teacher/student can READ a shared
    # doc later (not just see its name). Kept in a separate collection.
    set_curriculum_content(doc_id, text)

    logger.info(
        "Curriculum doc ingested: %s level=%s shared=%s rag=%s",
        doc_id,
        level,
        shared,
        bool(rag_file_name),
    )
    # 1.1.33 M4 — return what AILANG Parse extracted so the teacher can VERIFY
    # the parse before it grounds the tutor (the text is already computed above
    # and uploaded to RAG; we were discarding the copy). Preview capped; the full
    # length is reported so the teacher knows if it was truncated for display.
    return {
        "doc": doc.model_dump(by_alias=True, mode="json"),
        "parsedPreview": text[:_PARSE_PREVIEW_CAP],
        "parsedChars": len(text),
    }


# ---------------------------------------------------------------------------
# M3 — read a doc's parsed content (display, not retrieval)
# ---------------------------------------------------------------------------


@router.get("/{doc_id}/content")
async def get_curriculum_doc_content(
    doc_id: str,
    activity_id: str | None = Query(default=None, alias="activityId"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Return the parsed text of a curriculum doc for display (1.1.33 M3).

    Deny-by-default ACL:
    - **Student** (anonymous group): allowed only when the doc is cited by their
      active activity AND ``student_visible`` is true. Requires ``activityId``.
      The teacher's visibility toggle gates the CONTENT here (the name shows
      regardless, via the active-config materials list).
    - **Teacher** (Firebase): allowed for their own docs or the shared corpus.

    Returns ``available=false`` (not 404) when no content was stored — e.g. a doc
    ingested before M3; re-upload to make it viewable.
    """
    doc = get_curriculum_doc(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    if getattr(user, "group_id", None):
        cfg = resolve_active_config(activity_id, group_tags=user.group_tags) if activity_id else None
        allowed = bool(cfg is not None and any(m.doc_id == doc_id and m.student_visible for m in cfg.materials))
    else:
        allowed = doc.owner_scope in (user.uid, SHARED_SCOPE)

    if not allowed:
        # 403 (not 404): doc ids are random UUIDs, no existence leak.
        raise HTTPException(status_code=403, detail="Access denied.")

    content = get_curriculum_content(doc_id)
    if content is None:
        return {"docId": doc_id, "title": doc.title, "available": False, "text": "", "chars": 0}
    return {
        "docId": doc_id,
        "title": doc.title,
        "available": True,
        "text": content.get("text", ""),
        "chars": int(content.get("chars", 0)),
    }


# ---------------------------------------------------------------------------
# M5 — query (ops / eval parity)
# ---------------------------------------------------------------------------


def _rag_file_id(resource_name: str) -> str:
    """Short RAG file id from a full resource name (mirrors adk.curriculum_retrieval)."""
    return resource_name.rstrip("/").rsplit("/", 1)[-1] if "/" in resource_name else resource_name


class CurriculumQuery(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    level: StxLevel | None = None
    topic: str | None = Field(default=None, max_length=120)
    scope: Literal["shared", "mine"] | None = None
    top_k: int = Field(default=5, ge=1, le=20, alias="topK")


@router.post("/query")
async def query_curriculum(
    body: CurriculumQuery,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Test retrieval over the teacher's accessible corpus (ops/eval parity).

    Teacher-only. Scoped to the docs the teacher can browse (shared + own,
    filtered by level/topic/scope) — never the open corpus from a student.
    Returns the matching chunks plus the in-scope docs for provenance. Degrades
    gracefully to an empty result + a note when no corpus / no ingested docs.
    """
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum query is teacher-only.")

    docs = list_curriculum_for_teacher(user.uid, level=body.level, topic=body.topic, scope=body.scope)
    ingested = [d for d in docs if d.doc_artifact_id]
    file_ids = [_rag_file_id(d.doc_artifact_id) for d in ingested]

    chunks = await query_rag_files(file_ids, body.query, top_k=body.top_k)

    note = None
    if not file_ids:
        note = "No ingested curriculum docs in scope — nothing to retrieve from."
    elif not chunks:
        note = "No matching content found (or RAG corpus not configured)."

    return {
        "query": body.query,
        "chunks": chunks,
        "scopedDocs": [{"docId": d.doc_id, "origin": d.origin, "level": d.level, "topic": d.topic} for d in ingested],
        "note": note,
    }
