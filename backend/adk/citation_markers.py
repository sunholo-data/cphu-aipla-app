"""Strip Vertex RAG chunk labels (``[rag-source-N]``) from tutor text — 1.1.122.

Curriculum retrieval runs INSIDE Vertex (ADK attaches ``VertexAiRagRetrieval``
as a ``types.Retrieval`` request tool on Gemini 2+). Vertex labels each chunk it
puts in the model's context ``[rag-source-N]``, and ``gemini-3.5-flash-lite``
copies those labels into its answer like academic citations — 13% of tutor turns
in a 1st-year class on 2026-09-22, rendered as literal text and read aloud by
TTS. No prompt wording of ours produced the token, so no prompt wording can be
relied on to remove it; it is stripped here, on the way out.

ADK calls the after-model callback on every streamed chunk AND on the final
aggregated response (which is what the session store and the chat log keep). A
marker can straddle two chunks (``… effekt [rag-`` / ``source-1].``), so the
streaming side holds back a trailing fragment that could still become a marker
and prepends it to the next chunk. The final response is stripped whole.
"""

from __future__ import annotations

import re
from typing import Any

# Leading whitespace goes with the marker: "effekt [rag-source-1]." → "effekt."
MARKER_RE = re.compile(r"[ \t]*\[rag-source-\d+\]")

# A trailing fragment that could still grow into a marker: trailing spaces (a
# marker may follow them in the next chunk, and the space belongs to it), then
# optionally "[" followed by a prefix of "rag-source-" or "rag-source-" + digits.
_TAIL_RE = re.compile(r"[ \t]*(?:\[(?:r(?:a(?:g(?:-(?:s(?:o(?:u(?:r(?:c(?:e(?:-\d*)?)?)?)?)?)?)?)?)?)?)?)?$")


def strip_markers(text: str) -> str:
    """Remove every complete ``[rag-source-N]`` marker from ``text``."""
    if "[rag-source-" not in text:
        return text
    return MARKER_RE.sub("", text)


class MarkerStreamFilter:
    """Stateful filter for one model call's stream of text chunks."""

    def __init__(self) -> None:
        self._held = ""

    def feed(self, chunk: str) -> str:
        """Return the part of ``held + chunk`` that is safe to emit now."""
        text = strip_markers(self._held + chunk)
        tail = _TAIL_RE.search(text)
        if tail:
            self._held = text[tail.start() :]
            return text[: tail.start()]
        self._held = ""
        return text

    def flush(self) -> str:
        """Release whatever is held — the stream ended mid-fragment, so it was
        never a marker."""
        held, self._held = self._held, ""
        return held


def _text_parts(llm_response: Any) -> list[Any]:
    content = getattr(llm_response, "content", None)
    parts = getattr(content, "parts", None) or []
    return [p for p in parts if isinstance(getattr(p, "text", None), str) and not getattr(p, "thought", False)]


def make_marker_strip_callback():
    """An after-model callback that strips markers from streamed and final text.

    One filter per invocation, keyed by ``invocation_id``; the agent is rebuilt
    per request, so the map lives only as long as the request.
    """
    filters: dict[str, MarkerStreamFilter] = {}

    async def _after_model(callback_context: Any, llm_response: Any) -> None:
        parts = _text_parts(llm_response)
        if not parts:
            return
        key = str(getattr(callback_context, "invocation_id", "") or "")
        if getattr(llm_response, "partial", False):
            f = filters.setdefault(key, MarkerStreamFilter())
            for p in parts:
                p.text = f.feed(p.text)
            return
        # Final aggregated response: ADK builds it from the raw chunks, so it
        # still carries every marker. Strip whole; drop the stream state.
        filters.pop(key, None)
        for p in parts:
            p.text = strip_markers(p.text)

    return _after_model
