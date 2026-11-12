"""``POST /api/activities/concept-map/suggest`` — the wizard's suggested map.

Model mocked. Pins:

* a valid answer comes back as a validated wire map (minted ids, label edges
  resolved, ``doneWhen`` per concept), via the ``concept_map_suggest`` purpose;
* an invalid answer (cyclic, unknown edge, too few concepts, not JSON, a failed
  call) is refused WHOLE — ``ok: false``, never half a map;
* an empty goal is a 422;
* a REAL anonymous-group student token through the REAL dispatcher is refused.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import adk.concept_map_suggest as suggest
from auth import User, build_access_context, get_current_user
from auth.group_id_auth import AnonymousGroupAuth, create_group, join_group
from db import firestore as fs_module
from llm import Generation
from protocols.activity_routes import router as activities_router

URL = "/api/activities/concept-map/suggest"
GOAL = "Eleverne skal forstå, hvorfor en bold i frit fald accelererer, og kunne regne på faldtiden."

VALID = {
    "title": "Frit fald",
    "nodes": [
        {"label": "Tyngdekraft", "done_when": "Kan forklare, at tyngdekraften virker på alle legemer."},
        {"label": "Acceleration", "done_when": "Kan forklare acceleration som ændring i fart per tid."},
        {"label": "Frit fald", "done_when": "Kan beregne faldtiden for en bold fra en given højde."},
    ],
    "edges": [
        {"from": "Tyngdekraft", "to": "Frit fald"},
        {"from": "Acceleration", "to": "Frit fald"},
    ],
}


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    monkeypatch.setenv("GROUP_AUTH_SIGNING_SECRET", "test-secret-32-chars-long-enough-x")
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()
    yield
    fs_module._reset_client_for_testing()
    AnonymousGroupAuth.reset_for_tests()


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(activities_router)
    return app


def _teacher_client() -> TestClient:
    app = _app()

    async def _override(request: Request) -> User:
        u = User(uid="teacher-cm", email="teacher-cm@example.test", domain="example.test", is_teacher=True)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override
    return TestClient(app)


def _mock_model(monkeypatch, answer: Any, calls: list | None = None) -> None:
    async def _fake(prompt, **kwargs):
        if calls is not None:
            calls.append({"prompt": prompt, **kwargs})
        if isinstance(answer, Exception):
            raise answer
        text = answer if isinstance(answer, str) else json.dumps(answer)
        return Generation(text=text, model="gemini-test")

    monkeypatch.setattr(suggest, "generate", _fake)


def test_valid_answer_becomes_a_validated_map(monkeypatch):
    calls: list = []
    _mock_model(monkeypatch, VALID, calls)
    resp = _teacher_client().post(URL, json={"goal": GOAL, "language": "da", "title": "Frit fald"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    m = body["map"]
    assert m["title"] == "Frit fald"
    labels = [n["label"] for n in m["nodes"]]
    assert labels == ["Tyngdekraft", "Acceleration", "Frit fald"]
    by_label = {n["label"]: n for n in m["nodes"]}
    # Ids are minted (transliterated slugs), and the edges point at them.
    assert by_label["Frit fald"]["id"] == "frit_fald"
    assert {(e["from"], e["to"]) for e in m["edges"]} == {("tyngdekraft", "frit_fald"), ("acceleration", "frit_fald")}
    assert all(n["doneWhen"] for n in m["nodes"])
    assert all(n["checkQuestions"] == [] for n in m["nodes"])
    # One call, on the registered purpose, in the requested language.
    assert len(calls) == 1
    assert calls[0]["purpose"] == "concept_map_suggest"
    assert "Danish" in calls[0]["prompt"] and GOAL in calls[0]["prompt"]


def test_english_and_fenced_answer_with_node_ids(monkeypatch):
    answer = {
        "title": "Free fall",
        "nodes": [
            {"id": "n1", "label": "Gravity", "done_when": "Can say gravity pulls every body down."},
            {"id": "n2", "label": "Free fall", "done_when": "Can compute the fall time."},
        ],
        "edges": [{"from": "n1", "to": "n2"}],
    }
    calls: list = []
    _mock_model(monkeypatch, "Here you go:\n```json\n" + json.dumps(answer) + "\n```", calls)
    resp = _teacher_client().post(URL, json={"goal": "Understand free fall and gravity well", "language": "en"})
    body = resp.json()
    assert body["ok"] is True, body
    assert body["map"]["edges"] == [{"from": "gravity", "to": "free_fall"}]
    assert "English" in calls[0]["prompt"]


@pytest.mark.parametrize(
    "answer",
    [
        # a cycle: the DAG guard is the shared validator's
        {
            "nodes": [{"label": "A"}, {"label": "B"}, {"label": "C"}],
            "edges": [{"from": "A", "to": "B"}, {"from": "B", "to": "C"}, {"from": "C", "to": "A"}],
        },
        # an edge to a concept that is not in the map
        {"nodes": [{"label": "A"}, {"label": "B"}], "edges": [{"from": "A", "to": "Z"}]},
        # one concept is not a map
        {"nodes": [{"label": "A"}], "edges": []},
        # a concept without a label
        {"nodes": [{"label": "A"}, {"label": ""}], "edges": []},
        # no nodes list
        {"concepts": ["A", "B"]},
        "not json at all",
        RuntimeError("vertex down"),
    ],
)
def test_invalid_answer_is_refused_whole(monkeypatch, answer):
    _mock_model(monkeypatch, answer)
    resp = _teacher_client().post(URL, json={"goal": GOAL, "language": "da"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["error"]
    assert "map" not in body


@pytest.mark.parametrize("goal", ["", "   "])
def test_empty_goal_is_422(monkeypatch, goal):
    calls: list = []
    _mock_model(monkeypatch, VALID, calls)
    resp = _teacher_client().post(URL, json={"goal": goal, "language": "da"})
    assert resp.status_code == 422
    assert calls == []


def test_unknown_language_is_422(monkeypatch):
    _mock_model(monkeypatch, VALID)
    resp = _teacher_client().post(URL, json={"goal": GOAL, "language": "de"})
    assert resp.status_code == 422


def test_real_student_group_token_is_refused(monkeypatch):
    """A REAL group JWT through the REAL dispatcher (no override) → 403."""
    calls: list = []
    _mock_model(monkeypatch, VALID, calls)
    record = create_group(title="cm class", skill_ids=["concept-dialogue"], creator_uid="teacher-cm")
    token = join_group(record.group_id, client_ip="203.0.113.7").token
    resp = TestClient(_app()).post(
        URL, json={"goal": GOAL, "language": "da"}, headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 403
    assert calls == []


def test_parse_answer_tolerates_prose_and_fences():
    assert suggest.parse_answer('```json\n{"nodes": []}\n```') == {"nodes": []}
    assert suggest.parse_answer('Sure! {"a": 1} hope it helps') == {"a": 1}
    assert suggest.parse_answer("[1, 2]") is None
    assert suggest.parse_answer("") is None
