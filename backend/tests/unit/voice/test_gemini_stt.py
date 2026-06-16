"""Unit tests for GeminiSTTProvider (RAQ-1 M1) — mocked genai client.

The 16 June demo spike showed Cloud STT v1 single-language garbled the
Danish/English classroom audio; Gemini transcribed it accurately. This provider
makes Gemini a swap-in STT engine (`VOICE_STT_PROVIDER=gemini_3.5-flash`).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from voice.providers.gemini_stt import _MAX_INLINE_BYTES, GeminiSTTProvider
from voice.registry import _build_stt


class _FakeModels:
    def __init__(self, text: str):
        self._text = text
        self.calls: list = []

    async def generate_content(self, model=None, contents=None, config=None):
        self.calls.append(SimpleNamespace(model=model, contents=contents, config=config))
        return SimpleNamespace(text=self._text)


class _FakeGenaiClient:
    def __init__(self, text: str = "hej med dig"):
        self.aio = SimpleNamespace(models=_FakeModels(text))


def test_name_describe_and_model_id():
    p = GeminiSTTProvider(model="3.5-flash", client=_FakeGenaiClient())
    assert p.name == "gemini_3.5-flash"
    assert p.model == "gemini-3.5-flash"  # short form reconstructed to the real id
    d = p.describe()
    assert d["stt"] is True and d["tts"] is False and d["streaming"] is False
    assert "da" in d["languages"] and "en" in d["languages"]


def test_model_id_accepts_full_form_too():
    # passing the full "gemini-3.5-flash" must not double-prefix
    p = GeminiSTTProvider(model="gemini-3.5-flash", client=_FakeGenaiClient())
    assert p.model == "gemini-3.5-flash"
    assert p.name == "gemini_3.5-flash"


def test_transcribe_sends_audio_and_grounding_prompt():
    client = _FakeGenaiClient("the trajectory is steep")
    p = GeminiSTTProvider(model="3.5-flash", client=client)
    out = asyncio.run(p.transcribe(b"RIFF....wavbytes", "audio/wav", "da", None))
    assert out == "the trajectory is steep"
    call = client.aio.models.calls[0]
    assert call.model == "gemini-3.5-flash"
    # contents = [audio Part, grounding prompt]
    assert len(call.contents) == 2
    audio_part, prompt = call.contents
    assert not isinstance(audio_part, str)  # the audio Part, not text
    assert isinstance(prompt, str)
    low = prompt.lower()
    assert "verbatim" in low and "danish" in low and "english" in low


def test_transcribe_long_delegates_to_transcribe():
    client = _FakeGenaiClient("lang running")
    p = GeminiSTTProvider(client=client)
    out = asyncio.run(p.transcribe_long(b"wavbytes", "audio/wav", "da", None))
    assert out == "lang running"
    assert len(client.aio.models.calls) == 1


def test_empty_audio_returns_empty_without_calling():
    client = _FakeGenaiClient()
    p = GeminiSTTProvider(client=client)
    assert asyncio.run(p.transcribe(b"", "audio/wav", "da", None)) == ""
    assert client.aio.models.calls == []


def test_too_large_audio_raises_valueerror():
    p = GeminiSTTProvider(client=_FakeGenaiClient())
    with pytest.raises(ValueError):
        asyncio.run(p.transcribe(b"x" * (_MAX_INLINE_BYTES + 1), "audio/wav", "da", None))


def test_provider_error_wrapped_as_runtimeerror():
    class _Boom:
        def __init__(self):
            self.aio = SimpleNamespace(models=self)

        async def generate_content(self, **_):
            raise RuntimeError("vertex down")

    p = GeminiSTTProvider(client=_Boom())
    with pytest.raises(RuntimeError):
        asyncio.run(p.transcribe(b"wav", "audio/wav", "da", None))


def test_registry_builds_gemini_stt_from_name():
    # explicit override: VOICE_STT_PROVIDER=gemini_<model>
    p = _build_stt("gemini_3.5-flash")
    assert isinstance(p, GeminiSTTProvider)
    assert p.name == "gemini_3.5-flash"
    assert p.model == "gemini-3.5-flash"


def test_bare_gemini_uses_config_default_model():
    # VOICE_STT_PROVIDER=gemini -> model from config/models.yaml platform_default.
    # The point of the RAQ-1 config-driven fix: no model version pinned in STT code.
    from config.models import load_models_config

    cfg = load_models_config()
    expected = next(m.api_name for m in cfg.models if m.id == cfg.platform_default)
    p = _build_stt("gemini")
    assert isinstance(p, GeminiSTTProvider)
    assert p.name == "gemini"
    assert p.model == expected
