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


# --- RUBRIC-1 M3 follow-up: expose the default prompt (edit-from basis) ---


def test_lens_config_exposes_the_default_prompt():
    maps = sr.get_lens_config("maps")
    saar = sr.get_lens_config("saar")
    assert maps.default_prompt.startswith("You are a physics-education research judge")
    assert "MAPS rubric" in maps.default_prompt
    assert "SAAR scientific-abilities rubric" in saar.default_prompt


# --- RUBRIC-2 M3: versioning, promote, run recording ---


def test_upsert_tracks_a_versions_map():
    sr.upsert_rubric_def("clarity", label="C", prompt="P1", output_keys=["a"])
    d = sr.upsert_rubric_def("clarity", label="C", prompt="P2", output_keys=["a"])
    assert set(d["versions"]) == {"clarity-r1", "clarity-r2"}
    assert d["versions"]["clarity-r2"]["status"] == "draft"


def test_is_version_live_seed_lenses_are_always_live():
    assert sr.is_version_live("maps", "maps-r1") is True
    assert sr.is_version_live("saar", "saar-r7") is True


def test_promote_sets_the_live_version():
    sr.upsert_rubric_def("clarity", label="C", prompt="P1", output_keys=["a"])
    sr.upsert_rubric_def("clarity", label="C", prompt="P2", output_keys=["a"])
    # nothing promoted yet → experimental
    assert sr.is_version_live("clarity", "clarity-r2") is False
    sr.promote_rubric("clarity", 2)
    assert sr.is_version_live("clarity", "clarity-r2") is True
    assert sr.is_version_live("clarity", "clarity-r1") is False


def test_promote_accepts_several_version_spellings():
    sr.upsert_rubric_def("clarity", label="C", prompt="P1", output_keys=["a"])
    assert sr.promote_rubric("clarity", "clarity-r1") == "clarity-r1"
    assert sr.promote_rubric("clarity", "r1") == "clarity-r1"
    assert sr.promote_rubric("clarity", 1) == "clarity-r1"


def test_promote_rejects_seed_unknown_version_and_unknown_rubric():
    sr.upsert_rubric_def("clarity", label="C", prompt="P1", output_keys=["a"])
    with pytest.raises(ValueError, match="seed lens"):
        sr.promote_rubric("maps", 1)
    with pytest.raises(ValueError, match="no version"):
        sr.promote_rubric("clarity", 9)
    with pytest.raises(KeyError):
        sr.promote_rubric("ghost", 1)


@pytest.mark.asyncio
async def test_score_session_records_a_run(monkeypatch):
    _anchored()
    from reports import session_summary as ss

    async def _resolve(session_id: str):
        return _summary([_turn("student", "min løsning: v = 7 m/s")])

    monkeypatch.setattr(ss, "resolve_session_summary", _resolve)

    async def _fake_model(prompt: str, model: str) -> str:
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    res = await sr.score_session("s-1", "maps")
    assert res is not None and res.abstained is False

    from analytics.rubric_runs import list_rubric_runs

    runs = list_rubric_runs()
    assert any(r["session_id"] == "s-1" and r["rubric_id"] == "maps" and r["is_live"] is True for r in runs)


# --- RUBRIC-2 M2: uploaded doc/image evidence reaches the judge ---


@pytest.mark.asyncio
async def test_evidence_docs_lead_the_prompt_and_images_ride_the_call(monkeypatch):
    _anchored()
    import analytics.rubric_evidence as ev_mod
    from analytics.rubric_evidence import RubricEvidence

    evidence = RubricEvidence(
        doc_texts=["WORKSHEET: solve for v"],
        doc_refs=["doc-9"],
        image_parts=[object()],
        image_refs=["mat-1"],
    )

    async def _fake_ev(session_id, activity_id=""):
        return evidence

    monkeypatch.setattr(ev_mod, "load_session_evidence", _fake_ev)

    captured: dict = {}

    async def _fake_model(prompt: str, model: str, images=None) -> str:
        captured["prompt"] = prompt
        captured["images"] = images
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    res = await sr.score_session_summary(_summary([_turn("student", "min løsning: v = 7 m/s")]), "maps")
    # the uploaded document leads the prompt as context…
    assert "WORKSHEET: solve for v" in captured["prompt"]
    # …and the JSON contract still comes last (judge discipline preserved)
    assert captured["prompt"].rstrip().endswith(", ".join(_MAPS_CATEGORIES_KEYS()))
    # the image Part rode the multimodal call
    assert captured["images"] == evidence.image_parts
    # provenance stamps what the judge saw
    assert res.evidence_refs == ["doc:doc-9", "image:mat-1"]


