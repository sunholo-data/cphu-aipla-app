"""Framework fidelity (1.1.107 M0 + M5) — the instrument that includes the tutor."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from analytics import framework_fidelity as ff
from db import firestore as fs_module
from frameworks.loader import load_framework
from reports.session_summary import SessionSummary, SessionTurn


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _turn(role: str, content: str) -> SessionTurn:
    return SessionTurn(timestamp="2026-09-21T10:00:00+00:00", role=role, content=content)


def _summary(
    turns: list[SessionTurn], *, framework_id: str | None = "esru", voice: str | None = None
) -> SessionSummary:
    return SessionSummary(
        sessionId="s-1",
        groupCode="bold-kazoo-87",
        activityId="act-1",
        startedAt=datetime(2026, 9, 21, 10, 0, tzinfo=UTC),
        endedAt=datetime(2026, 9, 21, 10, 20, tzinfo=UTC),
        durationSeconds=1200,
        messageCount=len(turns),
        simRunCount=0,
        conversation=turns,
        frameworkId=framework_id,
        tutorId="sofie-esru",
        voiceTranscript=voice,
    )


ESRU_DIALOGUE = [
    _turn("tutor", "Hvad tror du sker med kuglen, hvis vi fordobler massen?"),
    _turn("student", "Den falder hurtigere?"),
    _turn("tutor", "Så du siger, at tungere ting falder hurtigere. Hvad bygger du det på?"),
    _turn("student", "Det føles bare sådan."),
    _turn("tutor", "Godt at du siger det højt. Lad os prøve i simulationen — sæt massen til det dobbelte og se."),
    _turn("student", "Den faldt lige hurtigt!"),
    _turn("tutor", "Ja. Hvad betyder det så for din første idé?"),
]


# ── M0: the evidence rule includes the tutor ─────────────────────────────────


def test_dialogue_units_keep_order_and_the_tutor():
    ev = ff.dialogue_units(ESRU_DIALOGUE)
    assert [u.role for u in ev.units] == ["tutor", "student", "tutor", "student", "tutor", "student", "tutor"]
    assert [u.index for u in ev.units] == list(range(7))
    assert ev.summary == {"units": 7, "tutor": 4, "student": 3, "idScheme": "position"}


def test_dialogue_units_window_the_tail_and_say_so():
    turns = [_turn("tutor" if i % 2 == 0 else "student", f"t{i}") for i in range(100)]
    ev = ff.dialogue_units(turns, max_turns=10)
    assert len(ev.units) == 10
    assert ev.units[0].index == 90  # ids are the ORIGINAL turn positions
    assert ev.summary["truncated_from"] == 100


def test_the_competency_partition_is_not_used():
    """The whole point: `partition_evidence` discards the tutor; this must not."""
    from analytics.session_rubric import partition_evidence

    comp = partition_evidence(ESRU_DIALOGUE)
    assert all(t.role == "student" for t in comp.student_initiated + comp.tutor_prompted)
    assert ff.dialogue_units(ESRU_DIALOGUE).tutor_turns == 4


# ── the criteria are the YAML read back ──────────────────────────────────────


def test_criteria_are_generated_from_the_framework_yaml():
    fw = load_framework("accountable-talk")
    text, keys = ff.criteria_block(fw)
    assert keys == ["accountability_to_community", "accountability_to_knowledge", "accountability_to_reasoning"]
    # Every behaviour, every avoid line and every evaluation hint is in the criteria verbatim.
    for c in fw.constructs:
        for b in c.behaviours:
            assert b.text in text
        for a in c.avoid:
            assert a in text
        assert " ".join(c.evaluation_hint.split()) in text


def test_prompt_is_blind_to_the_arm():
    fw = load_framework("esru")
    prompt = ff.build_fidelity_prompt(fw, ff.dialogue_units(ESRU_DIALOGUE), None)
    lowered = prompt.lower()
    assert "configured" not in lowered.replace(
        "how the tutor was configured", ""
    )  # the one mention says NOT to assume it
    assert "sofie" not in lowered
    assert "[0] TUTOR:" in prompt and "[1] STUDENT:" in prompt


def test_spoken_transcript_is_labelled_and_scoped_by_setting():
    at = load_framework("accountable-talk")
    esru = load_framework("esru")
    ev = ff.dialogue_units(ESRU_DIALOGUE)
    p_at = ff.build_fidelity_prompt(at, ev, "Elev: jeg tror det er tyngden.")
    p_esru = ff.build_fidelity_prompt(esru, ev, "Elev: jeg tror det er tyngden.")
    assert "spoken discussion" in p_at and "where the community exists" in p_at
    assert "spoken discussion" in p_esru and "where the community exists" not in p_esru
    assert (
        "Tutor moves are evidenced ONLY from the chat" in p_at
        and "tutor moves are evidenced ONLY from the chat" in p_esru
    )
    assert "spoken discussion (transcript)" not in ff.build_fidelity_prompt(esru, ev, None)


# ── abstain over fabricate ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_abstains_without_a_framework_and_never_calls_the_judge():
    with patch("analytics.session_rubric._call_judge_model", new=AsyncMock()) as judge:
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE, framework_id=None))
    assert r.abstained and "named teaching approach" in r.abstain_reason
    judge.assert_not_called()


@pytest.mark.asyncio
async def test_abstains_on_too_little_dialogue():
    with patch("analytics.session_rubric._call_judge_model", new=AsyncMock()) as judge:
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE[:3]))
    assert r.abstained and "too little dialogue" in r.abstain_reason
    assert r.framework_label == load_framework("esru").label
    judge.assert_not_called()


@pytest.mark.asyncio
async def test_abstains_on_an_unknown_framework():
    r = await ff.score_fidelity(_summary(ESRU_DIALOGUE, framework_id="nope"))
    assert r.abstained and "unknown" in r.abstain_reason


# ── a scored read ────────────────────────────────────────────────────────────

_JUDGE_JSON = json.dumps(
    {
        "constructs": {
            "elicit": {"band": "strong", "rationale": "Open questions throughout.", "evidence": [0, 2]},
            "student_response": {"band": "partial", "rationale": "Short answers.", "evidence": [1, 3]},
            "recognise": {"band": "strong", "rationale": "Revoiced the claim.", "evidence": [2]},
            "use": {"band": "partial", "rationale": "One use move, late.", "evidence": [4, 6]},
        },
        "overall": {
            "band": "partial",
            "summary": "The tutor asked open questions and revoiced the group's claim, then used the simulation once.",
            "drift": ["The use phase came only after the sim run."],
        },
    }
)


@pytest.mark.asyncio
async def test_scored_read_carries_prose_bands_and_evidence():
    fw = load_framework("esru")
    _, keys = ff.criteria_block(fw)
    payload = json.loads(_JUDGE_JSON)
    # Re-key onto whatever ESRU's constructs are actually called, so the test
    # follows the YAML rather than pinning its names.
    payload["constructs"] = dict(zip(keys, payload["constructs"].values(), strict=False))
    payload["constructs"][keys[0]]["moves"] = [ff.move_id(keys[0], 1)]  # r2: a strong band cites its move
    with patch("analytics.session_rubric._call_judge_model", new=AsyncMock(return_value=json.dumps(payload))):
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE))
    assert not r.abstained
    assert r.overall_band == "partial"
    assert r.summary.startswith("The tutor asked open questions")
    assert r.drift == ["The use phase came only after the sim run."]
    assert set(r.constructs) == set(keys)
    assert r.constructs[keys[0]]["score"] == 2
    assert [e["turn"] for e in r.constructs[keys[0]]["evidence"]] == [0, 2]
    assert r.based_on_message_count == 7
    assert r.spoken_included is False
    # Teacher view: prose, no bands, no construct detail.
    tv = r.teacher_view()
    assert "summary" in tv and "drift" in tv and "constructs" not in tv and "overallBand" not in tv
    assert "constructs" in r.researcher_view()


@pytest.mark.asyncio
async def test_resolve_caches_in_the_run_store_and_regenerates_when_the_session_grows(monkeypatch):
    monkeypatch.setattr(ff, "RESCORE_MIN_INTERVAL_S", 0)  # the debounce has its own test
    fw = load_framework("esru")
    _, keys = ff.criteria_block(fw)
    payload = json.loads(_JUDGE_JSON)
    payload["constructs"] = dict(zip(keys, payload["constructs"].values(), strict=False))
    judge = AsyncMock(return_value=json.dumps(payload))
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        first = await ff.resolve_fidelity(_summary(ESRU_DIALOGUE))
        again = await ff.resolve_fidelity(_summary(ESRU_DIALOGUE))
        assert judge.await_count == 1  # served from the run store
        assert again is not None and again.summary == first.summary
        grown = await ff.resolve_fidelity(_summary([*ESRU_DIALOGUE, _turn("student", "ok"), _turn("tutor", "Godt.")]))
        assert judge.await_count == 2  # the session grew → regenerated
        assert grown.based_on_message_count == 9
        forced = await ff.resolve_fidelity(_summary(ESRU_DIALOGUE), force=True)
        assert judge.await_count == 3 and forced is not None


# ── BENCH-1: the judge runs on the analysis model, never the tutor's ─────────


@pytest.mark.asyncio
async def test_the_judge_defaults_to_the_analysis_model_not_the_tutors():
    """The judge used to run on the same flash-lite as the tutor it judges."""
    from config.models import default_model

    fw = load_framework("esru")
    _, keys = ff.criteria_block(fw)
    payload = json.loads(_JUDGE_JSON)
    payload["constructs"] = dict(zip(keys, payload["constructs"].values(), strict=False))
    judge = AsyncMock(return_value=json.dumps(payload))
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE))
    assert r.model == ff.analysis_judge_model()
    assert judge.await_args.args[1] == ff.analysis_judge_model()
    assert ff.analysis_judge_model() != default_model()


# ── BENCH-2: calibration (fidelity-r2) ────────────────────────────────────────
#
# BENCH-1 (2026-09-30) found ESRU's column at 0.88-1.00 for transcripts from ALL
# seven tutors and CER's at ~0 for all seven. These pin the judge-side fixes.
# No real model call anywhere: the judge is mocked, so what is tested is the
# rule WIRING (prompt text + parser), not the model's obedience to it.


def test_prompt_version_is_bumped_so_stored_runs_stay_attributable():
    assert ff.PROMPT_VERSION == "fidelity-r3"


@pytest.mark.parametrize("fw_id", ["5e", "accountable-talk", "authentic-dialogue", "cer", "esru", "poe", "toulmin"])
def test_the_generic_specific_move_rule_is_in_every_prompt(fw_id):
    fw = load_framework(fw_id)
    prompt = ff.build_fidelity_prompt(fw, ff.dialogue_units(ESRU_DIALOGUE), None)
    assert ff.BANDING_RULE in prompt
    assert "any competent questioning tutor" in prompt
    assert "would a capable tutor following NO particular teaching approach" in prompt
    # Spoken counts — the CER failure was a judge demanding a written product.
    assert "SAID in a turn counts" in prompt
    assert '"moves"' in prompt
    # The rule sits between the criteria and the dialogue it governs.
    assert prompt.index("# Criteria") < prompt.index(ff.BANDING_RULE) < prompt.index("# The dialogue")


def test_criteria_number_every_move_so_a_strong_band_can_cite_one():
    fw = load_framework("esru")
    text, keys = ff.criteria_block(fw)
    counts = ff.move_counts(fw)
    for c, k in zip(fw.constructs, keys, strict=True):
        assert counts[k] == len(c.behaviours)
        for i, b in enumerate(c.behaviours, 1):
            assert f"[{ff.move_id(k, i)}] {b.text}" in text


def test_esru_criteria_require_the_use_step_to_hand_the_thinking_back():
    """ESRU's discriminating move is USE; generic follow-up questioning is not it."""
    text, keys = ff.criteria_block(load_framework("esru"))
    assert "use" in keys
    use = text[text.index("### use") :]
    assert "hand the thinking BACK" in use
    assert "explaining the correct idea itself is IRE/F Feedback, not Use" in use
    recognise = text[text.index("### recognise") : text.index("### use")]
    assert "WITHOUT a verdict" in recognise


