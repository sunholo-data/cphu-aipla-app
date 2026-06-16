"""AI document extraction — the Gemini multimodal fallback for formats AILANG
Parse can't do deterministically (PDF, images).

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
import os

from config.models import default_model

log = logging.getLogger(__name__)

# Vertex Gemini model for AI extraction (config-driven; override via env).
PDF_PARSE_MODEL = os.environ.get("PDF_PARSE_MODEL") or default_model()

_EXTRACT_PROMPT = (
    "Extract ALL text from this document as clean Markdown. Preserve headings, "
    "lists, and tables in reading order. Do NOT summarise, translate, comment, "
    "or add anything — output only the document's own content."
)


async def extract_pdf_text(pdf_bytes: bytes, *, model: str | None = None) -> str:
    """Extract a PDF's text as Markdown via Gemini (Vertex). OCR-capable, so
    scanned PDFs work too.

    Raises:
        ValueError: extraction failed or produced no text.
    """
    from google import genai
    from google.genai import types as genai_types

    try:
        client = genai.Client(vertexai=True)
        response = await client.aio.models.generate_content(
            model=model or PDF_PARSE_MODEL,
            contents=[
                _EXTRACT_PROMPT,
                genai_types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            ],
        )
    except Exception as exc:
        log.warning("AI PDF extraction failed: %s", exc)
        raise ValueError("PDF extraction failed") from exc

    text = (response.text or "").strip()
    if not text:
        raise ValueError("PDF extraction returned no text")
    return text
