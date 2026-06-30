"""Vertex AI RAG corpus access for the curriculum library (1.1.25 M2).

The corpus resource name is injected via the CURRICULUM_RAG_CORPUS_NAME env var
(set by bootstrap_rag_corpus.py → Secret Manager → Cloud Run).

When the env var is absent (local dev without a live corpus), upload_text_as_rag_file
returns None and the caller stores "" for doc_artifact_id — the doc is still
browseable and metadata-complete; retrieval degrades gracefully (Axiom 5).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile

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
    (which is ``global`` for Gemini/Vertex GenAI and would route RAG ops to the
    wrong endpoint). Parse ``projects/.../locations/<region>/ragCorpora/...``.
    """
    m = re.search(r"/locations/([^/]+)/", corpus_name)
    if m:
        return m.group(1)
    # Fallback: explicit env override, else AIPLA's Vertex region (NOT "global").
    loc = os.environ.get("GOOGLE_CLOUD_LOCATION", "").strip()
    return loc if loc and loc != "global" else "europe-west1"


async def upload_text_as_rag_file(
    text: str,
    doc_id: str,
    *,
    title: str,
    level: str | None,
    topic: str | None,
    owner_scope: str,
) -> str | None:
    """Upload parsed text into the curriculum RAG corpus as a tagged RagFile.

    The RagFile's description carries JSON metadata {doc_id, level, topic,
    owner_scope} so the retrieval layer can filter by these fields (M3).

    Returns:
        The RagFile resource name (stored as CurriculumDoc.doc_artifact_id) on
        success, or None when the corpus is not configured / upload fails.
    """
    corpus_name = get_corpus_name()
    if not corpus_name:
        log.info("CURRICULUM_RAG_CORPUS_NAME not set — skipping RAG upload for %s", doc_id)
        return None

    description = json.dumps({"doc_id": doc_id, "level": level, "topic": topic, "owner_scope": owner_scope})

    def _upload_sync() -> str:
        import vertexai
        from vertexai import rag

        project = os.environ.get("GOOGLE_CLOUD_PROJECT")
        # Init with the CORPUS's region (the SDK routes RAG ops by init
        # location, not the resource name) — not GOOGLE_CLOUD_LOCATION=global.
        vertexai.init(project=project, location=_corpus_location(corpus_name))

        # Write text to a temp .txt file — rag.upload_file takes a local path.
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
            log.info("RAG upload ok for %s: %s", doc_id, rag_file.name)
            return rag_file.name
        except Exception as exc:
            log.warning("RAG upload failed for %s: %s", doc_id, exc)
            raise
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    try:
        return await asyncio.to_thread(_upload_sync)
    except Exception as exc:
        log.warning("RAG upload error for %s (returning None): %s", doc_id, exc)
        return None


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
