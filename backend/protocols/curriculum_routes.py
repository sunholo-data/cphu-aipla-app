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

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from auth import User, get_current_user
from db.curriculum import create_curriculum_doc, list_curriculum_for_teacher
from db.models.curriculum import SHARED_SCOPE, CopyrightStatus, CurriculumDoc, StxLevel
from db.rag_corpus import query_rag_files, upload_text_as_rag_file
from tools.documents.ailang_parse import DETERMINISTIC_EXTENSIONS, _parse_file_sync

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])

# Plain-text extensions we can read directly (no AILANG Parse needed).
_PLAINTEXT_EXTENSIONS = {".txt", ".md"}

# All extensions accepted by this endpoint.
_ALLOWED_EXTENSIONS = _PLAINTEXT_EXTENSIONS | DETERMINISTIC_EXTENSIONS


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
            detail=(
                f"Unsupported format for curriculum ingestion: {ext!r}. "
                f"Supported: {sorted(_ALLOWED_EXTENSIONS)}. "
                "Convert PDF to .docx or .txt before ingesting."
            ),
        )

    if ext in _PLAINTEXT_EXTENSIONS:
        content = await asyncio.to_thread(lambda: open(tmp_path, encoding="utf-8", errors="replace").read())
        if not content.strip():
            raise HTTPException(status_code=422, detail="File is empty.")
        return content

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
    level: Annotated[StxLevel, Form()],
    origin: Annotated[str, Form(min_length=1, max_length=200)],
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

    logger.info(
        "Curriculum doc ingested: %s level=%s shared=%s rag=%s",
        doc_id,
        level,
        shared,
        bool(rag_file_name),
    )
    return {"doc": doc.model_dump(by_alias=True, mode="json")}


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