def test_cer_scores_what_a_dialogue_can_show_and_names_what_it_cannot():
    fw = load_framework("cer")
    text, keys = ff.criteria_block(fw)
    assert keys == ["make_the_framework_explicit", "rationale_for_explaining", "assess_and_feedback"]
    na = ff.not_assessed(fw)
    assert set(na) == {"model_and_critique", "connect_to_everyday_explanation"}
    assert all("teaching unit" in reason for reason in na.values())
    assert "### model_and_critique" not in text and "### connect_to_everyday_explanation" not in text
    assert "A spoken claim counts" in text


def test_assessed_in_is_judge_only_the_tutor_is_still_told_every_move():
    """Calibrating the judge must not change what the tutor is told."""
    from frameworks.instruction import build_framework_instruction

    fw = load_framework("cer")
    instruction = build_framework_instruction(fw)
    for c in fw.constructs:
        for b in c.behaviours:
            assert b.text in instruction
    assert "assessedIn" not in instruction and "teaching unit" not in instruction
    for other in ("5e", "accountable-talk", "authentic-dialogue", "esru", "poe", "toulmin"):
        assert ff.not_assessed(load_framework(other)) == {}


def _all_strong(keys: list[str], moves: dict[str, list[str]] | None = None) -> str:
    return json.dumps(
        {
            "constructs": {
                k: {"band": "strong", "rationale": "r", "moves": (moves or {}).get(k, []), "evidence": [0]}
                for k in keys
            },
            "overall": {"band": "strong", "summary": "s", "drift": []},
        }
    )


