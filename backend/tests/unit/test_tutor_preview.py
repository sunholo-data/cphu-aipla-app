"""Tutor preview (1.1.91 M3) — scratch conversations, side by side.

The properties that matter are about what a preview must NOT become: student
data, or something that reads as teaching.
"""

from __future__ import annotations

import asyncio

import pytest

from analytics import tutor_preview as tp


def test_the_preview_prefix_is_excluded_by_the_researcher_lens():
    """The lockstep that makes the whole no-student-data claim true.

    A preview is a real tutor turn carrying a real framework_id. If this prefix
    ever stops matching what the lens excludes, previews silently become
    classroom evidence in a framework tab — with nobody having been taught.
    """
    from analytics.research_logs import NON_STUDENT_PREFIXES

    assert tp.PREVIEW_PREFIX in NON_STUDENT_PREFIXES


def test_the_instruction_is_composed_from_the_real_approach(monkeypatch):
    """Not a paraphrase. A reviewer signing off a paraphrase is worse than no
    preview at all."""
    from db.framework_overrides import resolve_framework_instruction

    composed = tp.compose_preview_instruction("mikkel")
    if not composed.get("ok"):
        pytest.skip("no 'mikkel' tutor in this environment")
    real = resolve_framework_instruction(composed["composedFrom"]["approachId"])
    if real:
        assert real in composed["instruction"]


def test_it_says_what_a_preview_does_NOT_carry():
    """A preview has no activity, so it has none of the activity's context. It
    states that rather than implying parity with a lesson turn."""
    composed = tp.compose_preview_instruction("concept-dialogue")
    if not composed.get("ok"):
        pytest.skip("no skill-bound tutor in this environment")
    missing = composed["composedFrom"]["notIncluded"]
    assert "activity materials" in missing
    assert "teacher ILOs" in missing


def test_an_unknown_tutor_is_an_error_not_an_exception():
    """One bad id must not take the whole comparison down — the other tutor's
    reply is still worth having."""
    out = tp.compose_preview_instruction("no-such-tutor")
    assert out["ok"] is False
    assert "unknown tutor" in out["error"]


def test_a_tutor_with_nothing_to_say_is_refused_rather_than_run(monkeypatch):
    monkeypatch.setattr(
        tp,
        "compose_preview_instruction",
        lambda tid: {"ok": True, "tutorId": tid, "displayName": "Empty", "instruction": "  ", "composedFrom": {}},
    )
    out = asyncio.run(tp.run_preview_turn("empty", "hello", uid="r-1"))
    assert out["ok"] is False
    assert "no instructions to run" in out["error"]


def test_a_preview_turn_is_logged_for_COST_and_without_CONTENT(monkeypatch):
    """Both halves matter. Without the log a preview is invisible spend; with
    content it would be a transcript nobody consented to."""
    captured = {}

    import observability.chat_log as cl

    monkeypatch.setattr(cl, "emit_chat_turn", lambda **kw: captured.update(kw))
    tp._log_preview_turn(
        "mikkel",
        {"composedFrom": {"skill": "concept-dialogue", "approachId": "esru", "register": None}},
        uid="r-1",
    )

    assert captured["group_id"] == "preview:r-1"
    assert captured["content"] == ""
    assert captured["framework_id"] == "esru"
    # `teaching_source` says what decided this turn. 'preview' is neither
    # 'tutor' nor 'fields' — it is "no teaching happened here".
    assert captured["teaching_source"] == "preview"


def test_a_logging_failure_does_not_lose_the_turn(monkeypatch):
    """Telemetry must never break the thing it observes."""
    import observability.chat_log as cl

    def boom(**kw):
        raise RuntimeError("log sink down")

    monkeypatch.setattr(cl, "emit_chat_turn", boom)
    tp._log_preview_turn("mikkel", {"composedFrom": {"skill": "s", "approachId": None, "register": None}}, uid="r-1")
    # No exception — that is the assertion.


def test_at_most_two_tutors_are_compared():
    """Side by side is two. Three would not fit the comparison this is for."""
    assert tp.MAX_TUTORS == 2


# ── BENCH-1: approach composition + multi-turn preview ─────────────────────


def test_an_approach_composes_exactly_as_a_persona_tutor_carrying_it(monkeypatch):
    """The benchmark runs "the ESRU tutor" by approach. That must be the same
    instruction a persona tutor assigned ESRU gets in preview — the persona
    never enters the instruction."""
    from db.models.tutor import Tutor

    base = Tutor.model_validate(
        {
            "id": "mikkel",
            "displayName": "Mikkel",
            "summary": "s",
            "personaId": "mikkel",
            "frameworkId": "esru",
            "status": "ready",
            "authorRole": "researcher",
            "promptProvenance": "authored",
            "lineage": {"kind": "original"},
        }
    )
    monkeypatch.setattr("db.tutors.resolve_tutor", lambda tid: base)
    via_tutor = tp.compose_preview_instruction("mikkel")
    via_approach = tp.compose_approach_instruction("esru")
    assert via_approach["instruction"] == via_tutor["instruction"]
    assert via_approach["instruction"].strip()
    assert via_approach["tutorId"] == "approach:esru"
    assert via_approach["composedFrom"]["approachId"] == "esru"
    assert via_approach["composedFrom"]["persona"] is None


def test_a_dialogue_turn_carries_history_the_chosen_model_and_logs_as_preview(monkeypatch):
    import google.genai as genai

    captured: dict = {}
    logged: dict = {}

    class _Resp:
        text = "Hvad bygger du det på?"
        usage_metadata = type("U", (), {"prompt_token_count": 1200, "candidates_token_count": 40})()

    class _Models:
        async def generate_content(self, **kw):
            captured.update(kw)
            return _Resp()

    class _Client:
        def __init__(self, **kw):
            self.aio = type("A", (), {"models": _Models()})()

    monkeypatch.setattr(genai, "Client", _Client)
    import observability.chat_log as cl

    monkeypatch.setattr(cl, "emit_chat_turn", lambda **kw: logged.update(kw))
    composed = {
        "ok": True,
        "tutorId": "approach:esru",
        "instruction": "SYSTEM",
        "composedFrom": {"skill": "concept-dialogue", "approachId": "esru", "register": None},
    }
    history = [{"role": "student", "content": "hej"}, {"role": "tutor", "content": "hej selv"}]
    out = asyncio.run(
        tp.run_preview_dialogue_turn(
            composed, history, "tunge ting falder hurtigere", model="m-x", uid="bench", turn_index=3
        )
    )
    assert out["ok"] and out["reply"] == "Hvad bygger du det på?" and out["tokenIn"] == 1200
    assert captured["model"] == "m-x"
    assert [c["role"] for c in captured["contents"]] == ["user", "model", "user"]
    assert captured["config"]["system_instruction"] == "SYSTEM"
    assert logged["group_id"] == "preview:bench" and logged["content"] == "" and logged["model"] == "m-x"
    assert logged["turn_index"] == 3
