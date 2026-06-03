"""Tests for the voice provider registry selection chain."""

import pytest

from voice import get_stt, get_tts
from voice.base import STTProvider, TTSProvider
from voice.providers.null import NullSTTProvider, NullTTSProvider


class _FakeSkillVoice:
    """Minimal stand-in for SkillVoiceConfig (lands fully in M-A6)."""

    def __init__(self, tts_provider: str | None = None, stt_provider: str | None = None):
        self.tts_provider = tts_provider
        self.stt_provider = stt_provider


class _FakeSkillConfig:
    """Minimal stand-in for SkillConfig with the optional .voice block."""

    def __init__(self, voice: _FakeSkillVoice | None = None):
        self.voice = voice


def test_registry_falls_back_to_browser_for_tts(monkeypatch):
    monkeypatch.delenv("VOICE_TTS_PROVIDER", raising=False)
    provider = get_tts()
    assert isinstance(provider, TTSProvider)
    assert provider.name == "browser"


def test_registry_falls_back_to_disabled_for_stt(monkeypatch):
    monkeypatch.delenv("VOICE_STT_PROVIDER", raising=False)
    provider = get_stt()
    assert isinstance(provider, STTProvider)
    # Disabled == NullSTTProvider
    assert isinstance(provider, NullSTTProvider)


def test_env_overrides_default_for_tts(monkeypatch):
    monkeypatch.setenv("VOICE_TTS_PROVIDER", "null")
    provider = get_tts()
    assert isinstance(provider, NullTTSProvider)


def test_env_overrides_default_for_stt(monkeypatch):
    monkeypatch.setenv("VOICE_STT_PROVIDER", "null")
    provider = get_stt()
    assert isinstance(provider, NullSTTProvider)


def test_skill_config_overrides_env_for_tts(monkeypatch):
    monkeypatch.setenv("VOICE_TTS_PROVIDER", "browser")  # env says browser
    skill = _FakeSkillConfig(voice=_FakeSkillVoice(tts_provider="null"))  # skill says null
    provider = get_tts(skill)
    assert isinstance(provider, NullTTSProvider)


def test_skill_config_overrides_env_for_stt(monkeypatch):
    monkeypatch.setenv("VOICE_STT_PROVIDER", "disabled")
    skill = _FakeSkillConfig(voice=_FakeSkillVoice(stt_provider="null"))
    provider = get_stt(skill)
    assert isinstance(provider, NullSTTProvider)


def test_skill_config_without_voice_block_falls_through(monkeypatch):
    monkeypatch.setenv("VOICE_TTS_PROVIDER", "null")
    # Skill exists but has no voice block (legacy skill).
    skill = _FakeSkillConfig(voice=None)
    provider = get_tts(skill)
    # Env wins because skill.voice is None.
    assert isinstance(provider, NullTTSProvider)


def test_unknown_tts_provider_raises_clearly(monkeypatch):
    monkeypatch.setenv("VOICE_TTS_PROVIDER", "nonexistent_provider")
    with pytest.raises(ValueError, match="Unknown TTS provider"):
        get_tts()


def test_unknown_stt_provider_raises_clearly(monkeypatch):
    monkeypatch.setenv("VOICE_STT_PROVIDER", "nonexistent_provider")
    with pytest.raises(ValueError, match="Unknown STT provider"):
        get_stt()


def test_skill_config_none_uses_env_or_default():
    """`get_tts(None)` is equivalent to `get_tts()` — no AttributeError."""
    # Should not raise.
    provider = get_tts(skill_config=None)
    assert isinstance(provider, TTSProvider)
