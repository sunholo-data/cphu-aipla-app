"""Voice provider abstraction — TTS + STT behind swappable backends.

Public surface:
    `TTSProvider`, `STTProvider` — Protocol classes.
    `VoiceCapabilities` — what a provider supports.
    `get_tts(skill_config=None)` / `get_stt(skill_config=None)` — resolve
        an implementation from SkillConfig > env > default.

See `voice-provider-abstraction.md` (SEQUENCE 1.1.11) for the rationale.
"""

from backend.voice.base import STTProvider, TTSProvider, VoiceCapabilities
from backend.voice.registry import get_stt, get_tts

__all__ = [
    "STTProvider",
    "TTSProvider",
    "VoiceCapabilities",
    "get_stt",
    "get_tts",
]
