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
    assert ev.summary == {"units": 7, "tutor": 4, "student": 3}


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
    with patch("analytics.session_rubric._call_judge_model", new=AsyncMock(return_value=json.dumps(payload))):
        r = await ff.score_fidelity(_summary(ESRU_DIALOGUE))
    assert not r.abstained
    assert r.overall_band == "partial"
    assert r.summary.startswith("The tutor asked open questions")
    assert r.drift == ["The use phase came only after the sim run."]
    assert set(r.constructs) == set(keys)
    assert r.constructs[keys[0]]["score"] == 2 and r.constructs[keys[0]]["evidence"] == [0, 2]
    assert r.based_on_message_count == 7
    assert r.spoken_included is False
    # Teacher view: prose, no bands, no construct detail.
    tv = r.teacher_view()
    assert "summary" in tv and "drift" in tv and "constructs" not in tv and "overallBand" not in tv
    assert "constructs" in r.researcher_view()


@pytest.mark.asyncio
async def test_resolve_caches_in_the_run_store_and_regenerates_when_the_session_grows():
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
