"""Tests for SkillVoiceConfig + its integration into SkillConfig.

Verifies:
  - Frontmatter parsing via populate_by_name + camelCase aliases.
  - All four fields are optional (legacy skills without `voice:` still
    parse and registry falls through to env / default).
  - Rate validation: 0.25 <= rate <= 4.0 (Cloud TTS accepted range).
  - Registry picks up SkillConfig.voice overrides over env.
"""

import pytest

from db.models import SkillConfig, SkillVoiceConfig
from voice import get_tts
from voice.providers.null import NullTTSProvider


def test_skill_voice_config_parses_from_camel_case_aliases():
    cfg = SkillVoiceConfig.model_validate(
        {"ttsProvider": "gcp_wavenet", "ttsVoice": "da-DK-Wavenet-A", "sttProvider": "gemini_2.5-flash", "rate": 0.9}
    )
    assert cfg.tts_provider == "gcp_wavenet"
    assert cfg.tts_voice == "da-DK-Wavenet-A"
    assert cfg.stt_provider == "gemini_2.5-flash"
    assert cfg.rate == 0.9


def test_skill_voice_config_parses_from_snake_case_too():
    """populate_by_name=True lets the Python-name form work too."""
    cfg = SkillVoiceConfig.model_validate({"tts_provider": "gcp_wavenet", "tts_voice": "da-DK-Wavenet-A"})
    assert cfg.tts_provider == "gcp_wavenet"
    assert cfg.tts_voice == "da-DK-Wavenet-A"


def test_skill_voice_config_all_fields_optional():
    cfg = SkillVoiceConfig.model_validate({})
    assert cfg.tts_provider is None
    assert cfg.tts_voice is None
    assert cfg.stt_provider is None
    assert cfg.rate == 1.0


def test_skill_voice_config_rate_out_of_range_rejected():
    with pytest.raises(ValueError):
        SkillVoiceConfig.model_validate({"rate": 0.0})
    with pytest.raises(ValueError):
        SkillVoiceConfig.model_validate({"rate": 5.0})


def test_skill_voice_config_extra_field_forbidden():
    """Strict shape — typo'd field names should fail loudly, not silently drop."""
    with pytest.raises(ValueError):
        SkillVoiceConfig.model_validate({"ttsProviderr": "gcp_wavenet"})  # double-r


def test_skill_config_voice_block_defaults_to_none():
    """Legacy skill without `voice:` in frontmatter — no AttributeError."""
    cfg = SkillConfig(name="test-skill")
    assert cfg.voice is None


def test_skill_config_voice_block_parses_nested_from_frontmatter():
    """The whole point of the design: per-skill voice overrides."""
    cfg = SkillConfig.model_validate(
        {
            "name": "test-skill",
            "voice": {"ttsProvider": "gcp_wavenet", "ttsVoice": "da-DK-Wavenet-A"},
        }
    )
    assert cfg.voice is not None
    assert cfg.voice.tts_provider == "gcp_wavenet"
    assert cfg.voice.tts_voice == "da-DK-Wavenet-A"


def test_registry_picks_skill_voice_block_over_env(monkeypatch):
    monkeypatch.setenv("VOICE_TTS_PROVIDER", "browser")
    skill = SkillConfig.model_validate(
        {
            "name": "test-skill",
            "voice": {"ttsProvider": "null"},
        }
    )
    provider = get_tts(skill)
    # SkillConfig.voice.tts_provider="null" beats env="browser".
    assert isinstance(provider, NullTTSProvider)


def test_registry_falls_through_when_skill_voice_block_field_is_none(monkeypatch):
    """voice block present but tts_provider None -> fall through to env."""
    monkeypatch.setenv("VOICE_TTS_PROVIDER", "null")
    skill = SkillConfig.model_validate(
        {
            "name": "test-skill",
            "voice": {"ttsVoice": "da-DK-Wavenet-A"},  # only voice, no provider
        }
    )
    provider = get_tts(skill)
    # tts_provider=None falls through to env=null.
    assert isinstance(provider, NullTTSProvider)
