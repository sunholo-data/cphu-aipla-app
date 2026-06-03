"""Unit tests for GCPTTSProvider — mocks the Cloud TTS client.

The provider uses the sync google.cloud.texttospeech.TextToSpeechClient
wrapped in asyncio.to_thread (matching the cache + ailang_parse pattern),
so mocks use plain MagicMock (not AsyncMock).
"""

from unittest.mock import MagicMock

import pytest

from backend.voice.providers.gcp_tts import GCPTTSProvider


def _make_provider_with_mock_client(audio_content: bytes = b"\xff\xfb fake mp3") -> tuple[GCPTTSProvider, MagicMock]:
    """Build a GCPTTSProvider with an injected mock sync client."""
    response = MagicMock()
    response.audio_content = audio_content
    client = MagicMock()
    client.synthesize_speech = MagicMock(return_value=response)
    provider = GCPTTSProvider(tier="wavenet", client=client)
    return provider, client


def test_unsupported_tier_raises():
    with pytest.raises(ValueError, match="Unsupported GCP TTS tier"):
        GCPTTSProvider(tier="experimental_garbage")


def test_name_encodes_tier():
    provider = GCPTTSProvider(tier="wavenet", client=MagicMock())
    assert provider.name == "gcp_wavenet"

    provider = GCPTTSProvider(tier="standard", client=MagicMock())
    assert provider.name == "gcp_standard"


def test_describe_reports_tts_only():
    provider = GCPTTSProvider(tier="wavenet", client=MagicMock())
    caps = provider.describe()
    assert caps["tts"] is True
    assert caps["stt"] is False
    assert caps["streaming"] is False
    # Danish + English at minimum (the languages we ship).
    assert "da-DK" in caps["languages"]
    assert "en-US" in caps["languages"]


@pytest.mark.asyncio
async def test_synthesize_returns_audio_bytes_and_mime():
    provider, _ = _make_provider_with_mock_client(b"\xff\xfb hello")
    audio, mime = await provider.synthesize(text="Hej", lang="da", voice=None, extras=None)
    assert audio == b"\xff\xfb hello"
    assert mime == "audio/mpeg"


@pytest.mark.asyncio
async def test_synthesize_normalizes_short_lang_to_full_bcp47():
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Hej", lang="da", voice=None, extras=None)
    # Inspect the voice arg passed to synthesize_speech.
    voice_arg = client.synthesize_speech.call_args.kwargs["voice"]
    assert voice_arg.language_code == "da-DK"


@pytest.mark.asyncio
async def test_synthesize_passes_through_full_bcp47():
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Hej", lang="da-DK", voice=None, extras=None)
    voice_arg = client.synthesize_speech.call_args.kwargs["voice"]
    assert voice_arg.language_code == "da-DK"


@pytest.mark.asyncio
async def test_synthesize_uses_explicit_voice_when_given():
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Hej", lang="da", voice="da-DK-Wavenet-C", extras=None)
    voice_arg = client.synthesize_speech.call_args.kwargs["voice"]
    assert voice_arg.name == "da-DK-Wavenet-C"


@pytest.mark.asyncio
async def test_synthesize_picks_default_voice_when_none_given():
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Hej", lang="da", voice=None, extras=None)
    voice_arg = client.synthesize_speech.call_args.kwargs["voice"]
    # WaveNet default for Danish is da-DK-Wavenet-A.
    assert voice_arg.name == "da-DK-Wavenet-A"


@pytest.mark.asyncio
async def test_synthesize_passes_rate_from_extras():
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Hej", lang="da", voice=None, extras={"rate": 0.9})
    audio_config = client.synthesize_speech.call_args.kwargs["audio_config"]
    assert audio_config.speaking_rate == pytest.approx(0.9)


@pytest.mark.asyncio
async def test_synthesize_defaults_rate_when_extras_none():
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Hej", lang="da", voice=None, extras=None)
    audio_config = client.synthesize_speech.call_args.kwargs["audio_config"]
    # 0.85 is the M+AR-confirmed default for Danish tutor turns
    # (see ReadAloudButton.tsx comment).
    assert audio_config.speaking_rate == pytest.approx(0.85)


@pytest.mark.asyncio
async def test_synthesize_rejects_empty_text():
    provider, _ = _make_provider_with_mock_client()
    with pytest.raises(ValueError, match="text must not be empty"):
        await provider.synthesize(text="", lang="da", voice=None, extras=None)


@pytest.mark.asyncio
async def test_synthesize_wraps_provider_exceptions_as_runtimeerror():
    client = MagicMock()
    client.synthesize_speech = MagicMock(side_effect=RuntimeError("Cloud TTS quota exceeded"))
    provider = GCPTTSProvider(tier="wavenet", client=client)
    with pytest.raises(RuntimeError, match="Cloud TTS synthesis failed"):
        await provider.synthesize(text="Hej", lang="da", voice=None, extras=None)


@pytest.mark.asyncio
async def test_synthesize_default_voice_raises_when_lang_unknown():
    provider, _ = _make_provider_with_mock_client()
    with pytest.raises(ValueError, match="No default wavenet voice for"):
        await provider.synthesize(text="Test", lang="zu", voice=None, extras=None)


@pytest.mark.asyncio
async def test_synthesize_unknown_lang_works_with_explicit_voice():
    """Caller can pass any voice name even if lang isn't in our defaults map."""
    provider, client = _make_provider_with_mock_client()
    await provider.synthesize(text="Test", lang="zu", voice="zu-ZA-Custom-A", extras=None)
    voice_arg = client.synthesize_speech.call_args.kwargs["voice"]
    assert voice_arg.name == "zu-ZA-Custom-A"
    assert voice_arg.language_code == "zu"  # unknown lang passes through
