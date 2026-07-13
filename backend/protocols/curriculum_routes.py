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
from pydantic import BaseModel, ConfigDict, Field

from adk.teacher_focus import resolve_active_config
from auth import User, get_current_user
from db.curriculum import (
    create_curriculum_doc,
    create_curriculum_folder,
    delete_curriculum_content,
    delete_curriculum_doc,
    distinct_subjects_for_teacher,
    distinct_tags_for_teacher,
    get_curriculum_content,
    get_curriculum_doc,
    get_curriculum_folder,
    list_curriculum_folders_for_teacher,
    list_curriculum_for_teacher,
    set_curriculum_content,
)
from db.models.curriculum import (
    SHARED_SCOPE,
    CopyrightStatus,
    CurriculumDoc,
    CurriculumFolder,
    StxLevel,
    normalize_subject,
    normalize_tags,
)
from db.rag_corpus import delete_rag_file, query_rag_files, upload_text_as_rag_file
from tools.documents.ai_extract import extract_pdf_text, summarise_curriculum_text
from tools.documents.ailang_parse import DETERMINISTIC_EXTENSIONS, _parse_file_sync

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"])

# Plain-text extensions we can read directly (no AILANG Parse needed).
_PLAINTEXT_EXTENSIONS = {".txt", ".md"}

# 1.1.33 — PDFs go through Gemini multimodal (OCR-capable: handles scanned
# PDFs too). AILANG Parse's deterministic path doesn't do PDF, so we use the
# shared AI fallback in tools.documents.ai_extract (one implementation, reused).
_PDF_EXTENSIONS = {".pdf"}

# All extensions accepted by this endpoint.
_ALLOWED_EXTENSIONS = _PLAINTEXT_EXTENSIONS | _PDF_EXTENSIONS | DETERMINISTIC_EXTENSIONS

# 1.1.33 M4 — cap the parse preview returned to the teacher (full char count is
# reported separately). Generous: most uploads are worksheets, not books.
_PARSE_PREVIEW_CAP = 20000


async def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract a PDF's text via the shared Gemini fallback, mapping its domain
    error to a 422 (the HTTP concern stays here, not in the shared helper)."""
    try:
        return await extract_pdf_text(pdf_bytes)
    except ValueError as exc:
        logger.warning("PDF extraction failed: %s", exc)
        raise HTTPException(status_code=422, detail="Couldn't read this PDF. Try another file.") from exc


# ---------------------------------------------------------------------------
# M1 — browse
# ---------------------------------------------------------------------------


@router.get("")
async def browse_curriculum(
    level: StxLevel | None = None,
    topic: str | None = None,
    tags: Annotated[list[str] | None, Query()] = None,  # 1.1.58 M1 — repeatable ?tags=
    subject: str | None = None,  # 1.1.58 M2 — exact-match facet
    folder: str | None = None,  # 1.1.58 M3 — folder_id exact-match facet
    scope: Literal["shared", "mine"] | None = None,
    # 1.1.59 — paginate the response so a large corpus never dumps unbounded rows
    # over the wire / into React. The full filtered list is computed server-side
    # (cheap: shared is cached), then sliced. `total` lets the FE show "X of Y".
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Browse the curriculum library, ACL-scoped to the teacher (shared + own).
    FastAPI validates ``level``/``scope`` against their Literals → 422 on bad input.
    ``tags`` (repeatable) is an AND facet; ``topic`` is a free-text search.
    Paginated via ``limit`` (≤200) / ``offset``; ``total`` is the full match count."""
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum browse is teacher-only.")
    docs = list_curriculum_for_teacher(
        user.uid, level=level, topic=topic, tags=tags, subject=subject, folder_id=folder, scope=scope
    )
    page = docs[offset : offset + limit]
    return {
        "docs": [d.model_dump(by_alias=True, mode="json") for d in page],
        "total": len(docs),
        "limit": limit,
        "offset": offset,
    }


