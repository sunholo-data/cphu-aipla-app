"""No-op voice providers — for tests and explicit-disable config."""

from backend.voice.base import VoiceCapabilities


class NullTTSProvider:
    """TTS provider that always raises. Used in tests + when env says `null`."""

    name = "null"

    async def synthesize(
        self,
        text: str,
        lang: str,
        voice: str | None,
        extras: dict | None,
    ) -> tuple[bytes, str]:
        raise RuntimeError("NullTTSProvider.synthesize called; this provider is intentionally disabled.")

    def describe(self) -> VoiceCapabilities:
        return VoiceCapabilities(tts=False, stt=False, streaming=False, languages=[])


class NullSTTProvider:
    """STT provider that always raises. Used for `disabled` and tests."""

    name = "null"

    async def transcribe(
        self,
        audio: bytes,
        mime: str,
        lang: str,
        extras: dict | None,
    ) -> str:
        raise RuntimeError("NullSTTProvider.transcribe called; this provider is intentionally disabled.")

    def describe(self) -> VoiceCapabilities:
        return VoiceCapabilities(tts=False, stt=False, streaming=False, languages=[])
