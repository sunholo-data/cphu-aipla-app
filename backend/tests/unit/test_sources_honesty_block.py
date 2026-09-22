"""1.1.132 — the tutor states what it can read, and only that.

2026-09-22, maths activity: the teacher's text said "det vedlagte dokument", no
material was attached, and the tutor described "what the notes say" for an hour.
Later, with RAG attached, it answered "hvad siger noterne på side 1" from
page-less excerpts.
"""

from __future__ import annotations

from adk.curriculum_retrieval import build_sources_honesty_block
from db.models.activity_config import MaterialRef


def _m(kind: str) -> MaterialRef:
    return MaterialRef(kind=kind, doc_id="d1", material_id="m1", origin="x")


def test_no_activity_adds_nothing():
    assert build_sources_honesty_block([], has_activity=False) == ""


def test_no_materials_says_so_and_forbids_paraphrase():
    out = build_sources_honesty_block([], has_activity=True)
    assert "NO written notes or documents" in out
    assert "Never describe what notes say" in out
    assert "apart from the images" not in out


def test_images_only_is_still_no_written_notes():
    out = build_sources_honesty_block([_m("image")], has_activity=True)
    assert "NO written notes or documents" in out
    assert "apart from the images" in out


def test_rag_only_forbids_page_claims():
    out = build_sources_honesty_block([_m("curriculum")], has_activity=True)
    assert "without page numbers" in out
    assert "Never name a page, section or theorem" in out
    assert "NO written notes" not in out


def test_whole_document_context_needs_no_caveat():
    assert build_sources_honesty_block([_m("context")], has_activity=True) == ""
    assert build_sources_honesty_block([_m("context"), _m("curriculum")], has_activity=True) == ""
