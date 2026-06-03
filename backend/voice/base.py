"""Voice provider Protocols.

Defines the narrow interface that every TTS / STT provider implements.
Three methods total. Provider-specific quirks pass through the opaque
`extras: dict` parameter so the interface stays stable when we add
ElevenLabs SSML, Studio prosody, or self-hosted Whisper diarization.

Mirrors the ADR-003 four-tier model-selection pattern (`adk/agent.py`
`resolve_model`): an env / skill-config / default chain picks the
implementation, and the rest of the codebase only sees the Protocol.

See `voice-provider-abstraction.md` (SEQUENCE 1.1.11).
"""

from typing import Protocol, TypedDict, runtime_checkable


class VoiceCapabilities(TypedDict):
    """What a provider can do. Returned by `.describe()`.

    Frontend uses this (via `/api/voice/config`) to decide whether to
    render the read-aloud button, dictation button, or fall back to
    Web Speech. Backend uses it to refuse calls a provider can't serve
    before hitting the wire.
    """

    tts: bool
    stt: bool
    streaming: bool  # bidi audio (Gemini Live et al.); none of our v1 providers
    languages: list[str]  # BCP-47 tags the provider explicitly supports


@runtime_checkable
class TTSProvider(Protocol):
    """Text-to-speech provider. Implementations live in `voice/providers/`."""

    name: str
    """Registry key. Convention: lowercase, underscores. e.g. `"gcp_wavenet"`, `"browser"`."""

    async def synthesize(
        self,
        text: str,
        lang: str,
        voice: str | None,
        extras: dict | None,
    ) -> tuple[bytes, str]:
        """Synthesize `text` to audio bytes.

        Args:
            text: Plain text. The provider is responsible for any SSML
                escaping if needed; callers pass raw text.
            lang: BCP-47 language tag. Short form `"da"` / `"en"` is
                acceptable; providers normalize to their preferred form
                (e.g. `"da"` -> `"da-DK"` for GCP).
            voice: Provider-specific voice name (e.g. `"da-DK-Wavenet-A"`).
                `None` means "pick a sensible default for `lang`".
            extras: Opaque provider-specific config. e.g.
                `{"ssml": True}` for SSML input, `{"rate": 0.9}` for
                rate override. Providers must ignore unknown keys.

        Returns:
            `(audio_bytes, mime_type)` — e.g. `(b"\\xff\\xfb...", "audio/mpeg")`.

        Raises:
            ValueError: invalid `lang`, voice unknown to the provider, etc.
            RuntimeError: provider-side failure (API down, quota, etc.).
                The route layer translates to 503.
        """
        ...

    def describe(self) -> VoiceCapabilities:
        """Report what this provider can do. Pure; no I/O."""
        ...


@runtime_checkable
class STTProvider(Protocol):
    """Speech-to-text provider. Implementations live in `voice/providers/`."""

    name: str

    async def transcribe(
        self,
        audio: bytes,
        mime: str,
        lang: str,
        extras: dict | None,
    ) -> str:
        """Transcribe `audio` to plain text.

        Args:
            audio: Raw audio bytes. Typically MediaRecorder webm/opus
                from the browser. Providers that need transcoding do it
                internally.
            mime: MIME type of `audio`. e.g. `"audio/webm;codecs=opus"`.
            lang: BCP-47 language tag. See `TTSProvider.synthesize`.
            extras: Opaque provider-specific config. e.g.
                `{"diarization": True}` for speaker labels (future).

        Returns:
            Plain transcript text. No segments / timestamps in v1 — the
            interface stays narrow. Add a structured-output method on a
            follow-up doc if needed.

        Raises:
            ValueError: audio too long / too large / unsupported `lang`.
            RuntimeError: provider-side failure. Route layer -> 503.
        """
        ...

    def describe(self) -> VoiceCapabilities: ...
