"""The tutor links the shared documents it cites — and only those (1.1.147 M3c).

M decided 2026-10-08: when the tutor names a document the student can open, it
writes a Markdown link ``[Title](aitana://doc/{docId}/block/0)``; the chat
renders that as a chip that opens the document in the workspace reader (M3b,
``frontend/src/components/workspace/documentRequest.tsx``).

Two halves, and the second is the one that matters:

1. **The prompt** (:func:`build_document_links_block`) lists the docIds of the
   activity's **student-visible** materials only. A not-shared document's id is
   never given to the model by this block.
2. **The guard** (:func:`make_document_link_guard`) is an after-model callback
   that rewrites the model's text on the way out: an ``aitana://doc/…`` link to
   anything NOT in the student-visible set is reduced to its label (plain text),
   and a bare ``aitana://doc/…`` URL to such a document is removed. The model
   can still produce one — from a docId it saw elsewhere, or by inventing one —
   so the prompt cannot be the control. ``student_visible`` is a copyright
   control (only cleared material may be shown to students), and a link is an
   invitation to open; the reader would refuse to show the content (M3a), but
   the student should not be handed the invitation in the first place.

Why an after-model callback rather than a filter on the SSE stream: ADK calls it
on every streamed chunk AND on the final aggregated response, and the final one
is what the session store keeps — so the live stream, the persisted history
(``GET /api/sessions/{id}/messages``), ``MESSAGES_SNAPSHOT`` and the proactive
turns are all covered by one rewrite. Same construction as
:mod:`adk.citation_markers`: a link can straddle two chunks, so the streaming
side holds back a trailing fragment that could still become a link, and
releases it on the next chunk or when the model reports it has finished.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from db.models.activity_config import ActivityConfig, MaterialRef

#: Kinds a student opens in the documents reader (images are not linked: they
#: open in the image strip, not the reader).
_READER_KINDS = frozenset({"curriculum", "context"})

#: Longest fragment held back while waiting to see whether it becomes a link.
#: Past this, an unclosed "[" is ordinary text (an interval "[0, 1)", a quote).
_MAX_HOLD = 300

_SCHEME = "aitana://"

# A link label: brackets may nest one level ("[Fysik [C]](…)"), as CommonMark allows.
_LABEL = r"(?:[^\[\]]|\[[^\[\]]*\])*"
# One aitana:// URL (inside a link destination or bare).
_URL = r"aitana://[^\s)>\]\"']*"

# Either a Markdown link whose destination is an aitana:// URL (optionally in
# <…>, optionally with a title), or a bare/autolinked aitana:// URL.
_LINK_OR_BARE_RE = re.compile(
    rf"\[(?P<label>{_LABEL})\]\(\s*<?(?P<url>{_URL})>?(?:\s+\"[^\"]*\")?\s*\)"
    rf"|<?(?P<bare>{_URL})>?",
    re.IGNORECASE,
)
_DOC_ID_RE = re.compile(r"^aitana://doc/([^/?#\s]+)(?:/block/[^/?#\s]*)?/?$", re.IGNORECASE)

# A Markdown link that is not finished yet: "[", a label (maybe unclosed), maybe
# "]", maybe "(" and destination characters without the closing ")".
# Possessive inner run, so a failed match cannot backtrack through every split.
_OPEN_LINK_PREFIX_RE = re.compile(r"\[(?:[^\[\]]|\[[^\[\]]*+\]?)*(?:\](?:\([^)]*)?)?")


def shared_document_ids(materials: Iterable[MaterialRef] | None) -> frozenset[str]:
    """The docIds a student may be linked to: student-visible reader materials."""
    return frozenset(
        m.doc_id
        for m in materials or []
        if getattr(m, "student_visible", False) and getattr(m, "kind", "curriculum") in _READER_KINDS and m.doc_id
    )


def _doc_id(url: str) -> str | None:
    m = _DOC_ID_RE.match(url)
    return m.group(1) if m else None


def strip_unshared_doc_links(text: str, allowed: frozenset[str] | set[str]) -> str:
    """Reduce every ``aitana://`` link that does not target a shared document.

    - ``[Label](aitana://doc/<shared>/block/0)`` → unchanged.
    - ``[Label](aitana://doc/<anything else>/…)`` → ``Label``.
    - A bare or ``<…>`` ``aitana://`` URL to anything else → removed.

    Any other ``aitana://`` form (not a document) is treated like a not-shared
    one: the student chat only ever opens documents through this scheme.
    """
    if _SCHEME not in text.lower():
        return text

    def _replace(m: re.Match[str]) -> str:
        url = m.group("url")
        if url is not None:
            doc = _doc_id(url)
            return m.group(0) if doc is not None and doc in allowed else m.group("label")
        # A bare URL at the end of a sentence swallows the full stop; give the
        # sentence its punctuation back (the GFM autolink rule).
        bare = m.group("bare")
        url = bare.rstrip(".,:;!?")
        trailing = bare[len(url) :]
        doc = _doc_id(url)
        if doc is not None and doc in allowed:
            return m.group(0)
        return trailing if not m.group(0).endswith(">") else ""

    return _LINK_OR_BARE_RE.sub(_replace, text)


def _hold_start(text: str) -> int:
    """Index from which ``text`` must be held back (``len(text)`` = nothing).

    Two shapes can still grow into a link the next chunk completes: an unclosed
    Markdown link, and a trailing word that is (a prefix of) a bare URL.
    """
    start = len(text)
    window_from = max(0, len(text) - _MAX_HOLD)
    # The EARLIEST "[" in the window from which the rest is still an open link,
    # so a nested "[" inside a label cannot hide its outer link.
    i = text.find("[", window_from)
    while i != -1:
        if _OPEN_LINK_PREFIX_RE.fullmatch(text, i):
            start = i
            break
        i = text.find("[", i + 1)
    # A trailing word that is, or is becoming, a bare aitana:// URL. Only at a
    # word start (or after "<" / "("), so "data" never holds its last "a".
    tail = re.search(r"[<(]?\S*$", text)
    if tail:
        run_start = tail.start()
        run = text[run_start:]
        lead = 1 if run[:1] in ("<", "(") else 0
        word = run[lead:].lower()
        if word and (word.startswith(_SCHEME) or _SCHEME.startswith(word)):
            start = min(start, run_start)
    return start


class DocLinkStreamFilter:
    """Stateful filter for one model call's stream of text chunks."""

    def __init__(self, allowed: frozenset[str] | set[str]) -> None:
        self._allowed = allowed
        self._held = ""

    def feed(self, chunk: str) -> str:
        """Return the part of ``held + chunk`` that is safe to emit now."""
        text = self._held + chunk
        cut = _hold_start(text)
        self._held = text[cut:]
        return strip_unshared_doc_links(text[:cut], self._allowed)

    def flush(self) -> str:
        """Release what is held, rewritten — the stream ended, so it is whole."""
        held, self._held = self._held, ""
        return strip_unshared_doc_links(held, self._allowed)


def _text_parts(llm_response: Any) -> list[Any]:
    content = getattr(llm_response, "content", None)
    parts = getattr(content, "parts", None) or []
    return [p for p in parts if isinstance(getattr(p, "text", None), str) and not getattr(p, "thought", False)]


def _append_text(llm_response: Any, text: str) -> None:
    """Attach released text to a chunk that carried none (a bare finish chunk)."""
    from google.genai import types

    content = getattr(llm_response, "content", None)
    if content is None:
        llm_response.content = types.Content(role="model", parts=[types.Part(text=text)])
    else:
        content.parts = [*(content.parts or []), types.Part(text=text)]


def make_document_link_guard(allowed: frozenset[str] | set[str]):
    """An after-model callback that keeps not-shared document links out of a reply.

    One filter per invocation, keyed by ``invocation_id``; the agent is rebuilt
    per request, so the map lives only as long as the request.
    """
    filters: dict[str, DocLinkStreamFilter] = {}
    allowed = frozenset(allowed)

    async def _after_model(callback_context: Any, llm_response: Any) -> None:
        key = str(getattr(callback_context, "invocation_id", "") or "")
        parts = _text_parts(llm_response)
        if getattr(llm_response, "partial", False):
            f = filters.get(key)
            if parts:
                f = filters.setdefault(key, DocLinkStreamFilter(allowed))
                for p in parts:
                    p.text = f.feed(p.text)
            # The model's last streamed chunk: nothing more is coming to
            # complete a held fragment, and ag_ui_adk skips the consolidated
            # response while it is streaming — so release it HERE or the live
            # bubble would lose its last characters.
            if f is not None and getattr(llm_response, "finish_reason", None):
                rest = f.flush()
                if rest:
                    if parts:
                        parts[-1].text += rest
                    else:
                        _append_text(llm_response, rest)
            return
        # Final aggregated response: ADK builds it from the RAW chunks, so it
        # still carries every link. Rewrite whole; drop the stream state.
        filters.pop(key, None)
        for p in parts:
            p.text = strip_unshared_doc_links(p.text, allowed)

    return _after_model


_LINKS_BLOCK = """

## Documents the student can open
These documents are shared with the student and open in their workspace. When \
you mention one, link it so the student can open it with one click, written \
exactly as shown (keep the title as the link text):
{links}
Link only these. Never write an aitana:// link to any other document — other \
material is for you, and the student cannot open it; name it in plain words if \
you need to.
"""


def build_document_links_block(cfg: ActivityConfig | None) -> str:
    """The prompt block giving the tutor the student-visible docIds to link.

    ``""`` when there is no activity or nothing is shared, so such activities
    compose byte-identically to before.
    """
    if cfg is None:
        return ""
    allowed = shared_document_ids(cfg.materials)
    rows = []
    for m in cfg.materials or []:
        if m.doc_id not in allowed:
            continue
        title = (m.title or m.origin or "dokument").strip().replace("[", "(").replace("]", ")")
        rows.append(f"- [{title}](aitana://doc/{m.doc_id}/block/0)")
    if not rows:
        return ""
    # One row per document even if a material is attached twice.
    return _LINKS_BLOCK.format(links="\n".join(dict.fromkeys(rows)))


__all__ = [
    "DocLinkStreamFilter",
    "build_document_links_block",
    "make_document_link_guard",
    "shared_document_ids",
    "strip_unshared_doc_links",
]
