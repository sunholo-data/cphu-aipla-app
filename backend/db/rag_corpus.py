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
import tempfile

log = logging.getLogger(__name__)

_CORPUS_ENV = "CURRICULUM_RAG_CORPUS_NAME"


def get_corpus_name() -> str | None:
    """Return the RAG corpus resource name from env, or None if not configured."""
    return os.environ.get(_CORPUS_ENV, "").strip() or None


async def upload_text_as_rag_file(
    text: str,
    doc_id: str,
    *,
    title: str,
    level: str,
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
        location = os.environ.get("GOOGLE_CLOUD_LOCATION", "europe-north1")
        if project:
            vertexai.init(project=project, location=location)

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
