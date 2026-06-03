"""Unit tests for the content-hash TTS cache.

Mocks google.cloud.storage. Asserts:
  - Cache key is deterministic across runs.
  - Different inputs (voice, lang, rate, text) produce different keys.
  - Lookup miss returns None.
  - Lookup hit returns (bytes, mime).
  - Write uploads with mime in metadata.
  - Write failures don't propagate (cache is best-effort).
  - `from_env` returns None when bucket env unset.
"""

from unittest.mock import MagicMock

import pytest
from google.api_core.exceptions import NotFound

from backend.voice.cache import CacheKey, TTSCache

# --- CacheKey hashing ---


def test_cache_key_is_deterministic():
    k1 = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")
    k2 = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")
    assert k1.hash() == k2.hash()


def test_cache_key_differs_per_voice():
    base = {"provider": "gcp_wavenet", "lang": "da", "rate": 0.85, "text": "Hej"}
    k1 = CacheKey(**base, voice="da-DK-Wavenet-A").hash()
    k2 = CacheKey(**base, voice="da-DK-Wavenet-C").hash()
    assert k1 != k2


def test_cache_key_differs_per_text():
    base = {"provider": "gcp_wavenet", "voice": "da-DK-Wavenet-A", "lang": "da", "rate": 0.85}
    k1 = CacheKey(**base, text="Hej").hash()
    k2 = CacheKey(**base, text="Hej!").hash()
    assert k1 != k2


def test_cache_key_differs_per_rate():
    base = {"provider": "gcp_wavenet", "voice": "da-DK-Wavenet-A", "lang": "da", "text": "Hej"}
    k1 = CacheKey(**base, rate=0.85).hash()
    k2 = CacheKey(**base, rate=0.9).hash()
    assert k1 != k2


def test_cache_key_differs_per_provider():
    base = {"voice": "da-DK-Wavenet-A", "lang": "da", "rate": 0.85, "text": "Hej"}
    k1 = CacheKey(**base, provider="gcp_wavenet").hash()
    k2 = CacheKey(**base, provider="gcp_neural2").hash()
    assert k1 != k2


def test_cache_object_path_uses_two_char_shard():
    """The cache object path is `{hash[:2]}/{hash}.{ext}` for bucket listing sanity."""
    key = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")

    fake_blob = MagicMock()
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    cache = TTSCache("test-bucket", client=fake_client)
    cache._blob_for(key)

    # The blob path passed to bucket.blob() should be sharded.
    called_path = fake_bucket.blob.call_args[0][0]
    h = key.hash()
    assert called_path.startswith(f"{h[:2]}/{h}")


# --- async lookup / write ---


@pytest.mark.asyncio
async def test_cache_miss_returns_none():
    fake_blob = MagicMock()
    fake_blob.download_as_bytes.side_effect = NotFound("not there")
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    cache = TTSCache("test-bucket", client=fake_client)
    key = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")

    result = await cache.lookup(key)
    assert result is None


@pytest.mark.asyncio
async def test_cache_hit_returns_bytes_and_mime():
    fake_blob = MagicMock()
    fake_blob.download_as_bytes.return_value = b"\xff\xfb fake mp3 bytes"
    fake_blob.metadata = {"mime": "audio/mpeg"}
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    cache = TTSCache("test-bucket", client=fake_client)
    key = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")

    result = await cache.lookup(key)
    assert result == (b"\xff\xfb fake mp3 bytes", "audio/mpeg")


@pytest.mark.asyncio
async def test_cache_hit_with_missing_metadata_defaults_to_mp3():
    """If an old object has no mime in metadata, default to audio/mpeg."""
    fake_blob = MagicMock()
    fake_blob.download_as_bytes.return_value = b"\xff\xfb"
    fake_blob.metadata = None  # old object, never had metadata set
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    cache = TTSCache("test-bucket", client=fake_client)
    key = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")

    result = await cache.lookup(key)
    assert result == (b"\xff\xfb", "audio/mpeg")


@pytest.mark.asyncio
async def test_cache_write_uploads_with_mime_metadata():
    fake_blob = MagicMock()
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    cache = TTSCache("test-bucket", client=fake_client)
    key = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")

    await cache.write(key, b"\xff\xfb audio", "audio/mpeg")

    # Mime stored in metadata.
    assert fake_blob.metadata == {"mime": "audio/mpeg"}
    fake_blob.upload_from_string.assert_called_once_with(b"\xff\xfb audio", content_type="audio/mpeg")


@pytest.mark.asyncio
async def test_cache_write_swallows_failures():
    """Cache write is best-effort. GCS errors must not bubble to the request handler."""
    fake_blob = MagicMock()
    fake_blob.upload_from_string.side_effect = RuntimeError("GCS down")
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    fake_client = MagicMock()
    fake_client.bucket.return_value = fake_bucket

    cache = TTSCache("test-bucket", client=fake_client)
    key = CacheKey(provider="gcp_wavenet", voice="da-DK-Wavenet-A", lang="da", rate=0.85, text="Hej")

    # Must not raise.
    await cache.write(key, b"\xff\xfb", "audio/mpeg")


# --- from_env ---


def test_from_env_returns_none_when_bucket_unset(monkeypatch):
    monkeypatch.delenv("VOICE_TTS_CACHE_BUCKET", raising=False)
    assert TTSCache.from_env() is None


def test_from_env_builds_cache_when_bucket_set(monkeypatch):
    monkeypatch.setenv("VOICE_TTS_CACHE_BUCKET", "aipla-dev-2026-tts-cache")
    cache = TTSCache.from_env()
    assert cache is not None
    assert cache.bucket_name == "aipla-dev-2026-tts-cache"
