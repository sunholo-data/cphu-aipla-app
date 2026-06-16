"""Gemini speech-to-text provider (RAQ-1 M1).

Transcribes audio by handing the whole clip to a Gemini model with a grounding
prompt — *not* a classic ASR. The 16 June Jutland demo spike proved this on the
real classroom audio: Cloud STT v1 single-language returned 360 chars of garbage
on the Danish/English code-switched discussion; Gemini 2.5 Flash returned ~12k
chars, accurate, with the physics terms and the tutor's turns correct — and at
~8-16x lower cost. See research-audio-capture-quality.md (SEQUENCE 1.1.33).

Swap-shaped per ADR-003: this registers as a `gemini_<model>` STT provider, so
`VOICE_STT_PROVIDER=gemini_2.5-flash` routes the lesson-recording transcribe path
(`recording_routes._transcribe_segment_in_background`) through Gemini with no
route change. Cloud STT (`gcp_*`) stays the graceful-degradation fallback.

Auth: Application Default Credentials via Vertex (`genai.Client(vertexai=True)`),
the same pattern as `reports/narrative.py` and `tools/structured_extraction.py`.

**Inline only.** A 50 s capture segment is ~1.6 MB, well under the inline-request
ceiling. Whole-recording transcription of a full session (tens of MB) goes via a
GCS URI and is a separate route (RAQ-1 M6), not this per-segment path.
"""

from __future__ import annotations

import logging

from voice.base import VoiceCapabilities

logger = logging.getLogger(__name__)

# Gemini inline-request audio ceiling (the whole request must stay well under
# ~20 MB). Segments are ~1.6 MB; anything larger should use the GCS-URI path.
_MAX_INLINE_BYTES = 18 * 1024 * 1024

# Languages the grounding prompt is tuned for (Danish primary, English mixed in).
_LANGUAGES = ["da", "en", "sv", "no", "de", "fr"]

_PROMPT = (
    "You are transcribing a recording of a Danish upper-secondary physics lesson: "
    "a small group of students discussing physics, often with an AI tutor. They speak "
    "Danish and English and frequently switch mid-sentence — physics terms are usually "
    "English. Transcribe the audio VERBATIM. Keep each phrase in the language actually "
    "spoken; do NOT translate. Use punctuation. Put each speaker turn on its own line. "
    "Return ONLY the transcript text — no preamble, no commentary, no markdown."
)


class GeminiSTTProvider:
    """STT provider backed by a Gemini model. One instance per model.

    The model short form (``"2.5-flash"``) comes from the registry provider name
    (``gemini_2.5-flash`` -> model=``"2.5-flash"``) and is reconstructed to the
    real id ``gemini-2.5-flash``.
    """

    name: str

    def __init__(self, model: str = "2.5-flash", *, client=None):
        short = (model or "2.5-flash").removeprefix("gemini-")
        self.model = f"gemini-{short}"
        self.name = f"gemini_{short}"
        # Lazy: constructing the genai client resolves ADC + opens a channel,
        # wasteful at import/registry time. Tests inject a fake client.
        self._client = client

    def _get_client(self):
        if self._client is None:
            from google import genai

            self._client = genai.Client(vertexai=True)
        return self._client

    async def transcribe(self, audio: bytes, mime: str, lang: str, extras: dict | None) -> str:
        """Transcribe ``audio`` inline via Gemini. ``lang`` is advisory — the
        grounding prompt already handles Danish/English code-switching."""
        if not audio:
            return ""
        if len(audio) > _MAX_INLINE_BYTES:
            raise ValueError(
                f"audio too large for inline Gemini: {len(audio)} bytes > {_MAX_INLINE_BYTES} "
                "(use the GCS-URI whole-file path for full sessions)"
            )
        from google.genai import types

        client = self._get_client()
        try:
            resp = await client.aio.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_bytes(data=audio, mime_type=mime or "audio/wav"),
                    _PROMPT,
                ],
            )
            return (resp.text or "").strip()
        except Exception as exc:
            logger.warning("gemini stt failed (model=%s): %s", self.model, exc)
            raise RuntimeError(f"Gemini STT failed: {exc}") from exc

    async def transcribe_long(self, audio: bytes, mime: str, lang: str, extras: dict | None = None) -> str:
        """Gemini has no sync/long split — a single ``generate_content`` handles
        the whole clip. Mirrors the ``transcribe_long`` method the recording path
        calls on the Cloud STT provider, so the two are interchangeable."""
        return await self.transcribe(audio, mime, lang, extras)

    def describe(self) -> VoiceCapabilities:
        return {
            "tts": False,
            "stt": True,
            "streaming": False,
            "languages": list(_LANGUAGES),
        }