@router.get("/facets")
async def curriculum_facets(
    scope: Literal["shared", "mine"] | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Distinct facet vocabularies (tags + subjects) across the docs this teacher
    can see — populates the facet chips (1.1.58 M1/M2). Computed from the same
    ACL-scoped set as browse, so it can never surface a value the teacher isn't
    allowed to see."""
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum facets are teacher-only.")
    return {
        "tags": distinct_tags_for_teacher(user.uid, scope=scope),
        "subjects": distinct_subjects_for_teacher(user.uid, scope=scope),
    }


@router.get("/folders")
async def list_curriculum_folders(
    scope: Literal["shared", "mine"] | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """List the folders a teacher can see (shared + own), each with a live
    ``docCount`` (1.1.58 M3). Teacher-only; ACL-scoped like the docs."""
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum folders are teacher-only.")
    folders = list_curriculum_folders_for_teacher(user.uid, scope=scope)
    return {"folders": [f.model_dump(by_alias=True, mode="json") for f in folders]}


class _FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # Create in the SHARED corpus (any teacher may — mirrors shared ingest). Else
    # the folder is private to the caller.
    shared: bool = False

    model_config = ConfigDict(populate_by_name=True)


@router.post("/folders", status_code=201)
async def create_curriculum_folder_route(
    body: _FolderCreate,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Create a flat folder (1.1.58 M3). Owner scope = SHARED (if ``shared``) or
    the caller's uid. Teacher-only."""
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum folders are teacher-only.")
    folder = CurriculumFolder(
        folderId=str(uuid.uuid4()),
        name=body.name.strip(),
        ownerScope=SHARED_SCOPE if body.shared else user.uid,
        createdAt=datetime.now(UTC),
    )
    create_curriculum_folder(folder)
    logger.info("Curriculum folder created: %s (owner_scope=%s)", folder.folder_id, folder.owner_scope)
    return {"folder": folder.model_dump(by_alias=True, mode="json")}


class _DocPatch(BaseModel):
    """Edit a doc's facets (1.1.58 M2). Tags: full replacement (``tags``) OR deltas
    (``addTags`` / ``removeTags``) — deltas let a CLI avoid a read-modify-write
    race. ``subject`` is a full set; sending it (even as null) updates it, so we
    detect presence via ``model_fields_set`` to distinguish "clear" from "absent"."""

    tags: list[str] | None = None
    add_tags: list[str] | None = Field(default=None, alias="addTags")
    remove_tags: list[str] | None = Field(default=None, alias="removeTags")
    subject: str | None = None
    # 1.1.58 M3 — assign/clear folder. Sending it (even null) updates it; presence
    # detected via model_fields_set. A non-null id must be a folder in the SAME
    # ownerScope as the doc.
    folder_id: str | None = Field(default=None, alias="folderId")

    model_config = ConfigDict(populate_by_name=True)


@router.patch("/{doc_id}")
async def patch_curriculum_doc(
    doc_id: str,
    body: _DocPatch,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Set a curriculum doc's tags and/or subject (1.1.58 M1/M2). Teacher-only.

    ACL mirrors delete/summarize: a teacher may edit their OWN uploads or any
    **shared**-corpus doc (the shared library is teacher-curated). Missing +
    not-yours both return 404 (no existence leak, ids are random UUIDs).
    """
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum edit is teacher-only.")

    doc = get_curriculum_doc(doc_id)
    if doc is None or doc.owner_scope not in (SHARED_SCOPE, user.uid):
        raise HTTPException(status_code=404, detail="Curriculum doc not found.")

    set_subject = "subject" in body.model_fields_set
    set_folder = "folderId" in body.model_fields_set or "folder_id" in body.model_fields_set
    touches_tags = body.tags is not None or body.add_tags is not None or body.remove_tags is not None
    if not touches_tags and not set_subject and not set_folder:
        raise HTTPException(status_code=422, detail="Provide tags, addTags, removeTags, subject, or folderId.")

    if body.tags is not None:
        doc.tags = normalize_tags(body.tags)
    elif body.add_tags is not None or body.remove_tags is not None:
        remove = set(normalize_tags(body.remove_tags))
        merged = normalize_tags([*doc.tags, *(body.add_tags or [])])
        doc.tags = [t for t in merged if t not in remove]

    if set_subject:
        doc.subject = normalize_subject(body.subject)

    if set_folder:
        if body.folder_id:
            folder = get_curriculum_folder(body.folder_id)
            if folder is None:
                raise HTTPException(status_code=404, detail="Folder not found.")
            # ACL parity: a doc can only go in a folder of the SAME ownerScope.
            if folder.owner_scope != doc.owner_scope:
                raise HTTPException(status_code=400, detail="Folder and document are in different scopes.")
            doc.folder_id = folder.folder_id
            doc.folder_name = folder.name
        else:
            doc.folder_id = None  # unfiled
            doc.folder_name = None

    doc.updated_at = datetime.now(UTC)
    create_curriculum_doc(doc)
    logger.info(
        "Curriculum doc %s patched (tags=%s subject=%s folder=%s uid=%s)",
        doc_id,
        doc.tags,
        doc.subject,
        doc.folder_id,
        user.uid,
    )
    return {"doc": doc.model_dump(by_alias=True, mode="json")}


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
    # 1.1.58 M1 — optional comma-separated tags, normalised on ingest.
    tags: Annotated[str | None, Form()] = None,
    # 1.1.58 M2 — optional coarse subject facet.
    subject: Annotated[str | None, Form(max_length=60)] = None,
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

    # 1.1.52 — a catalogue summary the co-pilot + Materials browse read to judge
    # relevance without opening the doc. Best-effort ("" on failure — never blocks
    # ingest; the `summarize` backfill can fill it in later).
    summary = await summarise_curriculum_text(text)

    now = datetime.now(UTC)
    doc = CurriculumDoc(
        docId=doc_id,
        title=title,
        level=level,
        topic=topic,
        summary=summary,
        tags=normalize_tags(tags.split(",")) if tags else [],
        subject=normalize_subject(subject),
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
# 1.1.52 — (re)generate catalogue summaries (backfill for docs ingested before
# the summary field, or a forced refresh)
# ---------------------------------------------------------------------------


class _SummarizeRequest(BaseModel):
    doc_id: str | None = Field(default=None, alias="docId")
    all: bool = False
    force: bool = False

    model_config = ConfigDict(populate_by_name=True)


@router.post("/summarize")
async def summarize_curriculum(
    body: _SummarizeRequest,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """(Re)generate the 1-2 sentence catalogue summary for curriculum docs (1.1.52).

    Teacher-only. Target one doc (``docId``) or all your accessible docs
    (``all=true`` — shared + your own). Skips docs that already have a summary
    unless ``force=true``, and docs with no stored parsed content (nothing to
    summarise). Returns the doc ids updated + skipped.
    """
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum summarize is teacher-only.")

    if body.doc_id:
        doc = get_curriculum_doc(body.doc_id)
        # ACL mirrors delete: your own uploads or any shared-corpus doc. Missing +
        # not-yours return the same 404 (no existence leak).
        if doc is None or (doc.owner_scope != SHARED_SCOPE and doc.owner_scope != user.uid):
            raise HTTPException(status_code=404, detail="Curriculum doc not found.")
        targets = [doc]
    elif body.all:
        targets = list_curriculum_for_teacher(user.uid)
    else:
        raise HTTPException(status_code=422, detail="Provide docId or all=true.")

    updated: list[str] = []
    skipped: list[str] = []
    for doc in targets:
        if doc.summary and not body.force:
            skipped.append(doc.doc_id)
            continue
        content = get_curriculum_content(doc.doc_id)
        text = (content or {}).get("text") or ""
        summary = await summarise_curriculum_text(text) if text else ""
        if not summary:
            skipped.append(doc.doc_id)
            continue
        doc.summary = summary
        doc.updated_at = datetime.now(UTC)
        create_curriculum_doc(doc)
        updated.append(doc.doc_id)

    logger.info("Curriculum summarize: %d updated, %d skipped (uid=%s)", len(updated), len(skipped), user.uid)
    return {"updated": updated, "skipped": skipped}


# ---------------------------------------------------------------------------
# M6 — delete a doc (RAG file + parsed content + metadata)
# ---------------------------------------------------------------------------


@router.delete("/{doc_id}", status_code=204)
async def delete_curriculum(
    doc_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Delete a curriculum doc — its RAG file, parsed content, and metadata.

    Teacher-only. A teacher may delete their OWN uploads or any **shared**-corpus
    doc — symmetric with ingest (any teacher can add a cleared shared doc), and
    the shared corpus is institutional + teacher-curated. Deleting another
    teacher's private upload is denied (403). RAG-file removal is best-effort:
    the Firestore metadata is the source of truth for what's visible, so an
    orphaned RagFile is harmless. Idempotent-ish: a missing doc returns 404.
    """
    if getattr(user, "group_id", None):
        raise HTTPException(status_code=403, detail="Curriculum delete is teacher-only.")

    doc = get_curriculum_doc(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")

    if doc.owner_scope not in (SHARED_SCOPE, user.uid):
        raise HTTPException(status_code=403, detail="You can only delete your own or shared docs.")

    if doc.doc_artifact_id:
        await delete_rag_file(doc.doc_artifact_id)
    delete_curriculum_content(doc_id)
    delete_curriculum_doc(doc_id)
    logger.info("Curriculum doc deleted: %s (owner_scope=%s)", doc_id, doc.owner_scope)


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
