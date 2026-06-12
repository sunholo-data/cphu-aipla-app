"""Curriculum retrieval tool for the tutor agent (1.1.25 M3).

Builds a ``VertexAiRagRetrieval`` tool scoped to an activity's cited
curriculum materials only — the open corpus is never reachable from a
student session (deny-by-default, design doc §Retrieval+ACL).

Two public helpers:

``build_curriculum_retrieval_tool(materials)``
    Looks up each cited doc's ``doc_artifact_id`` in Firestore, extracts the
    RAG file ID, and returns a ``VertexAiRagRetrieval`` instance scoped to
    exactly those file IDs.  Returns ``None`` when:
    - materials list is empty
    - ``CURRICULUM_RAG_CORPUS_NAME`` env var is unset (Axiom 5 graceful
      degradation — tutor works without grounding, shows "no source" note)
    - none of the cited docs have been RAG-ingested yet (empty
      ``doc_artifact_id``)

``build_curriculum_grounding_preamble(materials)``
    Returns a system-prompt preamble (appended to the skill instructions)
    that tells the tutor to prefer cited content and cite the ``origin``
    label.  Pure function — no Firestore access; reads ``MaterialRef.origin``
    which is cached at citation time by the activity builder (M4).
    Returns an empty string when there are no cited materials.
"""

from __future__ import annotations

import logging
import os

from google.adk.tools.retrieval import VertexAiRagRetrieval
from vertexai import rag

from db.curriculum import get_curriculum_doc
from db.models.activity_config import MaterialRef

log = logging.getLogger(__name__)

_CORPUS_ENV = "CURRICULUM_RAG_CORPUS_NAME"

_GROUNDING_PREAMBLE_TEMPLATE = """\

## Curriculum grounding
This activity cites the following curriculum sources:
{origin_list}

When answering physics questions, prefer content from these sources over your \
general knowledge. Always attribute your answer: start with \
"According to [source name]..." or "From [source name]:...".
If the `curriculum_retrieve` tool returns no relevant content, say so \
explicitly — do not invent curriculum content.
"""


def _rag_file_id(resource_name: str) -> str:
    """Extract the short file ID from a full RagFile resource name.

    Vertex AI RAG APIs accept the short numeric suffix (e.g. ``"99"``)
    rather than the full path when specifying ``rag_file_ids`` within a
    ``RagResource``.  See ``rag.retrieval_query`` example in rag_retrieval.py.
    """
    return resource_name.rstrip("/").rsplit("/", 1)[-1] if "/" in resource_name else resource_name


def build_curriculum_retrieval_tool(materials: list[MaterialRef]) -> object | None:
    """Build a VertexAiRagRetrieval tool scoped to cited doc file IDs.

    Reads ``CurriculumDoc.doc_artifact_id`` from Firestore for each cited
    material.  Docs not yet RAG-ingested (empty ``doc_artifact_id``) are
    skipped with a warning.

    Returns:
        A ``VertexAiRagRetrieval`` instance or ``None`` (graceful degradation).
    """
    if not materials:
        return None

    corpus_name = os.environ.get(_CORPUS_ENV, "").strip()
    if not corpus_name:
        log.info("CURRICULUM_RAG_CORPUS_NAME not set — curriculum retrieval disabled for this session")
        return None

    file_ids: list[str] = []
    for mat in materials:
        doc = get_curriculum_doc(mat.doc_id)
        if doc is None:
            log.warning("Cited curriculum doc %r not found in Firestore — skipping", mat.doc_id)
            continue
        if not doc.doc_artifact_id:
            log.warning("Cited curriculum doc %r has no RAG file yet (pending ingest) — skipping", mat.doc_id)
            continue
        file_ids.append(_rag_file_id(doc.doc_artifact_id))

    if not file_ids:
        log.info(
            "No ingested RAG files for %d cited material(s) — curriculum retrieval disabled",
            len(materials),
        )
        return None

    tool = VertexAiRagRetrieval(
        name="curriculum_retrieve",
        description=(
            "Retrieve curriculum content from the documents cited for this activity. "
            "Use this when the student asks a physics question that may be covered by "
            "the cited curriculum material. Always cite the source in your answer."
        ),
        rag_resources=[
            rag.RagResource(
                rag_corpus=corpus_name,
                rag_file_ids=file_ids,
            )
        ],
    )
    log.info(
        "Curriculum retrieval tool built: corpus=%s files=%d",
        corpus_name,
        len(file_ids),
    )
    return tool


def build_curriculum_grounding_preamble(materials: list[MaterialRef]) -> str:
    """Build an instruction preamble listing cited curriculum sources.

    Pure function — reads ``MaterialRef.origin`` (cached at citation time by
    M4 activity builder).  Returns empty string when there are no materials
    or when none have an ``origin`` label, so appending it is always safe.
    """
    if not materials:
        return ""

    origins = [m.origin for m in materials if m.origin]
    if not origins:
        # Materials cited but without origin labels — still inject basic preamble.
        origin_list = "- (curriculum documents)"
    else:
        origin_list = "\n".join(f"- {o}" for o in origins)

    return _GROUNDING_PREAMBLE_TEMPLATE.format(origin_list=origin_list)