def _MAPS_CATEGORIES_KEYS() -> list[str]:
    from analytics.session_rubric import _MAPS_CATEGORIES

    return list(_MAPS_CATEGORIES)


@pytest.mark.asyncio
async def test_no_evidence_uses_the_plain_text_call(monkeypatch):
    """A session with no uploads scores exactly as before — 2-arg judge call."""
    _anchored()

    async def _fake_model(prompt: str, model: str) -> str:  # NOTE: 2-arg, no images kwarg
        return FAKE_JUDGE_JSON

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    # get_session_index("s-1") is None in LOCAL_MODE → empty evidence → text call
    res = await sr.score_session_summary(_summary([_turn("student", "x")]), "maps")
    assert res.abstained is False
    assert res.evidence_refs == []


# --- RUBRIC-2 M1: free-form rubrics ---


def _make_rubric(rubric_id: str = "clarity", **over) -> dict:
    doc = {
        "rubric_id": rubric_id,
        "label": "Clarity of explanation",
        "prompt": "You are a judge of explanation clarity.",
        "output_keys": ["clarity", "precision"],
        "score_scale": "0-4",
        "family": "communication",
        "model": "gemini-2.5-flash",
        "requires_anchors": False,
        "prompt_version": f"{rubric_id}-r1",
    }
    doc.update(over)
    set_document("rubric_defs", rubric_id, doc)
    return doc


def test_get_lens_config_reads_a_free_form_rubric():
    _make_rubric()
    cfg = sr.get_lens_config("clarity")
    assert cfg.is_seed is False
    assert cfg.output_keys == ["clarity", "precision"]
    assert cfg.default_prompt.startswith("You are a judge")
    assert cfg.requires_anchors is False


def test_unknown_rubric_still_raises_keyerror():
    with pytest.raises(KeyError):
        sr.get_lens_config("does-not-exist")


def test_list_lens_configs_unions_seeds_and_custom():
    _make_rubric("clarity")
    _make_rubric("depth", label="Conceptual depth")
    ids = {c.lens_id for c in sr.list_lens_configs()}
    assert {"maps", "saar", "clarity", "depth"} <= ids


def test_upsert_rubric_def_bumps_version_only_on_prompt_change():
    d1 = sr.upsert_rubric_def("clarity", label="C", prompt="P1", output_keys=["a"])
    assert d1["prompt_version"] == "clarity-r1"
    d2 = sr.upsert_rubric_def("clarity", label="C2", prompt="P1", output_keys=["a", "b"])
    assert d2["prompt_version"] == "clarity-r1"  # same prompt → same version
    d3 = sr.upsert_rubric_def("clarity", label="C2", prompt="P2-edited", output_keys=["a"])
    assert d3["prompt_version"] == "clarity-r2"  # prompt changed → bump


def test_upsert_rejects_seed_ids_and_empty_keys():
    with pytest.raises(ValueError, match="seed lens"):
        sr.upsert_rubric_def("maps", label="x", prompt="p", output_keys=["a"])
    with pytest.raises(ValueError, match="output key"):
        sr.upsert_rubric_def("newone", label="x", prompt="p", output_keys=[])


@pytest.mark.asyncio
async def test_free_form_rubric_scores_via_the_generic_judge(monkeypatch):
    # No anchor pack, requires_anchors=False → it scores anyway (experimentation).
    _make_rubric("clarity", output_keys=["clarity", "precision"])
    captured: dict = {}

    async def _fake_model(prompt: str, model: str) -> str:
        captured["prompt"] = prompt
        return '{"clarity": {"score": 3, "rationale": "clear"}, "precision": {"score": 2, "rationale": "ok"}}'

    monkeypatch.setattr(sr, "_call_judge_model", _fake_model)
    turns = [_turn("student", "Min forklaring: energien bevares fordi der ikke er friktion.")]
    res = await sr.score_session_summary(_summary(turns), "clarity")
    assert res.abstained is False
    assert res.profile["clarity"]["score"] == 3
    assert set(res.profile) == {"clarity", "precision"}
    # the researcher's own prompt + the declared keys ride the judge call
    assert "explanation clarity" in captured["prompt"]
    assert "clarity, precision" in captured["prompt"]
    # evidence integrity holds for the generic path too
    assert "energien bevares" in captured["prompt"]


