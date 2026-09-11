"""The pedagogy-literature RAG corpus (1.1.110) — AUTHORING TIME ONLY.

The seven published frameworks are drafted from journal papers whose PDFs live
in ``docs/literature/tp-framework/``. Until now a citation was a string: it told
a reader which paper a behaviour came from and could not show them the sentence.
This corpus is what makes ``vouchedBy: M`` checkable — *here is the passage* —
rather than a claim to be taken on trust.

## A SEPARATE corpus, deliberately

This is not the curriculum corpus with different documents in it. It is a second
corpus behind a second env var, and that is the whole safety model:

* the curriculum corpus is reachable from a **student session**, scoped per
  activity by ``build_curriculum_retrieval_tool``;
* this one has **no tool builder at all**. There is no function here that returns
  an ADK tool, so there is nothing for an agent to be handed. The only entry
  point is ``query_literature``, a plain async call made by authoring surfaces.

A student session cannot reach this corpus because there is no code path that
would let it — not because everyone remembers not to. ``scripts/check-literature-
corpus-isolation.sh`` fails the build if this module is ever imported from the
agent or student path.

## Why not ground the TUTOR in it?

Because retrieval would make the tutor's prompt differ turn to turn, and the
reviewability property this layer exists for — hold the prompt against the paper
and check it — requires the prompt to be the same thing every time. The
literature belongs where a human is reading it: the researcher's editor, and the
tutor co-pilot's proposals (1.1.91 M2).

## Copyright

These are copyrighted journal PDFs, kept as private working references and
gitignored (``docs/literature/tp-framework/README.md``). Ingesting the parsed
text into a private corpus in the project's own GCP tenancy is not publication,
but it IS a copy on a cloud service — approved by M on 2026-09-11. The corpus
must never be made public, and no student-facing surface may cite from it.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

log = logging.getLogger(__name__)

_CORPUS_ENV = "LITERATURE_RAG_CORPUS_NAME"

#: The display name the bootstrap script provisions.
DEFAULT_DISPLAY_NAME = "aipla-literature-v1"


def get_literature_corpus_name() -> str | None:
    """The corpus resource name, or None when not configured.

    None is a normal state, not an error: local dev and any environment where
    the corpus has not been provisioned simply have no passage lookup, and the
    caller degrades to citations-as-strings (Axiom 5).
    """
    return os.environ.get(_CORPUS_ENV, "").strip() or None


async def query_literature(query: str, *, top_k: int = 5, framework_id: str | None = None) -> list[dict[str, Any]]:
    """Passages from the literature corpus matching ``query``.

    ⚠️ **Authoring time only.** Never call this from an agent callback, a tool,
    or anything on a student turn — see the module docstring. It returns raw
    passages from copyrighted papers.

    ``framework_id`` narrows to one framework's sources where the ingest tagged
    them; passing None searches the whole corpus, which is what a researcher
    drafting a new construct wants.

    Returns ``[]`` when the corpus is unset or the query fails — a passage
    lookup that cannot answer degrades to no passages, because the citation
    string is still there and is still the durable record.
    """
    corpus_name = get_literature_corpus_name()
    if not corpus_name:
        log.info("literature corpus not configured — no passage lookup")
        return []

    def _query_sync() -> list[dict[str, Any]]:
        import vertexai
        from vertexai import rag

        # Init with the CORPUS's region, never "global" — the same trap
        # db/rag_corpus.py documents for the curriculum corpus.
        vertexai.init(project=os.environ.get("GOOGLE_CLOUD_PROJECT"), location=_corpus_location(corpus_name))
        response = rag.retrieval_query(
            text=query,
            rag_resources=[rag.RagResource(rag_corpus=corpus_name)],
            rag_retrieval_config=rag.RagRetrievalConfig(top_k=top_k),
        )
        contexts = getattr(getattr(response, "contexts", None), "contexts", None) or []
        rows: list[dict[str, Any]] = []
        for c in contexts:
            text = getattr(c, "text", None)
            if not text:
                continue
            rows.append(
                {
                    "text": text,
                    "frameworkId": _framework_of(c),
                    "score": getattr(c, "score", None),
                }
            )
        return rows

    try:
        rows = await asyncio.to_thread(_query_sync)
    except Exception as exc:
        log.warning("literature query failed (%s): %s", type(exc).__name__, exc)
        return []

    if framework_id:
        # Narrow only where the ingest actually tagged a framework. An untagged
        # passage is kept rather than dropped: a source shared by two frameworks
        # is common, and silently hiding it would look like the corpus lacking
        # the paper.
        rows = [r for r in rows if r["frameworkId"] in (None, "", framework_id)]
    return rows


def _corpus_location(corpus_name: str) -> str:
    """The region embedded in a corpus resource name (projects/_/locations/<x>/...)."""
    parts = corpus_name.split("/")
    return parts[3] if len(parts) > 3 and parts[2] == "locations" else "europe-north1"


def _framework_of(ctx: Any) -> str | None:
    """Which framework a passage came from.

    The ingest names each file ``<framework_id>.txt`` because the display name
    is the only metadata a retrieval context reliably carries back. The CITATION
    is not stored in the corpus at all — it lives in the framework YAML's
    provenance, which is its one source of truth, and the caller resolves it
    from there.
    """
    name = getattr(ctx, "source_display_name", "") or ""
    stem = name.rsplit("/", 1)[-1]
    return stem[:-4] if stem.endswith(".txt") else (stem or None)


__all__ = [
    "DEFAULT_DISPLAY_NAME",
    "get_literature_corpus_name",
    "query_literature",
]
