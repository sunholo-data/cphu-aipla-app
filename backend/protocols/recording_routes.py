"""Lesson-recording routes (VOICE-IN-REC M2).

The "Record this class" research-capture path. A student device on a shared
tablet records the group's discussion and uploads it here; the audio is RETAINED
as a research record (consent = signed paper forms, teacher-enabled per class —
GDPR cleared 2026-06-11). This is deliberately distinct from STT
(``/api/voice/stt/transcribe``), which is transcript-only and never persists.

  POST   /api/voice/recording                  — upload a lesson recording
  DELETE /api/voice/recording/group/{group_id} — erase a group's recordings

Recording fails CLOSED: disabled class -> 403, unconfigured bucket -> 503.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from opentelemetry import trace

from auth import User, get_current_user
from db.classes import get_class
from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.class_ import Class
from voice.recording_store import ResearchAudioStore, uri_to_path

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)

router = APIRouter(prefix="/api/voice/recording", tags=["voice"])

_COLLECTION = "recordings"
_MAX_RECORDING_BYTES = 100 * 1024 * 1024  # 100 MB per upload

# Lazy store singleton (mirrors the TTS cache). None when RESEARCH_AUDIO_BUCKET
# is unset; routes treat that as 503 so recording fails closed.
_store_singleton: ResearchAudioStore | None | object = object()
_NOT_BUILT = _store_singleton


def _get_store() -> ResearchAudioStore | None:
    global _store_singleton
    if _store_singleton is _NOT_BUILT:
        _store_singleton = ResearchAudioStore.from_env()
    return _store_singleton  # type: ignore[return-value]


def _class_for_user(user: User) -> Class | None:
    """Resolve the requesting anonymous-group student's class via the
    anon_groups -> classId binding (same path as voice_routes). None when the
    caller has no group context (e.g. a teacher in chat mode)."""
    group_id = getattr(user, "group_id", None)
    if not group_id:
        return None
    try:
        anon_doc = get_document("anon_groups", group_id)
        if not anon_doc:
            return None
        class_id = anon_doc.get("classId")
        if not class_id:
            return None
        return get_class(class_id)
    except Exception as exc:
        logger.warning("recording: class lookup failed for group=%s: %s", group_id, exc)
        return None


@router.post("")
async def upload_recording(
    audio: UploadFile = File(...),  # noqa: B008
    duration_ms: int = Form(0, alias="durationMs"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, str]:
    """Store a lesson recording for the caller's group/class. Gated on the
    class's ``recording_enabled`` (the teacher's paper-consent attestation)."""
    cls = _class_for_user(user)
    if cls is None:
        raise HTTPException(status_code=403, detail="No class context for recording.")
    if not cls.recording_enabled:
        raise HTTPException(status_code=403, detail="Lesson recording is not enabled for this class.")

    store = _get_store()
    if store is None:
        raise HTTPException(status_code=503, detail="Recording storage is not configured.")

    raw = await audio.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(raw) > _MAX_RECORDING_BYTES:
        raise HTTPException(status_code=413, detail="recording too large")

    mime = audio.content_type or "audio/webm"
    rec_id = uuid.uuid4().hex
    group_id = getattr(user, "group_id", None) or "unknown"
    path = store.object_path(cls.class_id, group_id, rec_id, mime)

    with _tracer.start_as_current_span("voice.recording.upload") as span:
        span.set_attribute("recording.class_id", cls.class_id)
        span.set_attribute("recording.bytes", len(raw))
        span.set_attribute("recording.duration_ms", duration_ms)
        gcs_uri = await store.write(path, raw, mime)

    meta = {
        "recordingId": rec_id,
        "classId": cls.class_id,
        "groupId": group_id,
        "gcsUri": gcs_uri,
        "mime": mime,
        "sizeBytes": len(raw),
        "durationMs": duration_ms,
        "createdAt": datetime.now(UTC).isoformat(),
    }
    set_document(_COLLECTION, rec_id, meta)
    logger.info("lesson recording stored: class=%s group=%s bytes=%d", cls.class_id, group_id, len(raw))
    return {"recordingId": rec_id, "gcsUri": gcs_uri}


async def delete_recordings_for_group(group_id: str) -> int:
    """GDPR erasure: delete every recording (GCS object + Firestore doc) for a
    group. Best-effort per object; returns the count of metadata docs removed."""
    docs = query_documents(_COLLECTION, filters=[("groupId", "==", group_id)])
    store = _get_store()
    deleted = 0
    for d in docs:
        if store is not None:
            path = uri_to_path(d.get("gcsUri", ""))
            if path:
                await store.delete_object(path)
        delete_document(_COLLECTION, d.get("recordingId") or d.get("__id"))
        deleted += 1
    return deleted


@router.delete("/group/{group_id}")
async def delete_group_recordings(
    group_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, int]:
    """Erase a group's recordings. Authorized for the teacher who owns the
    class the group belongs to (researcher role = 1.1.5, future)."""
    if getattr(user, "group_id", None):
        # Anonymous-group students cannot erase research data.
        raise HTTPException(status_code=403, detail="Not authorized.")
    anon_doc = get_document("anon_groups", group_id)
    class_id = anon_doc.get("classId") if anon_doc else None
    cls = get_class(class_id) if class_id else None
    if cls is None or cls.owner_uid != user.uid:
        raise HTTPException(status_code=403, detail="Not the owning teacher.")
    deleted = await delete_recordings_for_group(group_id)
    return {"deleted": deleted}
