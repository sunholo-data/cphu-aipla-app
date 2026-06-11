"""Image injection for multimodal chat turns (1.1.7).

Student photos ride the AG-UI turn as base64 in ``forwardedProps.attachments``.
This ``before_model_callback`` decodes them and injects a user ``Content``
carrying image ``Part(inline_data=Blob(...))`` into the LLM request — mirroring
``make_document_injector``, but for raw images that go to Gemini's vision.
(Documents — docx/pdf/… — do NOT come here; they route through the docparse
``/api/documents/upload`` pipeline. This callback is images only.)

NON-RETENTION (the whole point): image bytes are **never persisted**. They live
only in a process-local transient cache (``_PENDING``) keyed by a per-turn
token; the callback injects them into ``llm_request.contents`` (rebuilt from
events each turn and NOT persisted) and then pops the cache. The token (a uuid
string) is the only thing that touches session state.
"""

from __future__ import annotations

import base64
import binascii
import logging
from collections import OrderedDict
from typing import Any

logger = logging.getLogger(__name__)

# Process-local, transient. token -> list[{"mimeType","data"(base64),"name"}].
# Bytes never leave this dict + never persist. Capped FIFO so an errored run
# (token stashed, callback never reached) cannot leak unboundedly.
_PENDING: OrderedDict[str, list[dict[str, Any]]] = OrderedDict()
_PENDING_CAP = 128

_STATE_TOKEN = "image_attach_token"
_ALLOWED_IMAGE_MIME = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
_MAX_ATTACHMENTS = 4


def stash_attachments(token: str, attachments: list[dict[str, Any]]) -> None:
    """Stash a turn's image attachments under a token (process-local, transient)."""
    if len(_PENDING) >= _PENDING_CAP:
        _PENDING.popitem(last=False)  # evict oldest orphan
    _PENDING[token] = attachments


def _pop(token: str) -> list[dict[str, Any]] | None:
    return _PENDING.pop(token, None)


def make_image_injector() -> Any:
    """Return a ``before_model_callback`` that injects this turn's image
    attachments into the LLM request as Gemini vision Parts, then clears them
    (one-shot, non-retaining)."""

    async def _injector(callback_context: Any, llm_request: Any) -> None:
        state = getattr(callback_context, "state", None)
        if state is None:
            return
        token = state.get(_STATE_TOKEN)
        if not token:
            return
        # One-shot: pop so a round-tripped token (state is one turn behind)
        # can never re-inject a prior turn's image.
        attachments = _pop(token)
        if not attachments:
            return

        contents = getattr(llm_request, "contents", None)
        if not contents:
            return
        last = contents[-1]
        if getattr(last, "role", None) != "user":
            return
        last_parts = getattr(last, "parts", None) or []
        if any(getattr(p, "function_response", None) for p in last_parts):
            return  # mid-turn tool round-trip — don't inject

        from google.genai.types import Blob, Content, Part

        parts: list[Any] = []
        for att in attachments[:_MAX_ATTACHMENTS]:
            mime = str(att.get("mimeType") or "").lower()
            if mime not in _ALLOWED_IMAGE_MIME:
                logger.info("image injector: skip non-image mime=%r", mime)
                continue
            try:
                raw = base64.b64decode(att.get("data") or "", validate=True)
            except (binascii.Error, ValueError) as exc:
                logger.warning("image injector: bad base64 (mime=%s): %s", mime, exc)
                continue
            if not raw:
                continue
            parts.append(Part(inline_data=Blob(data=raw, mime_type=mime)))

        if not parts:
            return

        # A separate user Content holding the image(s), inserted right before
        # the student's text turn — mirrors make_document_injector. Gemini
        # associates consecutive user contents.
        contents.insert(-1, Content(role="user", parts=parts))
        logger.info(
            "image injector: injected %d image part(s) (metadata-only log; bytes not persisted)",
            len(parts),
        )

    return _injector


__all__ = ["make_image_injector", "stash_attachments"]