def test_parser_downgrades_a_strong_band_without_its_own_move():
    keys = ["elicit", "use"]
    raw = _all_strong(keys, {"elicit": ["elicit.2"], "use": ["elicit.1"]})  # use cites ANOTHER construct's move
    parsed = ff.parse_judgement(raw, keys)
    assert parsed["constructs"]["elicit"]["band"] == "strong" and parsed["constructs"]["elicit"]["score"] == 2
    assert parsed["constructs"]["elicit"]["moves"] == ["elicit.2"]
    assert parsed["constructs"]["use"]["band"] == "partial" and parsed["constructs"]["use"]["score"] == 1
    assert parsed["constructs"]["use"]["downgraded"]


def test_parser_range_checks_move_ids_when_counts_are_known():
    keys = ["use"]
    raw = _all_strong(keys, {"use": ["use.99"]})
    assert ff.parse_judgement(raw, keys)["constructs"]["use"]["band"] == "strong"  # shape-only check
    assert ff.parse_judgement(raw, keys, {"use": 12})["constructs"]["use"]["band"] == "partial"


GENERIC_QUESTIONING = [
    _turn("tutor", "Godt spørgsmål! Hvad tror du selv?"),
    _turn("student", "At den tunge falder hurtigst."),
    _turn("tutor", "Helt rigtigt tænkt! Tyngdekraften er større, men massen er også større, så de falder ens."),
    _turn("student", "Okay."),
    _turn("tutor", "Præcis. Har du andre spørgsmål om frit fald?"),
    _turn("student", "Nej."),
    _turn("tutor", "Super, godt arbejde i dag!"),
]


