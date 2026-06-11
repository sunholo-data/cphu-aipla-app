"""Research-audio store (VOICE-IN-REC M2) — lesson recordings to GCS.

UNLIKE the STT path (transcript-only, no persistence), lesson recording
DELIBERATELY retains the raw audio as a research record. Consent is collected
on signed paper forms (GDPR cleared 2026-06-11, see audio-capture-and-tts.md);
recording is teacher-enabled per class. Audio lives EU-only in
``gs://$RESEARCH_AUDIO_BUCKET``, IAM-gated, with a delete-by-group_id erasure
path for GDPR right-to-erasure.

Mirrors ``voice/cache.py``: bucket name from env, sync GCS client wrapped in
``asyncio.to_thread``, injectable client for tests.
"""

from __future__ import annotations

import asyncio
import logging
import os

from google.cloud import storage

logger = logging.getLogger(__name__)

_EXT_BY_MIME = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
}


def _ext_for(mime: str) -> str:
    base = (mime or "").split(";")[0].strip().lower()
    return _EXT_BY_MIME.get(base, "webm")


def uri_to_path(gcs_uri: str) -> str | None:
    """`gs://bucket/a/b/c.webm` -> `a/b/c.webm`. None if not a gs:// URI."""
    if not gcs_uri.startswith("gs://"):
        return None
    rest = gcs_uri[len("gs://") :]
    slash = rest.find("/")
    return rest[slash + 1 :] if slash >= 0 else None


class ResearchAudioStore:
    """Writes/erases lesson-recording objects in the research-audio bucket."""

    def __init__(self, bucket_name: str, *, client: storage.Client | None = None):
        self.bucket_name = bucket_name
        self._client = client
        self._bucket: storage.Bucket | None = None

    @classmethod
    def from_env(cls) -> ResearchAudioStore | None:
        """Build from RESEARCH_AUDIO_BUCKET, or None if unset (dev without a
        bucket; the route layer returns 503 so recording fails closed)."""
        bucket = os.getenv("RESEARCH_AUDIO_BUCKET")
        if not bucket:
            logger.info("RESEARCH_AUDIO_BUCKET unset; lesson recording storage disabled")
            return None
        return cls(bucket)

    def _get_bucket(self) -> storage.Bucket:
        if self._bucket is None:
            if self._client is None:
                self._client = storage.Client()
            self._bucket = self._client.bucket(self.bucket_name)
        return self._bucket

    def object_path(self, class_id: str, group_id: str, recording_id: str, mime: str) -> str:
        """Deterministic, group-scoped object key — the `{class}/{group}/` prefix
        makes delete-by-group a prefix sweep and keeps a class's audio together."""
        return f"{class_id}/{group_id}/{recording_id}.{_ext_for(mime)}"

    async def write(self, path: str, audio: bytes, mime: str) -> str:
        def _write() -> str:
            blob = self._get_bucket().blob(path)
            blob.upload_from_string(audio, content_type=mime)
            return f"gs://{self.bucket_name}/{path}"

        return await asyncio.to_thread(_write)

    async def delete_object(self, path: str) -> bool:
        def _delete() -> bool:
            blob = self._get_bucket().blob(path)
            try:
                blob.delete()
                return True
            except Exception as exc:  # NotFound or transient — erasure is best-effort
                logger.warning("research-audio delete failed for %s: %s", path, exc)
                return False

        return await asyncio.to_thread(_delete)
