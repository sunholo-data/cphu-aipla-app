"""Unit tests for GCPSTTProvider (VOICE-IN-REC M1) — mocked Speech client."""

from __future__ import annotations

import asyncio
import io
import wave
from types import SimpleNamespace

import pytest
from google.cloud import speech

from voice.providers.gcp_stt import GCPSTTProvider, _encoding_for, _normalize_lang
from voice.registry import _build_stt


def _wav_bytes(pcm: bytes, rate: int = 16000, channels: int = 1) -> bytes:
    """A minimal mono 16-bit WAV wrapping ``pcm`` — mirrors the frontend's
    encodeWav output that the capture path now uploads."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(pcm)
    return buf.getvalue()


def _fake_resp(*transcripts: str):
    results = [SimpleNamespace(alternatives=[SimpleNamespace(transcript=t)]) for t in transcripts]
    return SimpleNamespace(results=results)


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp
        self.calls: list = []
        self.long_calls: list = []

    def recognize(self, config=None, audio=None):
        self.calls.append((config, audio))
        return self._resp

    def long_running_recognize(self, config=None, audio=None):
        self.long_calls.append((config, audio))
        resp = self._resp
        return SimpleNamespace(result=lambda timeout=None: resp)


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


def test_alternative_language_codes_set_for_codeswitch_both_branches():
    # RAQ-1 M2: da-DK primary -> en-US alternate (and vice versa), on BOTH the
    # WAV/LINEAR16 branch and the container-sniff (webm) fallback branch.
    wav = _wav_bytes(b"\x01\x00\x02\x00", rate=16000)
    client = _FakeClient(_fake_resp("hej"))
    asyncio.run(GCPSTTProvider(client=client).transcribe(wav, "audio/wav", "da", None))
    assert list(client.calls[0][0].alternative_language_codes) == ["en-US"]

    client2 = _FakeClient(_fake_resp("hi"))
    asyncio.run(GCPSTTProvider(client=client2).transcribe(b"webm", "audio/webm;codecs=opus", "en", None))
    assert list(client2.calls[0][0].alternative_language_codes) == ["da-DK"]


def test_wav_sent_as_linear16_with_header_rate_and_stripped_pcm():
    pcm = b"\x01\x00\x02\x00\x03\x00\x04\x00"  # 4 int16 frames
    wav = _wav_bytes(pcm, rate=16000, channels=1)
    client = _FakeClient(_fake_resp("hej"))
    p = GCPSTTProvider(client=client)
    out = asyncio.run(p.transcribe(wav, "audio/wav", "da", None))
    assert out == "hej"
    cfg, audio = client.calls[0]
    # WAV header is parsed: LINEAR16 + the real rate, NOT the container-sniff path.
    assert cfg.encoding == speech.RecognitionConfig.AudioEncoding.LINEAR16
    assert cfg.sample_rate_hertz == 16000
    assert cfg.audio_channel_count == 1
    # The RIFF header is stripped — STT gets the raw PCM frames only.
    assert audio.content == pcm


def test_transcribe_long_uses_long_running_recognize_and_joins():
    pcm = b"\x01\x00\x02\x00"
    wav = _wav_bytes(pcm, rate=16000, channels=1)
    client = _FakeClient(_fake_resp("lang ", "running"))
    p = GCPSTTProvider(client=client)
    out = asyncio.run(p.transcribe_long(wav, "audio/wav", "da", None))
    assert out == "lang running"
    # used the long-running surface (no ~1-min sync cap), not sync recognize
    assert client.calls == [] and len(client.long_calls) == 1
    cfg, audio = client.long_calls[0]
    assert cfg.encoding == speech.RecognitionConfig.AudioEncoding.LINEAR16
    assert cfg.sample_rate_hertz == 16000
    assert audio.content == pcm


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