@pytest.mark.asyncio
async def test_judge_sanity_generic_questioning_is_not_strong_esru():
    """A generous judge that calls every ESRU construct strong on a generic,
    praise-and-explain transcript, citing no ESRU move, must not produce a
    strong ESRU read. Tests the rule wiring, not the model."""
    fw = load_framework("esru")
    _, keys = ff.criteria_block(fw)
    judge = AsyncMock(return_value=_all_strong(keys))
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        r = await ff.score_fidelity(_summary(GENERIC_QUESTIONING))
    assert not r.abstained
    assert all(c["band"] != "strong" for c in r.constructs.values())
    assert all(c.get("downgraded") for c in r.constructs.values())
    assert r.prompt_version == "fidelity-r3"


@pytest.mark.asyncio
async def test_cer_read_records_what_was_not_assessed_rather_than_a_zero():
    fw = load_framework("cer")
    _, keys = ff.criteria_block(fw)
    judge = AsyncMock(return_value=_all_strong(keys, {k: [ff.move_id(k, 1)] for k in keys}))
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE, framework_id="cer"))
    assert set(r.constructs) == set(keys)
    assert set(r.not_assessed) == {"model_and_critique", "connect_to_everyday_explanation"}
    assert "notAssessed" in r.researcher_view()
    assert "model_and_critique" not in judge.await_args.args[0]


