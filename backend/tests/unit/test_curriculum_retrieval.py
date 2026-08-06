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


# ---------------------------------------------------------------------------
# 1.1.63 M1 — citation voice
#
# Aswin, 2026-08-06: "The chat keeps referring to the documents title when
# generating text which always start with According to mathematicus.dk…, or
# According to uvm.dk…". That phrasing was OUR OWN INSTRUCTION, verbatim. These
# tests pin the replacement contract so it cannot regress into a template again.
# ---------------------------------------------------------------------------


def _titled(doc_id: str, title: str, origin: str = "uvm.dk") -> MaterialRef:
    return MaterialRef(docId=doc_id, title=title, origin=origin)


def test_grounding_preamble_does_not_dictate_an_opening_phrase():
    """The old preamble literally handed the model its opening words.

    Any instruction of the shape ``start with "According to [source]"`` puts the
    attribution in the most intrusive possible position, on every turn. The
    replacement states WHEN to attribute, not what to open with.
    """
    materials = [_titled("d1", "Kastebevægelse — noter", "mathematicus.dk")]
    preamble = cr.build_curriculum_grounding_preamble(materials)

    lowered = preamble.lower()
    assert "according to [source" not in lowered
    assert "from [source" not in lowered
    assert "start with" not in lowered
    # "Always attribute" is what made it fire on every turn, including turns
    # that retrieved nothing.
    assert "always attribute" not in lowered


def test_grounding_preamble_forbids_opening_and_domain_citation():
    """The contract must be explicit about the two things Aswin actually saw."""
    materials = [_titled("d1", "Kastebevægelse — noter", "mathematicus.dk")]
    preamble = cr.build_curriculum_grounding_preamble(materials).lower()

    # Tells the model not to open a reply with an attribution...
    assert "do not open" in preamble
    # ...and not to cite by domain/filename.
    assert "domain" in preamble
    # ...and not to cite on turns that used no retrieved content.
    assert "no retrieved content" in preamble


def test_grounding_preamble_leads_with_title_and_keeps_origin_as_provenance():
    """Title first, provenance in parentheses.

    ``MaterialRef.origin`` is provenance ("uvm.dk", "Haka Fysik") — see the
    field comment on ``CurriculumDoc.origin``. It was the only thing cached at
    citation time, which is precisely why the tutor cited domains: a title was
    never available to name. ``title`` is now cached alongside it.
    """
    materials = [_titled("d1", "Kastebevægelse — noter", "mathematicus.dk")]
    preamble = cr.build_curriculum_grounding_preamble(materials)

    assert "Kastebevægelse — noter" in preamble
    assert "mathematicus.dk" in preamble
    # The title leads; the domain trails it as provenance.
    assert preamble.index("Kastebevægelse — noter") < preamble.index("mathematicus.dk")


def test_grounding_preamble_instructs_citation_by_title():
    materials = [_titled("d1", "Kastebevægelse — noter")]
    preamble = cr.build_curriculum_grounding_preamble(materials).lower()
    assert "title" in preamble


def test_grounding_preamble_falls_back_to_origin_when_no_title_cached():
    """Graceful degradation — every activity cited before 1.1.63 has no title.

    Those MaterialRefs must keep working and keep naming their source, exactly
    as they do today. This is the no-backfill guarantee.
    """
    materials = [MaterialRef(docId="d1", origin="Haka Fysik")]  # pre-1.1.63 shape
    preamble = cr.build_curriculum_grounding_preamble(materials)

    assert "Haka Fysik" in preamble
    assert "curriculum_retrieve" in preamble


def test_grounding_preamble_still_forbids_inventing_content():
    """The one part of the old preamble that was right must survive the rewrite."""
    materials = [_titled("d1", "Noter")]
    preamble = cr.build_curriculum_grounding_preamble(materials).lower()
    assert "invent" in preamble


def test_grounding_preamble_still_prefers_cited_sources_over_model_knowledge():
    materials = [_titled("d1", "Noter")]
    preamble = cr.build_curriculum_grounding_preamble(materials).lower()
    assert "prefer" in preamble


def test_grounding_preamble_answers_direct_provenance_questions():
    """Attribution is REDUCED, not removed (Axiom 2).

    A student must always be able to ask "where did that come from?" and get a
    specific answer, even though the tutor no longer volunteers a citation on
    every turn.
    """
    materials = [_titled("d1", "Noter")]
    preamble = cr.build_curriculum_grounding_preamble(materials).lower()
    assert "asks" in preamble


def test_retrieval_tool_description_does_not_demand_always_cite(monkeypatch):
    """The line-118 twin.

    ``build_curriculum_retrieval_tool``'s tool DESCRIPTION carried its own
    "Always cite the source in your answer." Leaving it while fixing the
    preamble is the likeliest way for this whole milestone to look like it
    did not work.
    """
    monkeypatch.setenv("CURRICULUM_RAG_CORPUS_NAME", "projects/p/locations/eu/ragCorpora/1")
    with patch.object(cr, "get_curriculum_doc", return_value=_doc("d1", "ragFiles/99")):
        tool = cr.build_curriculum_retrieval_tool([_material("d1")])

    assert tool is not None
    assert "always cite" not in tool.description.lower()
