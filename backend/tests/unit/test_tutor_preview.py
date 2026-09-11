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
