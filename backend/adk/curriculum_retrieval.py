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

# 1.1.60 — chunks returned per retrieval call. Retrieval is already narrowed to
# the activity's cited docs (usually 1-3), so this is a per-answer grounding
# budget rather than a corpus-wide cutoff: enough to cover a multi-part question,
# small enough that the tutor isn't handed a wall of text to summarise. Override
# via env when tuning; the ops/eval path (`db.rag_corpus.query_corpus`) takes its
# own explicit top_k.
_TOP_K = int(os.getenv("CURRICULUM_RETRIEVAL_TOP_K", "5"))

# 1.1.63 M1 — the citation-voice contract.
#
# The previous version of this template instructed the tutor to 'Always
# attribute your answer: start with "According to [source name]..."'. Aswin's
# 2026-08-06 trial feedback — "the chat always starts with According to
# mathematicus.dk…" — was our own instruction quoted back at us; the model was
# complying exactly. Three things were wrong with it: it fired on EVERY turn
# (including turns that retrieved nothing), it dictated the SENTENCE-INITIAL
# position (the most intrusive one available), and it named sources by DOMAIN,
# which is meaningless to a 16-year-old and reads as a URL rather than a source.
#
# The replacement states WHEN to attribute and HOW, rather than handing the
# model its opening words. Attribution is reduced, never removed — Axiom 2
# (EARNED TRUST) requires a student to always be able to trace a claim, so the
# final line keeps that guarantee explicit.
_GROUNDING_PREAMBLE_TEMPLATE = """\

## Curriculum grounding
Curriculum material for this activity:
{origin_list}

Prefer these sources over your general knowledge for physics content.

Name a source when it carries the answer — a specific number, definition, \
formula or claim the student could not otherwise check — and name it by its \
TITLE, mid-sentence or after the point, in your own voice. Do not open a reply \
with an attribution. Do not cite on turns that use no retrieved content. Never \
cite by domain or filename. If the student asks where something came from, say \
precisely.
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
    # 1.1.44: image materials are not RAG docs — they reach the tutor as
    # multimodal Parts (see adk/activity_images.py), not via retrieval.
    materials = [m for m in materials if m.kind == "curriculum"]
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
            "the cited curriculum material. When the retrieved content carries the "
            "answer, name its title in your reply — see the curriculum grounding "
            "instructions for how."
        ),
        rag_resources=[
            rag.RagResource(
                rag_corpus=corpus_name,
                rag_file_ids=file_ids,
            )
        ],
        # 1.1.60 — set the chunk budget EXPLICITLY. This was previously left to
        # the SDK default, which is invisible here and free to change under us;
        # the number of chunks the tutor gets per query is a pedagogical knob
        # (too few → thin grounding, too many → the model drowns), so it belongs
        # in the codebase. Scoping is still the rag_file_ids allow-list above,
        # not a metadata filter — see the module docstring.
        similarity_top_k=_TOP_K,
    )
    log.info(
        "Curriculum retrieval tool built: corpus=%s files=%d top_k=%d",
        corpus_name,
        len(file_ids),
        _TOP_K,
    )
    return tool


def build_curriculum_grounding_preamble(materials: list[MaterialRef]) -> str:
    """Build an instruction preamble listing cited curriculum sources.

    Pure function — reads ``MaterialRef.origin`` (cached at citation time by
    M4 activity builder).  Returns empty string when there are no materials
    or when none have an ``origin`` label, so appending it is always safe.
    """
    # 1.1.44: only curriculum materials ground the tutor's text answers.
    materials = [m for m in materials if m.kind == "curriculum"]
    if not materials:
        return ""

    labels = [_source_label(m) for m in materials]
    labels = [label for label in labels if label]
    if not labels:
        # Materials cited but with neither title nor origin cached — still
        # inject the basic preamble.
        origin_list = "- (curriculum documents)"
    else:
        origin_list = "\n".join(f"- {label}" for label in labels)

    return _GROUNDING_PREAMBLE_TEMPLATE.format(origin_list=origin_list)


def _source_label(material: MaterialRef) -> str:
    """Render one cited source as ``"Title" (provenance)``.

    Title leads because that is what the tutor is told to cite by, and what a
    student can actually look up. ``origin`` trails in parentheses as
    provenance ("uvm.dk", "Haka Fysik").

    Falls back to bare ``origin`` when no title is cached — every activity
    cited before 1.1.63 M1 is in that shape, and must keep naming its source
    exactly as it does today rather than silently losing attribution.
    """
    title = (material.title or "").strip()
    origin = (material.origin or "").strip()

    if title and origin:
        return f'"{title}" ({origin})'
    if title:
        return f'"{title}"'
    return origin
