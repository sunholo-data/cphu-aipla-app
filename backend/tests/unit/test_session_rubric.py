"""RUBRIC-1 M0 — lens registry + evidence partition + MAPS judge.

Headline: EVIDENCE INTEGRITY. An AI tutor is a scaffolding machine that
destroys competency evidence (1.1.57's MAPS finding), so the judge only ever
scores student-INITIATED work — tutor-prompted answers are context, never
competence. And with no anchor pack the lens ABSTAINS: an uncalibrated judge
reports "uncalibrated", not a confident fabrication.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from analytics import session_rubric as sr
from db import firestore as fs_module
from db.firestore import set_document
from reports.session_summary import SessionSummary, SessionTurn


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _turn(role: str, content: str, ts: str = "2026-07-11T10:00:00Z") -> SessionTurn:
    return SessionTurn(timestamp=ts, role=role, content=content)


def _summary(turns: list[SessionTurn], activity_id: str = "act-1") -> SessionSummary:
    return SessionSummary(
        sessionId="s-1",
        groupCode="grp-7b",
        activityId=activity_id,
        startedAt=datetime.now(UTC),
        durationSeconds=600,
        messageCount=len(turns),
        simRunCount=0,
        conversation=turns,
    )


# --- lens registry ---


def test_registry_has_maps_and_saar_with_code_defaults():
    maps = sr.get_lens_config("maps")
    saar = sr.get_lens_config("saar")
    assert maps.enabled and saar.enabled
    assert maps.prompt_version.startswith("maps-")
    assert maps.model  # a concrete default model id


def test_firestore_override_merges_over_the_code_default():
    set_document("analytics_lens_configs", "maps", {"model": "gemini-2.5-pro", "enabled": False})
    cfg = sr.get_lens_config("maps")
    assert cfg.model == "gemini-2.5-pro"
    assert cfg.enabled is False
    # fields the override doesn't set keep the code default
    assert cfg.prompt_version.startswith("maps-")


def test_prompt_override_bumps_the_effective_version():
    set_document(
        "analytics_lens_configs",
        "maps",
        {"prompt_override": "You are a stricter judge.", "prompt_version": "maps-r2"},
    )
    cfg = sr.get_lens_config("maps")
    assert cfg.prompt_version == "maps-r2"
    assert "stricter" in (cfg.prompt_override or "")


def test_unknown_lens_raises():
    with pytest.raises(KeyError):
        sr.get_lens_config("bogus")


# --- evidence partition ---


def test_partition_student_answer_to_a_tutor_question_is_tutor_prompted():
    turns = [
        _turn("student", "Jeg tror rækkevidden er størst ved 45 grader, fordi sin og cos balancerer."),
        _turn("tutor", "Interessant! Hvad sker der med flyvetiden, hvis du øger vinklen?"),
        _turn("student", "Så bliver flyvetiden længere."),
        _turn("tutor", "Præcis. Prøv at regne højden ud."),
        _turn("student", "Jeg har regnet den til 5,1 m — her er min metode: h = vy²/2g."),
    ]
    p = sr.partition_evidence(turns)
    initiated = [t.content for t in p.student_initiated]
    prompted = [t.content for t in p.tutor_prompted]
    # opening prediction = initiated; answer to "Hvad sker der...?" = prompted;
    # unprompted worked method after a statement = initiated.
    assert any("45 grader" in c for c in initiated)
    assert any("flyvetiden længere" in c for c in prompted)
    assert any("min metode" in c for c in initiated)
    assert p.summary["student_initiated"] == 2
    assert p.summary["tutor_prompted"] == 1


def test_partition_of_empty_or_tutor_only_sessions_is_empty():
    p = sr.partition_evidence([_turn("tutor", "Hej! Hvad vil du undersøge?")])
    assert p.student_initiated == [] and p.tutor_prompted == []


# --- MAPS judge ---


def _anchored(activity_id: str = "act-1") -> None:
    set_document(
        "rubric_anchor_packs",
        activity_id,
        {
            "activityId": activity_id,
            "anchors": [
                {"solution": f"anchor {i}", "scores": {"physics_approach": 3}, "rationale": "r"} for i in range(5)
            ],
        },
    )


FAKE_JUDGE_JSON = """
{"useful_description": {"score": 4, "rationale": "clear sketch"},
 "physics_approach": {"score": 5, "rationale": "energy conservation chosen"},
 "specific_application": {"score": 3, "rationale": "sign slip"},
 "mathematical_procedures": {"score": "NA_solver", "rationale": "no independent math shown"},
 "logical_progression": {"score": 4, "rationale": "coherent"}}
