"""RUBRIC-2 M2 — the judge references a session's uploaded documents + images.

Evidence is best-effort: a store miss degrades to empty, never an error, so the
judge always at least scores the transcript.
"""

from __future__ import annotations

import pytest

import analytics.rubric_evidence as ev_mod
from analytics.rubric_evidence import RubricEvidence, format_document_evidence


class _Idx:
    def __init__(self, doc_ids: list[str], owner_uid: str = "anon-x", skill_id: str = "act-1") -> None:
        self.document_ids = doc_ids
        self.owner_uid = owner_uid
        self.skill_id = skill_id


@pytest.mark.asyncio
async def test_load_session_evidence_pulls_documents(monkeypatch):
    from db import chat_sessions
    from tools.documents import context as ctx

    monkeypatch.setattr(chat_sessions, "get_session_index", lambda sid: _Idx(["doc-1", "doc-2"]))
    monkeypatch.setattr(ctx, "build_document_context", lambda doc_id, mode="blocks": (f"TEXT {doc_id}", None))

    async def _no_images(session_id, owner_uid):
        return []

    monkeypatch.setattr(ev_mod, "_image_material_ids", _no_images)

    ev = await ev_mod.load_session_evidence("s-1", "act-1")
    assert ev.doc_refs == ["doc-1", "doc-2"]
    assert "TEXT doc-1" in ev.doc_texts[0]
    assert ev.refs == ["doc:doc-1", "doc:doc-2"]
    assert ev.has_any()


@pytest.mark.asyncio
async def test_load_session_evidence_pulls_activity_images(monkeypatch):
    from adk import activity_images
    from db import chat_sessions

    monkeypatch.setattr(chat_sessions, "get_session_index", lambda sid: _Idx([]))

    async def _ids(session_id, owner_uid):
        return ["mat-1"]

    monkeypatch.setattr(ev_mod, "_image_material_ids", _ids)

    fake_part = object()

    async def _load(*, teacher_uid, activity_id, material_id):
        return fake_part

    monkeypatch.setattr(activity_images, "load_activity_image", _load)

    ev = await ev_mod.load_session_evidence("s-1", "act-1")
    assert ev.image_parts == [fake_part]
    assert ev.image_refs == ["mat-1"]
    assert ev.refs == ["image:mat-1"]


@pytest.mark.asyncio
async def test_no_index_yields_empty_evidence(monkeypatch):
    from db import chat_sessions

    monkeypatch.setattr(chat_sessions, "get_session_index", lambda sid: None)
    ev = await ev_mod.load_session_evidence("s-x")
    assert not ev.has_any()
    assert ev.refs == []


@pytest.mark.asyncio
async def test_document_load_failure_is_swallowed(monkeypatch):
    from db import chat_sessions
    from tools.documents import context as ctx

    monkeypatch.setattr(chat_sessions, "get_session_index", lambda sid: _Idx(["bad", "good"]))

    def _ctx(doc_id, mode="blocks"):
        if doc_id == "bad":
            raise RuntimeError("parse gone")
        return ("GOOD TEXT", None)

    monkeypatch.setattr(ctx, "build_document_context", _ctx)

    async def _no_images(session_id, owner_uid):
        return []

    monkeypatch.setattr(ev_mod, "_image_material_ids", _no_images)

    ev = await ev_mod.load_session_evidence("s-1")
    assert ev.doc_refs == ["good"]  # the bad doc was skipped, not fatal


def test_format_document_evidence():
    assert format_document_evidence(RubricEvidence()) == ""
    out = format_document_evidence(RubricEvidence(doc_texts=["Alpha", "Beta"], doc_refs=["1", "2"]))
    assert "UPLOADED MATERIAL" in out
    assert "Alpha" in out and "Beta" in out
