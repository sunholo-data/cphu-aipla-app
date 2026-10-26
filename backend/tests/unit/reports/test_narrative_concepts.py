"""1.1.139 M0 — concepts as data, from the same narrative call.

The model call and every store are mocked; no real model is ever reached.
"""

from __future__ import annotations

import json
import types
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from reports import narrative
from reports.narrative import ConceptVocabulary, finalise_concepts, parse_report
from reports.session_summary import SessionSummary, SessionTurn

VOCAB = ConceptVocabulary(
    nodes=[{"id": "n1", "label": "Amplitude"}, {"id": "n2", "label": "Frekvens"}, {"id": "n3", "label": "Bølgelængde"}],
    demonstrated={"n3"},
)


def _summary() -> SessionSummary:
    return SessionSummary(
        sessionId="s-1",
        groupCode="g-1",
        activityId="skill-x",
        lessonActivityId="act-1",
        startedAt=datetime(2026, 10, 20, 9, tzinfo=UTC),
        durationSeconds=600,
        messageCount=2,
        simRunCount=0,
        conversation=[
            SessionTurn(timestamp="2026-10-20T09:00:00Z", role="student", content="hvad er amplitude", turnIndex=0),
            SessionTurn(timestamp="2026-10-20T09:01:00Z", role="tutor", content="godt spørgsmål", turnIndex=2),
        ],
    )


def test_closed_vocabulary_maps_to_node_and_takes_its_label() -> None:
    out = finalise_concepts([{"label": "amplitude of the wave", "nodeId": "n1", "status": "discussed"}], VOCAB)
    amp = next(c for c in out if c["nodeId"] == "n1")
    assert amp["label"] == "Amplitude" and amp["key"] == "amplitude"


def test_unknown_node_id_becomes_null_free_label() -> None:
    out = finalise_concepts([{"label": "Energi", "nodeId": "n99", "status": "discussed"}], VOCAB)
    energi = next(c for c in out if c["key"] == "energi")
    assert energi["nodeId"] is None


def test_model_cannot_award_demonstrated() -> None:
    out = finalise_concepts([{"label": "Frekvens", "nodeId": "n2", "status": "demonstrated"}], VOCAB)
    assert next(c for c in out if c["nodeId"] == "n2")["status"] == "discussed"


def test_demonstrated_comes_from_tutor_evidence_even_unmentioned() -> None:
    out = finalise_concepts([], VOCAB)
    assert out == [
        {"key": "bølgelængde", "label": "Bølgelængde", "nodeId": "n3", "status": "demonstrated", "evidenceTurnIds": []}
    ]


def test_duplicates_merge_struggled_wins_and_turn_ids_normalise() -> None:
    out = finalise_concepts(
        [
            {"label": "Amplitude", "nodeId": "n1", "status": "discussed", "evidenceTurnIds": ["t1", "4"]},
            {"label": "amplitude!", "nodeId": "n1", "status": "struggled", "evidenceTurnIds": ["t4", "bogus"]},
        ],
        VOCAB,
    )
    amp = next(c for c in out if c["nodeId"] == "n1")
    assert amp["status"] == "struggled"
    assert amp["evidenceTurnIds"] == ["t1", "t4"]


def test_open_vocabulary_keys_are_normalised() -> None:
    out = finalise_concepts([{"label": "  Newtons  2. lov ", "status": "struggled"}], ConceptVocabulary())
    assert out[0]["key"] == "newtons 2. lov" and out[0]["nodeId"] is None


def test_plain_text_reply_keeps_narrative_concepts_not_extracted() -> None:
    res = parse_report("**Narrative** the group ...", VOCAB)
    assert res.text.startswith("**Narrative**") and res.concepts is None


def test_json_reply_splits_narrative_and_concepts() -> None:
    raw = json.dumps(
        {"narrative": "**Narrative** ok", "concepts": [{"label": "Amplitude", "nodeId": "n1", "status": "struggled"}]}
    )
    res = parse_report(raw, VOCAB)
    assert res.text == "**Narrative** ok"
    assert {c["key"] for c in res.concepts} == {"amplitude", "bølgelængde"}


async def test_one_call_with_schema_and_vocabulary_in_prompt() -> None:
    seen: dict = {}

    async def fake(prompt, *, schema=None):
        seen["prompt"], seen["schema"] = prompt, schema
        return json.dumps({"narrative": "N", "concepts": []})

    with patch.object(narrative, "_call_model", new=fake):
        res = await narrative.generate_report(_summary(), VOCAB)
    assert res.text == "N"
    assert seen["schema"] is narrative.NARRATIVE_SCHEMA
    assert "- n1: Amplitude" in seen["prompt"]
    assert "[t2 tutor]" in seen["prompt"]
    # The schema itself offers the model no "demonstrated".
    enum = narrative.NARRATIVE_SCHEMA["properties"]["concepts"]["items"]["properties"]["status"]["enum"]
    assert "demonstrated" not in enum


async def test_resolve_writes_concepts_onto_the_summary_cache_doc() -> None:
    class _Idx:
        summary_text = None
        summary_based_on_turn_count = None
        summary_generated_at = None
        summary_based_on_voice_chars = 0

    raw = json.dumps({"narrative": "N", "concepts": [{"label": "Frekvens", "nodeId": "n2", "status": "discussed"}]})
    with (
        patch.object(narrative, "get_session_index", return_value=_Idx()),
        patch.object(narrative, "concept_vocabulary", return_value=VOCAB),
        patch.object(narrative, "_call_model", new=AsyncMock(return_value=raw)),
        patch.object(narrative, "update_session_fields") as mock_update,
    ):
        out = await narrative.resolve_narrative(_summary())
    assert out == "N"
    fields = mock_update.call_args.args[1]
    assert fields["summaryText"] == "N"
    assert fields["conceptsVersion"] == narrative.CONCEPTS_VERSION
    assert fields["conceptsModel"]
    assert {c["key"] for c in fields["concepts"]} == {"frekvens", "bølgelængde"}


async def test_failed_extraction_does_not_blank_stored_concepts() -> None:
    assert narrative.concept_cache_fields(None) == {}


def test_vocabulary_reads_the_activity_not_the_skill(monkeypatch) -> None:
    from db.models.activity_config import ConceptMapElement, ConceptNode

    act = types.SimpleNamespace(
        concept_map=[ConceptMapElement(id="m", nodes=[ConceptNode(id="n1", label="Amplitude")])]
    )
    asked: list[str] = []

    def fake_get_activity(aid):
        asked.append(aid)
        return act

    monkeypatch.setattr("db.activities.get_activity", fake_get_activity)
    monkeypatch.setattr(
        "db.concept_progress.get_node_states",
        lambda g, a: {"n1": {"status": "demonstrated"}, "n2": {"status": "partial"}},
    )
    vocab = narrative.concept_vocabulary(_summary())
    assert asked == ["act-1"]
    assert vocab.nodes == [{"id": "n1", "label": "Amplitude"}]
    assert vocab.demonstrated == {"n1"}


async def test_call_model_passes_response_schema(monkeypatch) -> None:
    from google import genai

    seen: dict = {}

    class _Models:
        async def generate_content(self, **kw):
            seen.update(kw)
            return types.SimpleNamespace(text="{}")

    class _Client:
        def __init__(self, **_kw):
            self.aio = types.SimpleNamespace(models=_Models())

    monkeypatch.setattr(genai, "Client", _Client)
    await narrative._call_model("p", schema=narrative.NARRATIVE_SCHEMA)
    assert seen["config"].response_mime_type == "application/json"
