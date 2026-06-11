"""Unit tests for GCPSTTProvider (VOICE-IN-REC M1) — mocked Speech client."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from google.cloud import speech

from voice.providers.gcp_stt import GCPSTTProvider, _encoding_for, _normalize_lang
from voice.registry import _build_stt


def _fake_resp(*transcripts: str):
    results = [SimpleNamespace(alternatives=[SimpleNamespace(transcript=t)]) for t in transcripts]
    return SimpleNamespace(results=results)


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp
        self.calls: list = []

    def recognize(self, config=None, audio=None):
        self.calls.append((config, audio))
        return self._resp


def test_name_and_describe():
    p = GCPSTTProvider(model="latest_long", client=_FakeClient(_fake_resp()))
    assert p.name == "gcp_latest_long"
    d = p.describe()
    assert d["stt"] is True and d["tts"] is False and d["streaming"] is False


def test_transcribe_joins_result_segments():
    client = _FakeClient(_fake_resp("hej ", "med dig"))
    p = GCPSTTProvider(client=client)
    out = asyncio.run(p.transcribe(b"audio-bytes", "audio/webm;codecs=opus", "da", None))
    assert out == "hej med dig"
    # the request carried the normalized lang + webm encoding
    cfg = client.calls[0][0]
    assert cfg.language_code == "da-DK"
    assert cfg.encoding == speech.RecognitionConfig.AudioEncoding.WEBM_OPUS


def test_empty_audio_returns_empty_string_without_calling_api():
    client = _FakeClient(_fake_resp())
    p = GCPSTTProvider(client=client)
    assert asyncio.run(p.transcribe(b"", "audio/webm", "da", None)) == ""
    assert client.calls == []


def test_too_large_audio_raises_valueerror():
    p = GCPSTTProvider(client=_FakeClient(_fake_resp()))
    with pytest.raises(ValueError):
        asyncio.run(p.transcribe(b"x" * (10 * 1024 * 1024 + 1), "audio/webm", "da", None))


def test_provider_error_wrapped_as_runtimeerror():
    class _Boom:
        def recognize(self, **_):
            raise RuntimeError("grpc down")

    p = GCPSTTProvider(client=_Boom())
    with pytest.raises(RuntimeError):
        asyncio.run(p.transcribe(b"x", "audio/webm", "da", None))


def test_lang_normalization():
    assert _normalize_lang("da") == "da-DK"
    assert _normalize_lang("en") == "en-US"
    assert _normalize_lang("da-DK") == "da-DK"  # idempotent on full form
    assert _normalize_lang("") == "da-DK"


def test_encoding_for_common_mimes():
    enc = speech.RecognitionConfig.AudioEncoding
    assert _encoding_for("audio/webm;codecs=opus") == enc.WEBM_OPUS
    assert _encoding_for("audio/ogg") == enc.OGG_OPUS
    assert _encoding_for("audio/wav") == enc.LINEAR16
    assert _encoding_for("application/octet-stream") == enc.ENCODING_UNSPECIFIED


def test_registry_builds_gcp_stt_from_name():
    p = _build_stt("gcp_latest_long")
    assert isinstance(p, GCPSTTProvider)
    assert p.name == "gcp_latest_long"
    assert p.model == "latest_long"
