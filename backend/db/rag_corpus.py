"""Vertex AI RAG corpus access for the curriculum library (1.1.25 M2).

The corpus resource name is injected via the CURRICULUM_RAG_CORPUS_NAME env var
(set by bootstrap_rag_corpus.py → Secret Manager → Cloud Run).

When the env var is absent (local dev without a live corpus), upload_with_retry
returns a failed outcome and the caller stores "" for doc_artifact_id with
``ragStatus: "failed"`` — the doc is still browseable and metadata-complete;
retrieval degrades gracefully (Axiom 5), and the teacher is told the tutor
cannot read it (1.1.151 F1).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass

log = logging.getLogger(__name__)

_CORPUS_ENV = "CURRICULUM_RAG_CORPUS_NAME"


def get_corpus_name() -> str | None:
    """Return the RAG corpus resource name from env, or None if not configured."""
    return os.environ.get(_CORPUS_ENV, "").strip() or None


def _corpus_location(corpus_name: str) -> str:
    """Vertex region for RAG ops, derived from the corpus resource name.

    The vertexai RAG SDK builds the upload/query endpoint from the *init*
    location, NOT the corpus's own region — so we MUST init with the corpus's
    region (europe-west1 for AIPLA), not the backend's ``GOOGLE_CLOUD_LOCATION``
    (which is the ``eu`` multi-region for Gemini/Vertex GenAI and would route RAG ops to the
    wrong endpoint). Parse ``projects/.../locations/<region>/ragCorpora/...``.
    """
    m = re.search(r"/locations/([^/]+)/", corpus_name)
    if m:
        return m.group(1)
    # Fallback: explicit env override, else AIPLA's Vertex region. Never
    # "global" or a multi-region ("eu"/"us") — RAG corpora live in a real region.
    loc = os.environ.get("GOOGLE_CLOUD_LOCATION", "").strip()
    return loc if loc and loc not in {"global", "eu", "us"} else "europe-west1"


# 1.1.151 F1 — a failed RAG upload is a STATE, not a log line.
#
# Until 2026-10-05 the upload helper swallowed every error and
# returned None; the ingest route then logged "Curriculum doc ingested" and
# returned 200. One teacher's document (``b594d415…``) failed that way on
# 2026-09-07 and the tutor ran four weeks of lessons without it while every
# surface said it had succeeded. ``upload_with_retry`` keeps the reason, retries
# once (the observed error, ``Expecting value``, is a non-JSON reply from the
# RAG API — the transient shape), and hands the caller an outcome it must store.

#: Base seconds between in-request attempts. Env-tunable; tests set it to 0.
RETRY_BACKOFF_S = float(os.getenv("CURRICULUM_RAG_RETRY_BACKOFF_S", "2"))
#: Total attempts per upload call. Three, waiting ~2 s then ~6 s: long enough to
#: ride out a blip, short enough that a teacher's upload request still returns.
#: An outage longer than that (2026-10-06: Vertex RAG indexing returned code 13
#: for several minutes) is the scheduled retry's job — db/curriculum_auto_retry.py.
MAX_ATTEMPTS = 3
#: Multiplier on RETRY_BACKOFF_S before attempt N+1 (index N-1).
_BACKOFF_STEPS = (1, 3)
#: ``ragError`` is shown to a teacher and stored on the doc — short, no stack.
_ERROR_CAP = 240

NOT_CONFIGURED_ERROR = "RAG corpus not configured on this environment"


@dataclass(frozen=True)
class RagOutcome:
    """What one upload call achieved. ``rag_file_name`` is set iff it worked."""

    rag_file_name: str | None
    error: str | None
    attempts: int

    @property
    def status(self) -> str:
        return "ready" if self.rag_file_name else "failed"


def short_error(exc: BaseException) -> str:
    """One line a teacher can be shown: the exception type and its message."""
    msg = " ".join(str(exc).split())
    text = f"{type(exc).__name__}: {msg}" if msg else type(exc).__name__
    return text[:_ERROR_CAP]


async def _upload_once(
    text: str, doc_id: str, *, corpus_name: str, level: str | None, topic: str | None, owner_scope: str
) -> str:
    """One upload attempt. RAISES on failure — the caller decides what it means."""
    description = json.dumps({"doc_id": doc_id, "level": level, "topic": topic, "owner_scope": owner_scope})

    def _upload_sync() -> str:
        import vertexai
        from vertexai import rag

        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        # Init with the CORPUS's region (the SDK routes RAG ops by init
        # location, not the resource name) — not GOOGLE_CLOUD_LOCATION=global.
        vertexai.init(project=project, location=_corpus_location(corpus_name))
        # rag.upload_file takes a local path, so write the text to a temp file.
        tmp = tempfile.NamedTemporaryFile(
            suffix=".txt", mode="w", encoding="utf-8", delete=False, prefix=f"curriculum_{doc_id}_"
        )
        try:
            tmp.write(text)
            tmp.flush()
            tmp_path = tmp.name
        finally:
            tmp.close()
        try:
            rag_file = rag.upload_file(
                corpus_name=corpus_name,
                path=tmp_path,
                display_name=f"{doc_id}.txt",
                description=description,
            )
            return rag_file.name
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    return await asyncio.to_thread(_upload_sync)


async def upload_with_retry(
    text: str,
    doc_id: str,
    *,
    title: str,
    level: str | None,
    topic: str | None,
    owner_scope: str,
) -> RagOutcome:
    """Upload ``text`` as a RagFile, up to ``MAX_ATTEMPTS`` times. Never raises.

    Returns a ``RagOutcome`` the caller MUST persist (``ragStatus`` /
    ``ragError`` / ``ragAttempts``) — the whole point is that a failure stays
    visible. An unconfigured corpus is reported as a failure with a plain
    reason: the tutor genuinely cannot read the document, so saying "ready"
    would be the same lie in a smaller place.
    """
    corpus_name = get_corpus_name()
    if not corpus_name:
        log.info("CURRICULUM_RAG_CORPUS_NAME not set — skipping RAG upload for %s", doc_id)
        return RagOutcome(rag_file_name=None, error=NOT_CONFIGURED_ERROR, attempts=0)

    last_error = ""
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            name = await _upload_once(
                text, doc_id, corpus_name=corpus_name, level=level, topic=topic, owner_scope=owner_scope
            )
            log.info("RAG upload ok for %s (attempt %d): %s", doc_id, attempt, name)
            return RagOutcome(rag_file_name=name, error=None, attempts=attempt)
        except Exception as exc:
            last_error = short_error(exc)
            log.warning("RAG upload attempt %d/%d failed for %s: %s", attempt, MAX_ATTEMPTS, doc_id, last_error)
            if attempt < MAX_ATTEMPTS and RETRY_BACKOFF_S > 0:
                await asyncio.sleep(RETRY_BACKOFF_S * _BACKOFF_STEPS[min(attempt, len(_BACKOFF_STEPS)) - 1])
    return RagOutcome(rag_file_name=None, error=last_error, attempts=MAX_ATTEMPTS)


async def delete_rag_file(rag_file_name: str) -> bool:
    """Delete a RagFile from the curriculum corpus by its resource name.

    Best-effort: the Firestore metadata is the source of truth for what's
    visible, so an orphaned RagFile only wastes storage. Returns True on
    success, False on no-name / failure (the caller still removes the metadata).
    """
    if not rag_file_name:
        return False

    def _delete_sync() -> bool:
        import vertexai
        from vertexai import rag

        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        # Init with the file's region (same reason as upload — the SDK routes by
        # init location, not the resource name). A ragFile name carries the same
        # /locations/<region>/ segment a corpus name does.
        vertexai.init(project=project, location=_corpus_location(rag_file_name))
        rag.delete_file(name=rag_file_name)
        log.info("RAG file deleted: %s", rag_file_name)
        return True

    try:
        return await asyncio.to_thread(_delete_sync)
    except Exception as exc:
        log.warning("RAG delete failed for %s (continuing): %s", rag_file_name, exc)
        return False


async def query_rag_files(file_ids: list[str], query: str, *, top_k: int = 5) -> list[str]:
    """Run a one-shot retrieval over the given RAG file IDs (1.1.25 M5).

    Used by the ``curriculum query`` CLI / ops endpoint to test retrieval
    outside a full tutor session. Scoped to the explicit ``file_ids`` allow-list
    (same deny-by-default shape as the M3 tutor tool).

    Returns:
        A list of matching chunk texts (best-first), or ``[]`` when the corpus
        is not configured / no files / nothing matched (graceful — Axiom 5).
    """
    corpus_name = get_corpus_name()
    if not corpus_name or not file_ids:
        return []

    def _query_sync() -> list[str]:
        import vertexai
        from vertexai import rag

        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        # Init with the CORPUS's region (see _corpus_location) — not "global".
        vertexai.init(project=project, location=_corpus_location(corpus_name))

        response = rag.retrieval_query(
            text=query,
            rag_resources=[rag.RagResource(rag_corpus=corpus_name, rag_file_ids=file_ids)],
            rag_retrieval_config=rag.RagRetrievalConfig(top_k=top_k),
        )
        contexts = getattr(getattr(response, "contexts", None), "contexts", None) or []
        return [c.text for c in contexts if getattr(c, "text", None)]

    try:
        return await asyncio.to_thread(_query_sync)
    except Exception as exc:
        log.warning("RAG query error (returning []): %s", exc)
        return []
