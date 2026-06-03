"""Voice provider registry.

Resolution chain (highest precedence first):
    1. SkillConfig.voice.{tts_provider,stt_provider}
    2. Env var VOICE_TTS_PROVIDER / VOICE_STT_PROVIDER
    3. Default ("browser" for TTS, "disabled" for STT)

Mirrors `backend/adk/agent.py:resolve_model` — explicit string dispatch,
no clever registration decorators, easy to grep for "which providers
exist". When a new provider lands in `voice/providers/`, add one branch
here.
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

from voice.base import STTProvider, TTSProvider
from voice.providers.null import NullSTTProvider, NullTTSProvider

if TYPE_CHECKING:
    from backend.db.models import SkillConfig

logger = logging.getLogger(__name__)


_TTS_DEFAULT = "browser"
_STT_DEFAULT = "disabled"


def get_tts(skill_config: SkillConfig | None = None) -> TTSProvider:
    """Resolve the TTS provider for this request.

    Args:
        skill_config: Optional. If supplied and its `voice.tts_provider`
            field is set, that wins. Otherwise falls through to env /
            default.

    Returns:
        A `TTSProvider` instance.

    Raises:
        ValueError: if a configured provider name is unknown.
    """
    name = _resolve_name(
        skill_value=_skill_voice_field(skill_config, "tts_provider"),
        env_var="VOICE_TTS_PROVIDER",
        default=_TTS_DEFAULT,
    )
    return _build_tts(name)


def get_stt(skill_config: SkillConfig | None = None) -> STTProvider:
    """Resolve the STT provider for this request. Same chain as `get_tts`."""
    name = _resolve_name(
        skill_value=_skill_voice_field(skill_config, "stt_provider"),
        env_var="VOICE_STT_PROVIDER",
        default=_STT_DEFAULT,
    )
    return _build_stt(name)


# --- helpers ---


def _resolve_name(skill_value: str | None, env_var: str, default: str) -> str:
    """Pick provider name from skill_value > env > default."""
    if skill_value:
        return skill_value
    env = os.getenv(env_var)
    if env:
        return env
    return default


def _skill_voice_field(skill_config: SkillConfig | None, field: str) -> str | None:
    """Read `skill_config.voice.<field>` defensively.

    `voice` is an optional Pydantic block added in M-A6; if a skill predates
    that field this stays None.
    """
    if skill_config is None:
        return None
    voice = getattr(skill_config, "voice", None)
    if voice is None:
        return None
    return getattr(voice, field, None)


def _build_tts(name: str) -> TTSProvider:
    """String dispatch for TTS providers.

    Add new branches here as providers land in `voice/providers/`.
    """
    if name == "browser":
        # Imported lazily to keep tests free of GCP client construction
        # when they only need NullTTSProvider.
        from voice.providers.browser import BrowserTTSProvider

        return BrowserTTSProvider()
    if name == "null":
        return NullTTSProvider()
    if name.startswith("gcp_"):
        from voice.providers.gcp_tts import GCPTTSProvider

        return GCPTTSProvider(tier=name.removeprefix("gcp_"))
    raise ValueError(f"Unknown TTS provider {name!r}. Known: browser, null, gcp_<tier>.")


def _build_stt(name: str) -> STTProvider:
    """String dispatch for STT providers."""
    if name == "disabled":
        return NullSTTProvider()
    if name == "null":
        return NullSTTProvider()
    if name.startswith("gcp_"):
        from voice.providers.gcp_stt import GCPSTTProvider

        return GCPSTTProvider(model=name.removeprefix("gcp_"))
    raise ValueError(f"Unknown STT provider {name!r}. Known: disabled, null, gcp_<model>.")