@pytest.mark.asyncio
async def test_a_framework_with_nothing_a_dialogue_can_show_abstains_without_a_call():
    fw = load_framework("cer").model_copy(deep=True)
    for c in fw.constructs:
        c.assessed_in = "unit"
    judge = AsyncMock()
    with (
        patch.object(ff, "effective_framework", return_value=fw),
        patch("analytics.session_rubric._call_judge_model", new=judge),
    ):
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE, framework_id="cer"))
    assert r.abstained and "single tutoring dialogue" in r.abstain_reason
    judge.assert_not_called()


# ── 1.1.148 M1: one turn identity (fidelity-r3) ──────────────────────────────
#
# Prod, 2026-10-05: the judge cited 0-based POSITIONS in the conversation list;
# the transcript labels turns by the emitter's ADK event index. Position 43 was
# transcript #98. These pin the fix: the judge sees, and cites, the #N.

#: Sparse, as the emitter writes them: tool events take indexes too.
SPARSE = [0, 1, 3, 6, 7, 10, 12]


def _sparse_dialogue() -> list[SessionTurn]:
    return [
        SessionTurn(timestamp="2026-10-05T10:00:00+00:00", role=t.role, content=t.content, turnIndex=ti)
        for t, ti in zip(ESRU_DIALOGUE, SPARSE, strict=True)
    ]


def _esru_payload(evidence_by_construct: dict[int, list]) -> tuple[list[str], str]:
    fw = load_framework("esru")
    _, keys = ff.criteria_block(fw)
    constructs = {
        k: {"band": "partial", "rationale": "r", "moves": [], "evidence": evidence_by_construct.get(i, [])}
        for i, k in enumerate(keys)
    }
    raw = json.dumps({"constructs": constructs, "overall": {"band": "partial", "summary": "s", "drift": []}})
    return keys, raw


def test_dialogue_ids_are_the_emitters_turn_index():
    ev = ff.dialogue_units(_sparse_dialogue())
    assert ev.id_scheme == ff.ID_TURN_INDEX
    assert [u.index for u in ev.units] == SPARSE
    assert [u.position for u in ev.units] == list(range(7))
    assert ev.summary["idScheme"] == "turn_index"
    prompt = ff.build_fidelity_prompt(load_framework("esru"), ev, None)
    assert "[3] TUTOR:" in prompt and "[6] STUDENT:" in prompt
    assert "[2] " not in prompt  # position 2 is turn #3 — never the position


def test_a_duplicate_or_missing_turn_index_falls_back_to_position_and_says_so():
    turns = _sparse_dialogue()
    turns[3] = turns[3].model_copy(update={"turn_index": 1})  # a duplicate (M0 Q4)
    ev = ff.dialogue_units(turns)
    assert ev.id_scheme == ff.ID_POSITION and [u.index for u in ev.units] == list(range(7))
    turns[3] = turns[3].model_copy(update={"turn_index": None})
    assert ff.dialogue_units(turns).id_scheme == ff.ID_POSITION


def test_parser_rejects_ids_outside_the_scored_window():
    ev = ff.dialogue_units(_sparse_dialogue())
    keys, raw = _esru_payload({0: [{"turn": 7, "quote": "Lad os prøve i simulationen"}, {"turn": 2}, {"turn": 98}]})
    parsed = ff.parse_judgement(raw, keys, None, ev)
    c = parsed["constructs"][keys[0]]
    assert [e["turn"] for e in c["evidence"]] == [7]
    assert c["evidence"][0]["role"] == "tutor"
    assert sorted(r["turn"] for r in c["rejectedEvidence"]) == [2, 98]


