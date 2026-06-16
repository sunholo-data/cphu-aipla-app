"""API tests for lesson recording (VOICE-IN-REC M2). Mocks GCS + Firestore +
the group->class binding; no real GCP calls."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from auth import User, build_access_context, get_current_user
from protocols import recording_routes as rr
from voice.recording_store import _ext_for, uri_to_path

STUDENT_UID = "group-stu-1"
GROUP_ID = "grp-1"
CLASS_ID = "cls-1"
TEACHER_UID = "teacher-1"


class _FakeStore:
    def __init__(self):
        self.writes: list = []
        self.deletes: list = []

    def object_path(self, class_id, group_id, rec_id, mime):
        return f"{class_id}/{group_id}/{rec_id}.webm"

    async def write(self, path, audio, mime):
        self.writes.append((path, len(audio), mime))
        return f"gs://bucket/{path}"

    async def delete_object(self, path):
        self.deletes.append(path)
        return True


def _fake_class(recording_enabled=True, owner=TEACHER_UID):
    return SimpleNamespace(class_id=CLASS_ID, recording_enabled=recording_enabled, owner_uid=owner)


@pytest.fixture()
def store():
    return _FakeStore()


def _client(group_id: str | None, monkeypatch, store=None, cls=None, writes=None, updates=None):
    app = FastAPI()
    app.include_router(rr.router)

    async def _override(request: Request) -> User:
        if group_id:
            u = User(uid=STUDENT_UID, email="", group_id=group_id)
        else:
            u = User(uid=TEACHER_UID, email="")
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    monkeypatch.setattr(rr, "_get_store", lambda: store)
    monkeypatch.setattr(rr, "get_document", lambda c, i: {"classId": CLASS_ID})
    monkeypatch.setattr(rr, "get_class", lambda cid: cls)
    captured = writes if writes is not None else []
    monkeypatch.setattr(rr, "set_document", lambda c, i, d: captured.append((i, d)))
    # REC-TRANSCRIPT — transcription runs in a BackgroundTask that update_document's
    # the doc; the TestClient runs background tasks after the response.
    upd = updates if updates is not None else []
    monkeypatch.setattr(rr, "update_document", lambda c, i, d: upd.append((i, d)))
    stt = MagicMock()
    stt.name = "gemini"
    stt.transcribe_long = AsyncMock(return_value="hej fra gruppen")
    monkeypatch.setattr(rr, "get_stt", lambda skill=None: stt)
    return TestClient(app), captured


def test_upload_stores_audio_then_transcribes_in_background(store, monkeypatch):
    writes: list = []
    updates: list = []
    client, captured = _client(
        GROUP_ID, monkeypatch, store=store, cls=_fake_class(True), writes=writes, updates=updates
    )
    resp = client.post(
        "/api/voice/recording",
        files={"audio": ("lesson.wav", b"\x1aE\xdf\xa3-fake", "audio/wav")},
        data={"durationMs": "60000"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["gcsUri"].startswith("gs://bucket/")
    assert len(store.writes) == 1  # audio written to GCS
    assert len(captured) == 1  # metadata doc written immediately
    _id, meta = captured[0]
    assert meta["classId"] == CLASS_ID and meta["groupId"] == GROUP_ID and meta["durationMs"] == 60000
    # Doc is created with an empty/pending transcript; STT runs off-request.
    assert meta["transcript"] == "" and meta["transcriptStatus"] == "pending"
    # The background task (run by the TestClient after the response) fills it in.
    # transcriptEngine stamps which engine served it — RAQ-1 M3.
    assert updates == [
        (_id, {"transcript": "hej fra gruppen", "transcriptStatus": "done", "transcriptEngine": "gemini"})
    ]


def test_upload_keeps_audio_when_transcription_fails(store, monkeypatch):
    writes: list = []
    updates: list = []
    client, captured = _client(
        GROUP_ID, monkeypatch, store=store, cls=_fake_class(True), writes=writes, updates=updates
    )
    # STT blows up -> doc marked failed, but audio + doc still stored (research record)
    failing = MagicMock()
    failing.name = "gemini"
    failing.transcribe_long = AsyncMock(side_effect=RuntimeError("stt down"))
    monkeypatch.setattr(rr, "get_stt", lambda skill=None: failing)
    resp = client.post(
        "/api/voice/recording",
        files={"audio": ("l.wav", b"x", "audio/wav")},
        data={"seq": "2"},
    )
    assert resp.status_code == 200
    assert len(store.writes) == 1
    _id, meta = captured[0]
    assert meta["transcript"] == "" and meta["seq"] == 2
    assert updates == [(_id, {"transcriptStatus": "failed"})]


def test_upload_blocked_when_recording_disabled(store, monkeypatch):
    client, _ = _client(GROUP_ID, monkeypatch, store=store, cls=_fake_class(recording_enabled=False))
    resp = client.post("/api/voice/recording", files={"audio": ("l.webm", b"x", "audio/webm")})
    assert resp.status_code == 403
    assert store.writes == []  # nothing stored


def test_upload_no_class_context_403(store, monkeypatch):
    client, _ = _client(None, monkeypatch, store=store, cls=None)
    resp = client.post("/api/voice/recording", files={"audio": ("l.webm", b"x", "audio/webm")})
    assert resp.status_code == 403


def test_upload_unconfigured_store_503(monkeypatch):
    client, _ = _client(GROUP_ID, monkeypatch, store=None, cls=_fake_class(True))
    resp = client.post("/api/voice/recording", files={"audio": ("l.webm", b"x", "audio/webm")})
    assert resp.status_code == 503


def test_upload_empty_audio_400(store, monkeypatch):
    client, _ = _client(GROUP_ID, monkeypatch, store=store, cls=_fake_class(True))
    resp = client.post("/api/voice/recording", files={"audio": ("l.webm", b"", "audio/webm")})
    assert resp.status_code == 400


def test_delete_by_group_owning_teacher(store, monkeypatch):
    client, _ = _client(None, monkeypatch, store=store, cls=_fake_class(owner=TEACHER_UID))
    monkeypatch.setattr(
        rr,
        "query_documents",
        lambda c, filters=None: [{"recordingId": "r1", "gcsUri": "gs://bucket/cls-1/grp-1/r1.webm"}],
    )
    monkeypatch.setattr(rr, "delete_document", lambda c, i: None)
    resp = client.delete(f"/api/voice/recording/group/{GROUP_ID}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] == 1
    assert store.deletes == ["cls-1/grp-1/r1.webm"]  # GCS object erased too


def test_delete_by_group_non_owner_403(store, monkeypatch):
    client, _ = _client(None, monkeypatch, store=store, cls=_fake_class(owner="someone-else"))
    resp = client.delete(f"/api/voice/recording/group/{GROUP_ID}")
    assert resp.status_code == 403


def test_delete_by_group_student_forbidden(store, monkeypatch):
    client, _ = _client(GROUP_ID, monkeypatch, store=store, cls=_fake_class())
    resp = client.delete(f"/api/voice/recording/group/{GROUP_ID}")
    assert resp.status_code == 403


# --- store helpers ---


def test_uri_to_path_roundtrip():
    assert uri_to_path("gs://b/cls/grp/r.webm") == "cls/grp/r.webm"
    assert uri_to_path("not-a-uri") is None


def test_ext_for_mime():
    assert _ext_for("audio/webm;codecs=opus") == "webm"
    assert _ext_for("audio/wav") == "wav"
    assert _ext_for("application/octet-stream") == "webm"  # safe default


# --- GET /group/{id}/transcript (REC-TRANSCRIPT M1) ---

_SEGMENTS = [
    {"seq": 1, "transcript": "second part", "createdAt": "2026-06-11T10:01:00Z"},
    {"seq": 0, "transcript": "first part", "createdAt": "2026-06-11T10:00:00Z"},
    {"seq": 2, "transcript": "", "createdAt": "2026-06-11T10:02:00Z"},  # untranscribed -> dropped
]


def test_transcript_own_group_student(monkeypatch):
    client, _ = _client(GROUP_ID, monkeypatch, store=None, cls=_fake_class())
    monkeypatch.setattr(rr, "query_documents", lambda c, filters=None: list(_SEGMENTS))
    resp = client.get(f"/api/voice/recording/group/{GROUP_ID}/transcript")
    assert resp.status_code == 200
    body = resp.json()
    # ordered by seq, empties dropped, joined
    assert [s["seq"] for s in body["segments"]] == [0, 1]
    assert body["text"] == "first part second part"


def test_transcript_owning_teacher(monkeypatch):
    client, _ = _client(None, monkeypatch, store=None, cls=_fake_class(owner=TEACHER_UID))
    monkeypatch.setattr(rr, "query_documents", lambda c, filters=None: list(_SEGMENTS))
    resp = client.get(f"/api/voice/recording/group/{GROUP_ID}/transcript")
    assert resp.status_code == 200
    assert resp.json()["text"] == "first part second part"


def test_transcript_other_group_student_forbidden(monkeypatch):
    # a student whose own group differs from the requested group, and not a teacher
    client, _ = _client("other-group", monkeypatch, store=None, cls=_fake_class(owner="someone-else"))
    resp = client.get(f"/api/voice/recording/group/{GROUP_ID}/transcript")
    assert resp.status_code == 403


def test_me_transcript_resolves_own_group(monkeypatch):
    client, _ = _client(GROUP_ID, monkeypatch, store=None, cls=_fake_class())
    monkeypatch.setattr(rr, "query_documents", lambda c, filters=None: list(_SEGMENTS))
    resp = client.get("/api/voice/recording/me/transcript")
    assert resp.status_code == 200
    assert resp.json()["text"] == "first part second part"


def test_me_transcript_no_group_403(monkeypatch):
    client, _ = _client(None, monkeypatch, store=None, cls=_fake_class())
    resp = client.get("/api/voice/recording/me/transcript")
    assert resp.status_code == 403
