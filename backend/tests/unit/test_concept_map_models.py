"""CONCEPT-1 M0 — concept-map data model + registry + both-store threading.

The living concept map (living-concept-map.md): ``ConceptMapElement`` holds the
teacher-authored prerequisite DAG (nodes + edges) with optional per-node
chat-native check questions. One map per activity (cap 1, like solution /
document). Validators: cycle-guard (prerequisite edges must form a DAG),
edge refs must resolve, bounded sizes (1.1.38 bounded-input rule).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from db.models.activity_config import (
    ELEMENT_REGISTRY,
    ActivityConfig,
    CheckQuestion,
    ConceptEdge,
    ConceptMapElement,
    ConceptNode,
)


def _node(nid: str, label: str | None = None, **kw) -> ConceptNode:
    return ConceptNode(id=nid, label=label or nid, **kw)


def _edge(src: str, dst: str) -> ConceptEdge:
    return ConceptEdge.model_validate({"from": src, "to": dst})


def _map(nodes: list[ConceptNode], edges: list[ConceptEdge]) -> ConceptMapElement:
    return ConceptMapElement(id="map-1", nodes=nodes, edges=edges)


# --- registry ---


def test_concept_map_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["conceptMap"]
    assert spec.field == "concept_map"
    assert spec.max_items == 1
    assert spec.render == "workspace"


# --- shape + aliases ---


def test_minimal_map_roundtrips_with_camelcase_aliases() -> None:
    m = _map(
        [_node("vektorer"), _node("projektil", "Projektilbevægelse")],
        [_edge("vektorer", "projektil")],
    )
    dumped = m.model_dump(by_alias=True)
    assert dumped["edges"][0]["from"] == "vektorer"
    # round-trip through the alias form (Firestore shape)
    again = ConceptMapElement.model_validate(dumped)
    assert [n.id for n in again.nodes] == ["vektorer", "projektil"]
    assert again.edges[0].from_ == "vektorer"


def test_check_question_is_prompt_plus_expected_answer_and_carries_no_options() -> None:
    q = CheckQuestion(
        id="q1",
        prompt="Hvordan dekomponeres en vektor på 30°?",
        expected_answer="vx = v·cos(30°), vy = v·sin(30°)",
        explanation="Komposanterne følger af retvinklet trigonometri.",
    )
    node = _node("vektorer", check_questions=[q])
    assert node.check_questions[0].expected_answer.startswith("vx")
    # Delivery is chat-native: the tutor asks in its own voice and judges free
    # text, which is what lets it follow up on a wrong answer. An `options` list
    # existed here 2026-07-10 → 2026-08-17 with no producer and no consumer and
    # was deleted; clickable multiple choice is the questionSet element (1.1.78).
    # Asserting ABSENCE, not emptiness — an empty list would let it creep back.
    assert "options" not in CheckQuestion.model_fields


# --- validators ---


def test_cycle_is_rejected() -> None:
    with pytest.raises(ValidationError, match="cycle"):
        _map(
            [_node("a"), _node("b"), _node("c")],
            [_edge("a", "b"), _edge("b", "c"), _edge("c", "a")],
        )


def test_self_edge_is_rejected() -> None:
    with pytest.raises(ValidationError, match=r"cycle|itself"):
        _map([_node("a")], [_edge("a", "a")])


def test_dangling_edge_ref_is_rejected() -> None:
    with pytest.raises(ValidationError, match="unknown"):
        _map([_node("a")], [_edge("a", "ghost")])


def test_duplicate_node_ids_are_rejected() -> None:
    with pytest.raises(ValidationError, match="duplicate"):
        _map([_node("a"), _node("a")], [])


def test_bounded_sizes() -> None:
    # >30 nodes rejected
    with pytest.raises(ValidationError):
        _map([_node(f"n{i}") for i in range(31)], [])
    # >5 check questions per node rejected
    with pytest.raises(ValidationError):
        _node(
            "a",
            check_questions=[CheckQuestion(id=f"q{i}", prompt="p", expected_answer="e") for i in range(6)],
        )


# --- both-store threading (the 422 lesson) ---


def _config_kwargs(**overrides) -> dict:
    base = {
        "activityId": "act-x",
        "classId": "c1",
        "teacherUid": "t1",
        "updatedAt": datetime.now(UTC),
    }
    base.update(overrides)
    return base


def test_concept_map_field_on_activity_config_capped_at_one() -> None:
    m = _map([_node("a")], [])
    cfg = ActivityConfig(**_config_kwargs(concept_map=[m]))
    assert cfg.concept_map[0].nodes[0].id == "a"
    two = [m, ConceptMapElement(id="map-2", nodes=[_node("b")], edges=[])]
    with pytest.raises(ValidationError, match="concept_map"):
        ActivityConfig(**_config_kwargs(concept_map=two))


def test_concept_map_survives_both_adapters() -> None:
    """ActivityUpsert -> Activity (_activity_from_body) -> ActivityConfig
    (_activity_to_config) must all carry the map — adapter threading, which the
    field-presence guard alone can't see."""
    from adk.teacher_focus import _activity_to_config
    from protocols.activity_routes import ActivityUpsert, _activity_from_body

    body = ActivityUpsert.model_validate(
        {
            "title": "Projektil",
            "conceptMap": [
                {
                    "id": "map-1",
                    "nodes": [
                        {"id": "vektorer", "label": "Vektorer"},
                        {
                            "id": "projektil",
                            "label": "Projektilbevægelse",
                            "checkQuestions": [
                                {"id": "q1", "prompt": "Hvorfor er banen en parabel?", "expectedAnswer": "konstant a"}
                            ],
                        },
                    ],
                    "edges": [{"from": "vektorer", "to": "projektil"}],
                }
            ],
        }
    )
    activity = _activity_from_body(body, owner_uid="t1", activity_id="act-1")
    assert activity.concept_map[0].edges[0].from_ == "vektorer"
    cfg = _activity_to_config(activity, class_id="c1")
    assert cfg.concept_map[0].nodes[1].check_questions[0].prompt.startswith("Hvorfor")