def test_quote_verification_match_whitespace_case_and_miss():
    content = "Så du siger, at tungere ting falder hurtigere. Hvad bygger du det på?"
    assert ff.quote_verified("tungere ting falder hurtigere", content)
    assert ff.quote_verified("  Tungere   ting\nfalder  HURTIGERE ", content)  # whitespace + case
    assert ff.quote_verified('"Så du siger … Hvad bygger du det på?"', content)  # an elision, in order
    assert not ff.quote_verified("lettere ting falder hurtigere", content)  # not said
    assert not ff.quote_verified("Hvad bygger du det på? … Så du siger", content)  # out of order
    assert not ff.quote_verified("", content) and not ff.quote_verified(None, content)


def test_each_quote_is_checked_against_the_turn_it_names():
    ev = ff.dialogue_units(_sparse_dialogue())
    keys, raw = _esru_payload(
        {
            0: [
                {"turn": 3, "quote": "tungere ting falder hurtigere"},  # really in #3
                {"turn": 12, "quote": "tungere ting falder hurtigere"},  # NOT in #12
            ]
        }
    )
    ev_out = ff.parse_judgement(raw, keys, None, ev)["constructs"][keys[0]]["evidence"]
    assert [(e["turn"], e["verified"]) for e in ev_out] == [(3, True), (12, False)]
    assert ev_out[0]["role"] == "tutor"


@pytest.mark.asyncio
async def test_an_r3_read_cites_turn_index_and_presents_the_transcript_number():
    keys, raw = _esru_payload({0: [{"turn": 7, "quote": "Lad os prøve i simulationen"}]})
    with patch("analytics.session_rubric._call_judge_model", new=AsyncMock(return_value=raw)):
        r = await ff.score_fidelity(_summary(_sparse_dialogue()))
    assert r.evidence_summary["idScheme"] == "turn_index"
    view = r.researcher_view(_sparse_dialogue())
    e = view["constructs"][keys[0]]["evidence"][0]
    assert e["turn"] == 7 and e["transcriptTurn"] == 7 and e["position"] == 4
    assert e["verified"] is True and e["snippet"].startswith("Godt at du siger")
    assert view["idScheme"] == "turn_index"
    assert view["runId"].endswith("fidelity-r3_fwyaml") and view["rubricVersion"] == "fidelity-r3+fwyaml"


def test_an_r2_run_is_translated_from_position_to_the_transcript_number():
    """A stored r2 run cited POSITIONS. Read time maps them to #N, once,
    deterministically, and says so. The stored run is not rewritten."""
    r2 = ff.FidelityResult(
        sessionId="s-1",
        frameworkId="esru",
        promptVersion="fidelity-r2",
        constructs={"elicit": {"band": "partial", "score": 1, "rationale": "r", "evidence": [2, 4, 40]}},
        evidenceSummary={"units": 7, "tutor": 4, "student": 3},
    )
    view = r2.researcher_view(_sparse_dialogue())
    assert view["idScheme"] == "position-translated"
    ev = view["constructs"]["elicit"]["evidence"]
    assert [(e["turn"], e["transcriptTurn"]) for e in ev] == [(2, 3), (4, 7)]
    assert view["constructs"]["elicit"]["rejectedEvidence"][0]["turn"] == 40  # beyond the session
    assert r2.constructs["elicit"]["evidence"] == [2, 4, 40]  # untouched
    assert view["runId"].endswith("fidelity-r2")  # pre-r3 runs keep their id


def test_the_prompt_asks_for_quotes_and_one_turn_per_construct():
    prompt = ff.build_fidelity_prompt(load_framework("esru"), ff.dialogue_units(_sparse_dialogue()), None)
    assert '"quote"' in prompt and "word for word" in prompt
    assert "Do not cite one turn for several constructs" in prompt
    assert "#<turn id>" in prompt  # drift lines use the same ids


# ── 1.1.148 M5: the criteria version rides every run ─────────────────────────