@pytest.mark.asyncio
async def test_free_form_rubric_can_require_anchors_and_abstain(monkeypatch):
    _make_rubric("strict", requires_anchors=True, output_keys=["a"])

    async def _boom(prompt: str, model: str) -> str:
        raise AssertionError("no judge call when abstaining")

    monkeypatch.setattr(sr, "_call_judge_model", _boom)
    res = await sr.score_session_summary(_summary([_turn("student", "x")], activity_id="unanchored"), "strict")
    assert res.abstained is True and "anchor" in res.abstain_reason.lower()


# --- RUBRIC-2 M0: group-code addressing ---


def test_looks_like_group_code_distinguishes_codes_from_session_ids():
    assert sr.looks_like_group_code("crisp-pebble-21")
    assert sr.looks_like_group_code("aipla-demo-1")  # demo code — not in wordlist, same shape
    # a UUID session id (5 hyphen-parts) is NOT a group code
    assert not sr.looks_like_group_code("3f9a1c2d-1234-4567-89ab-0123456789ab")
    # a non-numeric-tail thread id is not a group code
    assert not sr.looks_like_group_code("plain-thread-abc")
    assert not sr.looks_like_group_code("threadabc123")


def test_resolve_target_group_code_enumerates_all_sessions(monkeypatch):
    from reports import session_summary as ss

    monkeypatch.setattr(ss, "find_all_session_ids_for_group_bq", lambda code: ["s-new", "s-old"])
    assert sr.resolve_target("crisp-pebble-21") == ["s-new", "s-old"]


def test_resolve_target_session_id_passes_through():
    uuid = "3f9a1c2d-1234-4567-89ab-0123456789ab"
    assert sr.resolve_target(uuid) == [uuid]


@pytest.mark.asyncio
async def test_score_target_scores_the_newest_session_for_a_group(monkeypatch):
    from reports import session_summary as ss

    monkeypatch.setattr(ss, "find_all_session_ids_for_group_bq", lambda code: ["s-new", "s-old"])
    scored: dict = {}

    async def _fake_score_session(session_id: str, lens_id: str):
        scored["session_id"] = session_id
        return sr.RubricResult(sessionId=session_id, activityId="a", lensId=lens_id, promptVersion="maps-r1", model="m")

    monkeypatch.setattr(sr, "score_session", _fake_score_session)
    res = await sr.score_target("crisp-pebble-21", "maps")
    assert scored["session_id"] == "s-new"  # newest-first
    assert res is not None and res.session_id == "s-new"


@pytest.mark.asyncio
async def test_score_target_group_with_no_sessions_returns_none(monkeypatch):
    from reports import session_summary as ss

    monkeypatch.setattr(ss, "find_all_session_ids_for_group_bq", lambda code: [])
    assert await sr.score_target("crisp-pebble-21", "maps") is None


def test_default_prompt_is_the_builder_fallback_and_is_not_persisted():
    # The default shown in the UI is EXACTLY what the judge uses when no
    # override is set — one source of truth.
    from analytics.session_rubric import EvidencePartition, build_maps_prompt

    cfg = sr.get_lens_config("maps")
    part = EvidencePartition(student_initiated=[_turn("student", "min løsning")])
    assert cfg.default_prompt in build_maps_prompt(part, {"anchors": []}, cfg)

    # Setting an override never touches default_prompt (it's derived, not stored).
    set_document("analytics_lens_configs", "maps", {"prompt_override": "custom"})
    cfg2 = sr.get_lens_config("maps")
    assert cfg2.prompt_override == "custom"
    assert cfg2.default_prompt == cfg.default_prompt
