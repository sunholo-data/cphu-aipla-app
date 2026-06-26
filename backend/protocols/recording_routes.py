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
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from opentelemetry import trace

from auth import User, get_current_user
from db.classes import get_class
from db.firestore import delete_document, get_document, query_documents, set_document, update_document
from db.models.class_ import Class
from observability.chat_log import emit_voice_cost
from voice import get_stt
from voice.cost import stt_cost_usd
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


async def _transcribe_segment_in_background(
    rec_id: str, raw: bytes, mime: str, lang: str, group_id: str | None = None, duration_ms: int = 0
) -> None:
    """Transcribe a stored segment off-request and write the result back to its
    Firestore doc (REC-TRANSCRIPT). Uses LONG-RUNNING recognize — lesson segments
    can exceed sync recognize's ~1-min cap (a 50 s segment at the device's native
    rate is well over it), and long-running has no such limit. Runs as a
    BackgroundTask so the upload returns immediately; the student panel + teacher
    report poll the transcript and pick it up when it lands.

    Never raises — the audio is the research record and is kept regardless; a
    failed/empty transcript just flips ``transcriptStatus`` so the UI can tell
    "still working" from "nothing recognised"."""
    provider = get_stt(None)
    # RAQ-1 M3: an engine/bytes/status span so transcription volume + which engine
    # served it (Gemini vs Cloud STT fallback) is queryable in BigQuery alongside
    # the 1.1.11 voice.* spans. $-from-tokens is a follow-up.
    with _tracer.start_as_current_span("voice.stt") as span:
        span.set_attribute("voice.stt.engine", provider.name)
        span.set_attribute("voice.stt.audio_bytes", len(raw))
        try:
            if provider.name in ("disabled", "null"):
                span.set_attribute("voice.stt.status", "disabled")
                update_document(_COLLECTION, rec_id, {"transcriptStatus": "disabled"})
                return
            text = await provider.transcribe_long(raw, mime, lang, None)
            status = "done" if text.strip() else "empty"
            span.set_attribute("voice.stt.status", status)
            span.set_attribute("voice.stt.chars", len(text))
            update_document(
                _COLLECTION,
                rec_id,
                {"transcript": text, "transcriptStatus": status, "transcriptEngine": provider.name},
            )
            # 1.1.9 voice-cost: the STT API processed the audio (billable) —
            # attribute the estimate to the group for the cost dashboard.
            # group-attributed only (ADR-001); "unknown" group is un-attributable.
            if group_id and group_id != "unknown" and duration_ms > 0:
                emit_voice_cost(
                    group_id=group_id,
                    kind="stt",
                    provider=provider.name,
                    units=duration_ms,
                    cost_usd=stt_cost_usd(provider.name, duration_ms),
                )
        except Exception as exc:
            span.set_attribute("voice.stt.status", "failed")
            logger.warning("recording segment transcription failed (audio kept): %s", exc)
            update_document(_COLLECTION, rec_id, {"transcriptStatus": "failed"})


@router.post("")
async def upload_recording(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),  # noqa: B008
    duration_ms: int = Form(0, alias="durationMs"),
    seq: int = Form(0),
    lang: str = Form("da"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, str]:
    """Store a lesson-recording segment for the caller's group/class, then
    transcribe it in the background. Gated on the class's ``recording_enabled``
    (the teacher's paper-consent attestation). ``seq`` orders segments within a
    group's recording.

    Transcription is deferred to a BackgroundTask (long-running recognize) so the
    upload returns immediately — a segment can be seconds of audio that takes
    longer to transcribe than to store, and we never want the rolling recorder's
    uploads to stall behind STT."""
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
        span.set_attribute("recording.seq", seq)
        gcs_uri = await store.write(path, raw, mime)

    meta = {
        "recordingId": rec_id,
        "classId": cls.class_id,
        "groupId": group_id,
        "gcsUri": gcs_uri,
        "mime": mime,
        "sizeBytes": len(raw),
        "durationMs": duration_ms,
        "seq": seq,
        "lang": lang,
        "transcript": "",
        "transcriptStatus": "pending",
        "createdAt": datetime.now(UTC).isoformat(),
    }
    set_document(_COLLECTION, rec_id, meta)
    background_tasks.add_task(_transcribe_segment_in_background, rec_id, raw, mime, lang, group_id, duration_ms)
    logger.info(
        "lesson recording stored: class=%s group=%s seq=%d bytes=%d (transcribing in background)",
        cls.class_id,
        group_id,
        seq,
        len(raw),
    )
    return {"recordingId": rec_id, "gcsUri": gcs_uri}


def _class_for_group(group_id: str) -> Class | None:
    """Resolve the class a given group belongs to (anon_groups -> classId)."""
    anon_doc = get_document("anon_groups", group_id)
    class_id = anon_doc.get("classId") if anon_doc else None
    return get_class(class_id) if class_id else None


def _transcript_for_group(group_id: str) -> dict[str, Any]:
    """Build a group's transcript — ordered segments + joined text. No auth here
    (callers gate first)."""
    docs = query_documents(_COLLECTION, filters=[("groupId", "==", group_id)])
    segments = [
        {"seq": int(d.get("seq", 0)), "text": d.get("transcript", ""), "createdAt": d.get("createdAt", "")}
        for d in docs
        if (d.get("transcript") or "").strip()
    ]
    segments.sort(key=lambda s: (s["seq"], s["createdAt"]))
    return {
        "groupId": group_id,
        "segments": segments,
        "text": " ".join(s["text"].strip() for s in segments),
    }


@router.get("/me/transcript")
async def get_my_transcript(
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The caller's OWN group's lesson transcript (student workbench, M3). No
    group id needed on the wire — resolved from the caller's session."""
    group_id = getattr(user, "group_id", None)
    if not group_id:
        raise HTTPException(status_code=403, detail="No group context.")
    return _transcript_for_group(group_id)


@router.get("/group/{group_id}/transcript")
async def get_group_transcript(
    group_id: str,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """A group's lesson transcript. Authorized for (a) a student OF this group,
    (b) the teacher who owns the class the group belongs to (teacher report,
    M4), or (c) a researcher reading any class (1.1.51 cross-class read).

    The researcher bypass widens only the *ownership* gate (and tags the OTel
    bypass span); it does not loosen the consent posture — content suppression
    for consent-declined sessions happens upstream at recording-creation time
    and is unchanged here."""
    caller_group = getattr(user, "group_id", None)
    if caller_group != group_id:
        # not the group's own student -> the owning teacher, or a researcher.
        cls = _class_for_group(group_id)
        is_owner = cls is not None and cls.owner_uid == user.uid
        is_researcher_bypass = cls is not None and not is_owner and getattr(user, "is_researcher", False)
        if not (is_owner or is_researcher_bypass):
            raise HTTPException(status_code=403, detail="Not authorized for this group's transcript.")
        if is_researcher_bypass:
            # Audit who read across classes (mirrors analytics.auth bypass tag).
            span = trace.get_current_span()
            if span.is_recording():
                span.set_attribute("auth.researcher_bypass", True)
                span.set_attribute("class_id", cls.class_id)
    return _transcript_for_group(group_id)


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
