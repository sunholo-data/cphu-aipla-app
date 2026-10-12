"""Re-run a curriculum document's RAG upload from its stored text (1.1.151 F1b).

One implementation, two callers: the teacher's *Prøv igen*
(``POST /api/curriculum/{id}/reingest``) and the operator's
``make backfill-rag-status REINGEST=<id>`` — so the repair a person runs by hand
is the same code a teacher's button runs.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from db.curriculum import create_curriculum_doc, get_curriculum_content
from db.curriculum_auto_retry import clear_schedule, schedule_next
from db.models.curriculum import CurriculumDoc
from db.rag_corpus import RagOutcome, delete_rag_file, upload_with_retry

log = logging.getLogger(__name__)


class NoStoredText(Exception):
    """The doc has no stored parsed text — only a fresh upload can fix it."""


async def reingest_curriculum_doc(doc: CurriculumDoc, *, automatic: bool = False) -> tuple[CurriculumDoc, RagOutcome]:
    """Upload ``doc``'s stored text to the RAG corpus again; persist the outcome.

    ``automatic`` marks a scheduled retry (``db/curriculum_auto_retry.py``), which
    has already counted itself in ``rag_auto_retries``. Either way a failure
    schedules the next automatic retry (until they run out) and a success ends
    the schedule — so a teacher's *Prøv igen* that fails does not stop the
    automatic ones.

    Writes ``pending`` first (so a concurrent viewer sees "Behandles…"), then the
    result. A previously working RagFile is deleted only AFTER a new one exists,
    and is KEPT when the retry fails — a failed retry must never take away a copy
    the tutor could read.

    Raises:
        NoStoredText: when there is nothing stored to upload.
    """
    content = get_curriculum_content(doc.doc_id)
    text = (content or {}).get("text") or ""
    if not text.strip():
        raise NoStoredText(doc.doc_id)

    previous_artifact = doc.doc_artifact_id
    doc.rag_status = "pending"
    doc.rag_updated_at = datetime.now(UTC)
    doc.rag_next_retry_at = None  # claimed: no other reader starts this one
    create_curriculum_doc(doc)

    rag = await upload_with_retry(
        text,
        doc.doc_id,
        title=doc.title,
        level=doc.level,
        topic=doc.topic,
        owner_scope=doc.owner_scope,
    )
    now = datetime.now(UTC)
    doc.rag_attempts = (doc.rag_attempts or 0) + rag.attempts
    doc.rag_updated_at = now
    doc.updated_at = now
    if rag.rag_file_name:
        doc.doc_artifact_id = rag.rag_file_name
        doc.rag_status = "ready"
        doc.rag_error = None
        clear_schedule(doc)
    elif previous_artifact:
        # The old copy still works, so the tutor can read it: nothing to retry.
        doc.rag_status = "ready"
        doc.rag_error = rag.error
        clear_schedule(doc)
    else:
        doc.rag_status = "failed"
        doc.rag_error = rag.error
        schedule_next(doc, now)
    create_curriculum_doc(doc)

    if rag.rag_file_name and previous_artifact and previous_artifact != rag.rag_file_name:
        await delete_rag_file(previous_artifact)

    if rag.rag_file_name:
        log.info("Curriculum doc reingested: %s rag=ready attempts=%d", doc.doc_id, rag.attempts)
    else:
        log.warning(
            "Curriculum doc rag_failed on reingest: %s attempts=%d automatic=%s next_retry=%s error=%s",
            doc.doc_id,
            rag.attempts,
            automatic,
            doc.rag_next_retry_at,
            rag.error,
        )
    return doc, rag
