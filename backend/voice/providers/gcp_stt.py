"""Google Cloud Speech-to-Text provider.

Wraps `google-cloud-speech` 2.x (the v1 ``recognize`` surface). The recognition
model (e.g. ``latest_long``) is encoded in the provider name (``gcp_latest_long``),
mirroring how ``gcp_tts`` encodes the voice tier in its name.

Auth: Application Default Credentials (same as gcp_tts). Locally:
    gcloud auth application-default login
On Cloud Run the backend SA is picked up automatically.

**Transcript-only.** The audio bytes are consumed in-process for the single
``recognize()`` call and never persisted — voice-in (talk-to-type) keeps the
1.1.11 dictation posture. Lesson RECORDING (raw audio retained for research)
is a *separate* route (`/api/voice/recording`), not this provider.
"""

from __future__ import annotations

import asyncio
import io
import logging
import wave

from google.cloud import speech

from voice.base import VoiceCapabilities

logger = logging.getLogger(__name__)

# Short BCP-47 -> full BCP-47 with region (mirrors gcp_tts._LANG_DEFAULTS).
# Anything not in the map is passed through, so callers may use full forms.
_LANG_DEFAULTS = {
    "da": "da-DK",
    "en": "en-US",
    "sv": "sv-SE",
    "no": "nb-NO",
    "fi": "fi-FI",
    "de": "de-DE",
    "fr": "fr-FR",
}

# Sync recognize() caps at ~1 min / ~10 MB; talk-to-type utterances are short.
# Longer audio (lesson recording) does not come through this path.
_MAX_AUDIO_BYTES = 10 * 1024 * 1024


def _normalize_lang(lang: str) -> str:
    if not lang:
        return "da-DK"
    return _LANG_DEFAULTS.get(lang.lower(), lang)


def _encoding_for(mime: str):
    """Map an inbound MIME to the Cloud Speech encoding enum. The browser's
    MediaRecorder default is webm/opus; ENCODING_UNSPECIFIED lets the API sniff
    when we genuinely don't know."""
    enc = speech.RecognitionConfig.AudioEncoding
    m = (mime or "").lower()
    if "webm" in m or "opus" in m:
        return enc.WEBM_OPUS
    if "ogg" in m:
        return enc.OGG_OPUS
    if "wav" in m or "l16" in m or "linear" in m:
        return enc.LINEAR16
    if "flac" in m:
        return enc.FLAC
    return enc.ENCODING_UNSPECIFIED


def _wav_pcm(audio: bytes) -> tuple[bytes, int, int] | None:
    """If ``audio`` is a RIFF/WAV (the capture path now sends 16 kHz LINEAR16
    WAV — see frontend audioCapture.ts), return (headerless PCM frames, sample
    rate, channels). The browser captures at a known supported rate, so we hand
    Cloud Speech raw LINEAR16 + the real rate rather than letting it sniff a
    container (which is how the old WEBM_OPUS path tripped on 44.1 kHz). Returns
    None when the bytes aren't WAV, so non-WAV inputs fall back to MIME sniffing."""
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        return None
    try:
        with wave.open(io.BytesIO(audio), "rb") as wf:
            return wf.readframes(wf.getnframes()), wf.getframerate(), wf.getnchannels()
    except (wave.Error, EOFError) as exc:
        logger.warning("WAV parse failed, falling back to container sniff: %s", exc)
        return None


class GCPSTTProvider:
    """Cloud Speech-to-Text provider. One instance per recognition model.

    The model (``"latest_long"``, ``"latest_short"``, …) is chosen at
    construction; the registry passes it from the provider name
    (``gcp_latest_long`` -> model=``"latest_long"``).
    """

    name: str

    def __init__(self, model: str = "latest_long", *, client: speech.SpeechClient | None = None):
        self.model = model or "latest_long"
        self.name = f"gcp_{self.model}"
        # Lazy: the SpeechClient opens a gRPC channel + resolves ADC, which is
        # wasteful to do at import/registry time. Tests inject a fake client.
        self._client = client

    def _get_client(self) -> speech.SpeechClient:
        if self._client is None:
            self._client = speech.SpeechClient()
        return self._client

    async def transcribe(self, audio: bytes, mime: str, lang: str, extras: dict | None) -> str:
        if not audio:
            return ""
        if len(audio) > _MAX_AUDIO_BYTES:
            raise ValueError(f"audio too large: {len(audio)} bytes > {_MAX_AUDIO_BYTES}")
        lang_full = _normalize_lang(lang)
        enc = speech.RecognitionConfig.AudioEncoding

        wav = _wav_pcm(audio)
        if wav is not None:
            pcm, rate, channels = wav
            config = speech.RecognitionConfig(
                encoding=enc.LINEAR16,
                sample_rate_hertz=rate,
                audio_channel_count=max(1, channels),
                language_code=lang_full,
                model=self.model,
                enable_automatic_punctuation=True,
            )
            rec_audio = speech.RecognitionAudio(content=pcm)
        else:
            config = speech.RecognitionConfig(
                encoding=_encoding_for(mime),
                language_code=lang_full,
                model=self.model,
                enable_automatic_punctuation=True,
            )
            rec_audio = speech.RecognitionAudio(content=audio)

        def _call() -> str:
            resp = self._get_client().recognize(config=config, audio=rec_audio)
            parts = [r.alternatives[0].transcript for r in resp.results if r.alternatives]
            return " ".join(p.strip() for p in parts if p and p.strip()).strip()

        try:
            return await asyncio.to_thread(_call)
        except Exception as exc:
            logger.warning("gcp stt transcribe failed (model=%s lang=%s): %s", self.model, lang_full, exc)
            raise RuntimeError(f"STT failed: {exc}") from exc

    def describe(self) -> VoiceCapabilities:
        return {
            "tts": False,
            "stt": True,
            "streaming": False,
            "languages": ["da", "en", "sv", "no", "fi", "de", "fr"],
        }
