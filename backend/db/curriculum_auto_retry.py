"""Automatic retries for a curriculum document whose RAG upload failed.

Written 2026-10-06, after Vertex RAG indexing in europe-west1 returned
``code 13`` for several minutes: every upload and re-ingest in that window
failed, and two documents had already been failed for weeks. The in-request
retry (``db.rag_corpus.MAX_ATTEMPTS``) rides out a blip; this rides out an
outage, so the teacher is not the retry loop.

**How a retry runs.** The service scales to zero and throttles CPU between
requests, so a timer would not fire. Instead a retry runs when it is DUE and
something asks about the document — the teacher's materials list, the
activity-card status check, or the tutor meeting an unreadable cited document.
The teacher's status line re-asks once the scheduled time passes, so an open
page drives its own retry. A doc nobody looks at is retried the next time
somebody does, which is when it matters.

**What a teacher sees.** The status stays ``failed`` — no new RagStatus value,
because an older revision would reject it mid-deploy — and ``ragNextRetryAt`` /
``ragAutoRetries`` say a retry is coming, when, and how many have run.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from db.models.curriculum import CurriculumDoc

log = logging.getLogger(__name__)

#: Wait before automatic retry N+1 (index N). Five retries over ~8.7 hours.
AUTO_RETRY_DELAYS: tuple[timedelta, ...] = (
    timedelta(minutes=2),
    timedelta(minutes=10),
    timedelta(minutes=30),
    timedelta(hours=2),
    timedelta(hours=6),
)
AUTO_RETRY_MAX = len(AUTO_RETRY_DELAYS)

#: A ``pending`` doc older than this lost its upload (the instance went away
#: mid-flight) and is treated as failed-and-due rather than stuck forever.
STALE_PENDING = timedelta(minutes=10)

# Doc ids with a retry running in THIS process. Two instances can still race;
# the cost is one duplicate upload, and reingest deletes the older RagFile.
_in_flight: set[str] = set()


def schedule_next(doc: CurriculumDoc, now: datetime | None = None) -> None:
    """Set when the next automatic retry is due, or clear it when none are left.

    Call after a FAILED upload. ``rag_auto_retries`` counts the automatic
    retries that have already run; the caller increments it for an automatic
    attempt before calling this.
    """
    now = now or datetime.now(UTC)
    n = doc.rag_auto_retries or 0
    doc.rag_next_retry_at = now + AUTO_RETRY_DELAYS[n] if n < AUTO_RETRY_MAX else None


def clear_schedule(doc: CurriculumDoc) -> None:
    """A working upload ends the schedule."""
    doc.rag_next_retry_at = None


def is_due(doc: CurriculumDoc, now: datetime | None = None) -> bool:
    """True when an automatic retry should run for ``doc`` now."""
    now = now or datetime.now(UTC)
    if doc.doc_id in _in_flight or doc.doc_artifact_id:
        return False
    if doc.rag_status == "pending":
        return bool(doc.rag_updated_at and now - doc.rag_updated_at > STALE_PENDING)
    if doc.rag_status != "failed" or doc.rag_next_retry_at is None:
        return False
    return doc.rag_next_retry_at <= now


async def _run(doc: CurriculumDoc) -> None:
    from db.curriculum_reingest import NoStoredText, reingest_curriculum_doc

    try:
        doc.rag_auto_retries = (doc.rag_auto_retries or 0) + 1
        updated, _rag = await reingest_curriculum_doc(doc, automatic=True)
        log.info(
            "curriculum auto-retry %d/%d for %s -> %s",
            updated.rag_auto_retries,
            AUTO_RETRY_MAX,
            doc.doc_id,
            updated.rag_status,
        )
    except NoStoredText:
        # Nothing to send: only a fresh upload can fix it, so stop retrying.
        from db.curriculum import create_curriculum_doc

        doc.rag_next_retry_at = None
        create_curriculum_doc(doc)
        log.warning("curriculum auto-retry for %s stopped: no stored text", doc.doc_id)
    except Exception:  # a background retry must never surface
        log.exception("curriculum auto-retry for %s raised", doc.doc_id)
    finally:
        _in_flight.discard(doc.doc_id)


def kick_due(docs: Iterable[CurriculumDoc]) -> int:
    """Start a background retry for every due doc; return how many started.

    Never blocks the caller and never raises — this sits on read paths (the
    materials list, the tutor's retrieval wiring).
    """
    started = 0
    now = datetime.now(UTC)
    for doc in docs:
        try:
            if not is_due(doc, now):
                continue
            _in_flight.add(doc.doc_id)
            asyncio.get_running_loop().create_task(_run(doc))
            started += 1
        except RuntimeError:
            # No running loop (a sync caller) — leave it for the next async read.
            _in_flight.discard(doc.doc_id)
        except Exception:
            _in_flight.discard(doc.doc_id)
            log.exception("curriculum auto-retry kick failed for %s", getattr(doc, "doc_id", "?"))
    return started


__all__ = [
    "AUTO_RETRY_DELAYS",
    "AUTO_RETRY_MAX",
    "STALE_PENDING",
    "clear_schedule",
    "is_due",
    "kick_due",
    "schedule_next",
]