"""


@pytest.mark.asyncio
async def test_maps_judge_scores_and_stamps_provenance(monkeypatch):
    _anchored()

    captured: dict = {}

    async def _fake_model(prompt: str, model: str) -> str:
        captured["prompt"] = prompt
        captured["model"] = model
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    turns = [
        _turn("student", "Min løsning: energibevarelse giver v = sqrt(2gh) = 7 m/s."),
        _turn("tutor", "Hvordan valgte du metoden?"),
        _turn("student", "Fordi der ikke er friktion."),
    ]
    res = await sr.score_session_summary(_summary(turns), "maps")
    assert res.abstained is False
    assert res.profile["physics_approach"]["score"] == 5
    assert res.profile["mathematical_procedures"]["score"] == "NA_solver"
    # provenance stamps
    assert res.lens_id == "maps"
    assert res.prompt_version.startswith("maps-")
    assert res.model == captured["model"]
    assert res.partition_summary["student_initiated"] == 1
    # evidence integrity: ONLY the student-initiated turn reaches the judge
    assert "energibevarelse" in captured["prompt"]
    assert "Fordi der ikke er friktion" not in captured["prompt"]
    # attribution rides the prompt (CC-BY condition)
    assert "Docktor" in captured["prompt"]


@pytest.mark.asyncio
async def test_maps_judge_abstains_without_an_anchor_pack(monkeypatch):
    async def _boom(prompt: str, model: str) -> str:
        raise AssertionError("the judge must not be called when abstaining")

    monkeypatch.setattr(sr, "_call_judge_model", _boom)
    res = await sr.score_session_summary(_summary([_turn("student", "x")]), "maps")
    assert res.abstained is True
    assert "anchor" in res.abstain_reason.lower()
    assert res.profile == {}


@pytest.mark.asyncio
async def test_maps_judge_abstains_with_no_scorable_evidence(monkeypatch):
    _anchored()

    async def _boom(prompt: str, model: str) -> str:
        raise AssertionError("no evidence -> no judge call")

    monkeypatch.setattr(sr, "_call_judge_model", _boom)
    res = await sr.score_session_summary(_summary([_turn("tutor", "Hej!")]), "maps")
    assert res.abstained is True
    assert "evidence" in res.abstain_reason.lower()


@pytest.mark.asyncio
async def test_disabled_lens_abstains(monkeypatch):
    _anchored()
    set_document("analytics_lens_configs", "maps", {"enabled": False})
    res = await sr.score_session_summary(_summary([_turn("student", "x")]), "maps")
    assert res.abstained is True and "disabled" in res.abstain_reason.lower()


@pytest.mark.asyncio
async def test_prompt_override_is_used_and_stamped(monkeypatch):
    _anchored()
    set_document(
        "analytics_lens_configs",
        "maps",
        {"prompt_override": "OVERRIDE-MARKER judge preamble", "prompt_version": "maps-r9"},
    )
    captured: dict = {}

    async def _fake_model(prompt: str, model: str) -> str:
        captured["prompt"] = prompt
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    res = await sr.score_session_summary(_summary([_turn("student", "Min metode: ...")]), "maps")
    assert "OVERRIDE-MARKER" in captured["prompt"]
    assert res.prompt_version == "maps-r9"


# --- RUBRIC-1 M2: SAAR judge (Lens D — testing-experiment rows) ---

FAKE_SAAR_JSON = """
{"identify_hypothesis": {"score": 3, "rationale": "clear"},
 "design_reliable_test": {"score": 3, "rationale": "refutation-oriented"},
 "distinguish_hypothesis_prediction": {"score": 2, "rationale": "mostly"},
 "make_prediction": {"score": 3, "rationale": "if-then stated"},
 "identify_assumptions": {"score": 1, "rationale": "unexamined"},
 "compare_prediction_outcome": {"score": 3, "rationale": "explicit"},
 "judge_hypothesis": {"score": 2, "rationale": "reasonable"},
 "revise_when_needed": {"score": "NA_problem", "rationale": "no revision was warranted"}}
"""


@pytest.mark.asyncio
async def test_saar_judge_scores_the_eight_rows(monkeypatch):
    _anchored()
    captured: dict = {}

    async def _fake_model(prompt: str, model: str) -> str:
        captured["prompt"] = prompt
        return FAKE_SAAR_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    turns = [
        _turn("student", "Min agent skal forklare enheder. Jeg tester den med opgaver, der kan AFVISE den."),
        _turn("tutor", "Godt design! Hvilke antagelser gør du?"),
        _turn("student", "At den altid svarer på dansk."),
    ]
    res = await sr.score_session_summary(_summary(turns), "saar")
    assert res.abstained is False
    assert res.profile["design_reliable_test"]["score"] == 3
    assert len(res.profile) == 8
    # calibration few-shot rides the prompt: the confirmation-bias NEGATIVE
    # (the Etkina "Student B" pattern) must be present so the judge can
    # distinguish refutation-oriented (3) from confirmation-oriented (1).
    assert "confirmation" in captured["prompt"].lower()
    assert "Etkina" in captured["prompt"]
    # evidence integrity holds for SAAR too
    assert "AFVISE" in captured["prompt"]
    assert "altid svarer på dansk" not in captured["prompt"]


@pytest.mark.asyncio
async def test_saar_abstains_like_maps_without_anchors(monkeypatch):
    async def _boom(prompt: str, model: str) -> str:
        raise AssertionError("no judge call when abstaining")

    monkeypatch.setattr(sr, "_call_judge_model", _boom)
    res = await sr.score_session_summary(_summary([_turn("student", "x")]), "saar")
    assert res.abstained is True and "anchor" in res.abstain_reason.lower()
