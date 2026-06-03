"""Real-GCP Danish round-trip for the Cloud TTS provider.

Marked @pytest.mark.integration — skipped in the fast CI suite. Run with:

    cd backend && uv run pytest -m integration tests/integration/voice/ -v

Requires:
  - texttospeech.googleapis.com enabled on the target project
  - GOOGLE_CLOUD_PROJECT env (or ADC pointed at) aipla-dev-2026
  - `gcloud auth application-default login` for local runs
"""

import pytest

from voice.providers.gcp_tts import GCPTTSProvider


@pytest.mark.integration
@pytest.mark.asyncio
async def test_gcp_tts_danish_wavenet_roundtrip():
    """Synthesize a Danish phrase via WaveNet; expect MP3 bytes back, >=1KB."""
    provider = GCPTTSProvider(tier="wavenet")
    audio, mime = await provider.synthesize(
        text="Hej, hvad er Plancks konstant?",
        lang="da",
        voice="da-DK-Wavenet-A",
        extras=None,
    )
    assert mime == "audio/mpeg"
    assert len(audio) > 1024, f"Expected >1KB MP3, got {len(audio)} bytes"
    # MP3 frames typically start with 0xFF, 0xFB or 0xFF, 0xF3.
    assert audio[0] == 0xFF, f"Expected MP3 frame header, got first byte {audio[0]:#x}"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_gcp_tts_english_standard_roundtrip():
    """Smoke a second tier + lang to catch tier-specific config drift."""
    provider = GCPTTSProvider(tier="standard")
    audio, mime = await provider.synthesize(
        text="Hello, what is Planck's constant?",
        lang="en",
        voice=None,
        extras=None,
    )
    assert mime == "audio/mpeg"
    assert len(audio) > 1024