@pytest.mark.asyncio
async def test_a_criteria_edit_yields_a_new_run_beside_the_old_one():
    from analytics.rubric_runs import list_rubric_runs
    from db.framework_overrides import criteria_version, save_framework_structure

    _, raw = _esru_payload({})
    judge = AsyncMock(return_value=raw)
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        first = await ff.resolve_fidelity(_summary(ESRU_DIALOGUE))
        assert first.rubric_version == "fidelity-r3+fwyaml"
        await ff.resolve_fidelity(_summary(ESRU_DIALOGUE))
        assert judge.await_count == 1  # cached

        fw = load_framework("esru")
        save_framework_structure(
            "esru", {"constructs": fw.model_dump(by_alias=True, mode="json")["constructs"]}, updated_by="r@ku.dk"
        )
        assert criteria_version("esru") == "1"
        second = await ff.resolve_fidelity(_summary(ESRU_DIALOGUE))
    assert judge.await_count == 2  # the cache missed honestly
    assert second.rubric_version == "fidelity-r3+fw1" and second.criteria_version == "1"
    versions = sorted(r["rubric_version"] for r in list_rubric_runs(rubric_id="fidelity:esru"))
    assert versions == ["fidelity-r3+fw1", "fidelity-r3+fwyaml"]  # the old run is still listable


# ── M0 finding: one session judged three times in a minute ────────────────────


@pytest.mark.asyncio
async def test_a_growing_session_is_not_rejudged_inside_the_debounce():
    _, raw = _esru_payload({})
    judge = AsyncMock(return_value=raw)
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        await ff.resolve_fidelity(_summary(ESRU_DIALOGUE))
        grown = [*ESRU_DIALOGUE, _turn("student", "ok"), _turn("tutor", "Godt.")]
        r = await ff.resolve_fidelity(_summary(grown))
        assert judge.await_count == 1 and r.based_on_message_count == 7  # served, and says what it was built on
        await ff.resolve_fidelity(_summary(grown), force=True)
        assert judge.await_count == 2  # Refresh still forces


@pytest.mark.asyncio
async def test_concurrent_report_reads_share_one_judgement():
    import asyncio

    _, raw = _esru_payload({})

    async def slow(*_a, **_k):
        await asyncio.sleep(0.05)
        return raw

    judge = AsyncMock(side_effect=slow)
    with patch("analytics.session_rubric._call_judge_model", new=judge):
        a, b, c = await asyncio.gather(*(ff.resolve_fidelity(_summary(ESRU_DIALOGUE)) for _ in range(3)))
    assert judge.await_count == 1
    assert a is not None and a.scored_at == b.scored_at == c.scored_at


def test_run_history_keeps_the_mirror_apart_from_the_store():
    """BigQuery unreadable is said as such — never an empty history."""
    with patch("db.bigquery.run_query", side_effect=RuntimeError("no creds")):
        h = ff.fidelity_run_history("s-1", _sparse_dialogue())
    assert h["emissionsStatus"] == "unreadable" and h["emissions"] == []

    profile = ff.FidelityResult(
        sessionId="s-1",
        frameworkId="esru",
        promptVersion="fidelity-r2",
        overallBand="partial",
        constructs={"elicit": {"band": "partial", "score": 1, "rationale": "r", "evidence": [2]}},
    ).model_dump(by_alias=True, mode="json")
    rows = [
        {"ts": datetime(2026, 10, 5, 9, 47, tzinfo=UTC), "run_id": "x", "v": "fidelity-r2", "p": json.dumps(profile)},
        {"ts": datetime(2026, 10, 5, 9, 46, tzinfo=UTC), "run_id": "x", "v": "fidelity-r2", "p": json.dumps(profile)},
    ]
    with patch("db.bigquery.run_query", return_value=rows):
        h = ff.fidelity_run_history("s-1", _sparse_dialogue())
    assert h["emissionsStatus"] == "ok" and len(h["emissions"]) == 2
    assert h["emissions"][0]["constructs"]["elicit"]["evidence"][0]["transcriptTurn"] == 3
    assert h["emissions"][0]["idScheme"] == "position-translated"
