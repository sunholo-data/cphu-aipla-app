"""AI document extraction — the multimodal fallback for formats AILANG Parse
can't do deterministically (PDF, images). Runs on the ``document_extract``
purpose model (models.yaml ``purposes``), which must be one that reads PDFs.

This is the implementation of the fallback that ``ailang_parse.py`` documents:
deterministic formats go through DocParse; PDFs/images come here. Kept in
``tools/documents/`` (next to the deterministic parser) so every caller shares
ONE implementation — the curriculum ingest (1.1.33) and, later, the
document-upload path's ``pending_ai_extraction`` status.

Raises ``ValueError`` on failure/empty so it stays framework-agnostic; callers
map that to their own error (e.g. an HTTP 422).
"""

from __future__ import annotations

import logging

from llm import Attachment, generate

log = logging.getLogger(__name__)

_EXTRACT_PROMPT = (
    "Extract ALL text from this document as clean Markdown. Preserve headings, "
    "lists, and tables in reading order. Do NOT summarise, translate, comment, "
    "or add anything — output only the document's own content."
)


async def extract_pdf_text(pdf_bytes: bytes, *, model: str | None = None) -> str:
    """Extract a PDF's text as Markdown on the ``document_extract`` model.
    OCR-capable on Gemini, so scanned PDFs work too.

    Raises:
        ValueError: extraction failed or produced no text.
    """
    try:
        response = await generate(
            [_EXTRACT_PROMPT, Attachment(data=pdf_bytes, mime_type="application/pdf")],
            **({"model": model} if model else {"purpose": "document_extract"}),
        )
    except Exception as exc:
        log.warning("AI PDF extraction failed: %s", exc)
        raise ValueError("PDF extraction failed") from exc

    text = (response.text or "").strip()
    if not text:
        raise ValueError("PDF extraction returned no text")
    return text


_SUMMARY_PROMPT = (
    "You are cataloguing a physics curriculum document for a teacher's reference "
    "library. In ONE or TWO sentences (max ~40 words), say what this document "
    "covers and what it is useful for — the topics, and the level/audience if "
    "evident. Write it as a catalogue blurb a teacher scanning a list would find "
    "useful. Match the document's language (Danish or English). Output ONLY the "
    "summary — no preamble, no labels, no quotes."
)

# Cap the text we send (keep the summary call cheap on a large doc) + the output
# (mirrors CurriculumDoc.summary max_length).
_SUMMARY_INPUT_CAP = 12_000
_SUMMARY_OUTPUT_CAP = 1000


async def summarise_curriculum_text(text: str, *, model: str | None = None) -> str:
    """Generate a 1-2 sentence catalogue summary of a curriculum document.

    Cheap, one-shot — used at ingest and by the ``summarize`` backfill. Returns
    ``""`` on empty input OR any failure: a missing summary must never block
    ingest (it degrades to metadata-only selection), so the caller just stores
    whatever comes back.
    """
    body = (text or "").strip()
    if not body:
        return ""

    try:
        response = await generate(
            [_SUMMARY_PROMPT, body[:_SUMMARY_INPUT_CAP]],
            **({"model": model} if model else {"purpose": "curriculum_summary"}),
        )
    except Exception as exc:
        log.warning("Curriculum summary generation failed: %s", exc)
        return ""

    return (response.text or "").strip()[:_SUMMARY_OUTPUT_CAP]
