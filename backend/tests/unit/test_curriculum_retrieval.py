"""Unit tests for adk/curriculum_retrieval.py (1.1.25 M3).

All Firestore reads and ADK imports are mocked. Tests do NOT hit Vertex AI.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import patch

import adk.curriculum_retrieval as cr
from db.models.activity_config import MaterialRef
from db.models.curriculum import CurriculumDoc


def _material(doc_id: str, origin: str = "uvm.dk") -> MaterialRef:
    return MaterialRef(docId=doc_id, origin=origin)


def _doc(doc_id: str, artifact_id: str) -> CurriculumDoc:
    now = datetime.now(UTC)
    return CurriculumDoc(
        docId=doc_id,
        title="Test",
        level="B",
        source="shared",
        ownerScope="shared",
        origin="uvm.dk",
        docArtifactId=artifact_id,
        copyrightStatus="cleared",
        createdAt=now,
        updatedAt=now,
    )


# ---------------------------------------------------------------------------
# _rag_file_id helper
# ---------------------------------------------------------------------------


def test_rag_file_id_extracts_trailing_segment():
    full = "projects/proj/locations/eu/ragCorpora/42/ragFiles/99"
    assert cr._rag_file_id(full) == "99"


def test_rag_file_id_passthrough_for_short_id():
    assert cr._rag_file_id("99") == "99"


# ---------------------------------------------------------------------------
# build_curriculum_retrieval_tool
# ---------------------------------------------------------------------------


def test_build_returns_none_for_empty_materials():
    assert cr.build_curriculum_retrieval_tool([]) is None


def test_build_returns_none_when_no_corpus_env(monkeypatch):
    monkeypatch.delenv("CURRICULUM_RAG_CORPUS_NAME", raising=False)
    result = cr.build_curriculum_retrieval_tool([_material("doc-1")])
    assert result is None


def test_build_scopes_to_cited_files(monkeypatch):
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", "projects/p/locations/eu/ragCorpora/42")

    full_name_1 = "projects/p/locations/eu/ragCorpora/42/ragFiles/10"
    full_name_2 = "projects/p/locations/eu/ragCorpora/42/ragFiles/20"

    def _fake_get(doc_id):
        return {
            "doc-1": _doc("doc-1", full_name_1),
            "doc-2": _doc("doc-2", full_name_2),
        }.get(doc_id)

    with (
        patch.object(cr, "get_curriculum_doc", side_effect=_fake_get),
        patch.object(cr, "VertexAiRagRetrieval") as MockTool,
        patch.object(cr, "rag") as mock_rag,
    ):
        mock_rag.RagResource.return_value = object()
        cr.build_curriculum_retrieval_tool([_material("doc-1"), _material("doc-2")])

    # VertexAiRagRetrieval called once with our two file IDs.
    MockTool.assert_called_once()
    call_kwargs = MockTool.call_args[1]
    assert call_kwargs["name"] == "curriculum_retrieve"
    mock_rag.RagResource.assert_called_once_with(
        rag_corpus="projects/p/locations/eu/ragCorpora/42",
        rag_file_ids=["10", "20"],
    )


def test_build_skips_uningested_docs(monkeypatch):
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", "projects/p/locations/eu/ragCorpora/42")

    def _fake_get(doc_id):
        return {
            "ingested": _doc("ingested", "projects/p/.../ragFiles/55"),
            "pending": _doc("pending", ""),  # not yet ingested
        }.get(doc_id)

    with (
        patch.object(cr, "get_curriculum_doc", side_effect=_fake_get),
        patch.object(cr, "VertexAiRagRetrieval") as MockTool,
        patch.object(cr, "rag") as mock_rag,
    ):
        mock_rag.RagResource.return_value = object()
        cr.build_curriculum_retrieval_tool([_material("ingested"), _material("pending")])

    # Only the ingested doc appears in rag_file_ids.
    mock_rag.RagResource.assert_called_once_with(
        rag_corpus="projects/p/locations/eu/ragCorpora/42",
        rag_file_ids=["55"],
    )
    MockTool.assert_called_once()


def test_build_returns_none_when_all_uningested(monkeypatch):
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", "projects/p/locations/eu/ragCorpora/42")

    def _fake_get(doc_id):
        return _doc(doc_id, "")

    with patch.object(cr, "get_curriculum_doc", side_effect=_fake_get):
        result = cr.build_curriculum_retrieval_tool([_material("doc-1")])

    assert result is None


# ---------------------------------------------------------------------------
# build_curriculum_grounding_preamble
# ---------------------------------------------------------------------------


def test_grounding_preamble_empty_for_no_materials():
    assert cr.build_curriculum_grounding_preamble([]) == ""


def test_grounding_preamble_lists_origins():
    materials = [_material("d1", "Haka Fysik"), _material("d2", "uvm.dk")]
    preamble = cr.build_curriculum_grounding_preamble(materials)
    assert "Haka Fysik" in preamble
    assert "uvm.dk" in preamble
    assert "curriculum_retrieve" in preamble


def test_grounding_preamble_handles_missing_origin():
    materials = [_material("d1", "")]  # origin not cached yet
    preamble = cr.build_curriculum_grounding_preamble(materials)
    assert preamble  # non-empty generic preamble
    assert "curriculum_retrieve" in preamble
