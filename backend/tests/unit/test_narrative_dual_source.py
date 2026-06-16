"""1.1.36 A1 — the narrative prompt summarises chat AND the spoken transcript."""

import asyncio
from datetime import UTC, datetime

from reports.narrative import build_narrative_prompt, generate_narrative
from reports.session_summary import SessionSummary, SessionTurn


def _summary(**kw):
    base = {
        "session_id": "s1",
        "group_code": "tiny-beetle-46",
        "activity_id": "a1",
        "started_at": datetime.now(UTC),
        "duration_seconds": 600,
        "message_count": 2,
        "sim_run_count": 0,
        "conversation": [SessionTurn(timestamp="t", role="student", content="hej tutor")],
    }
    base.update(kw)
    return SessionSummary(**base)


def test_prompt_includes_both_sources_labelled():
    p = build_narrative_prompt(_summary(voice_transcript="we argued the y-axis aloud"))
    assert "Chat with the tutor" in p and "hej tutor" in p
    assert "Spoken group discussion" in p and "we argued the y-axis aloud" in p


def test_prompt_marks_no_recording_when_absent():
    p = build_narrative_prompt(_summary(voice_transcript=None))
    assert "(no recorded discussion)" in p


def test_generates_from_voice_only_when_no_chat():
    # voice-only session (students talked, barely typed) still summarises —
    # the gate now allows conversation OR transcript. Early-returns "" only when
    # both are empty (no Gemini call).
    assert asyncio.run(generate_narrative(_summary(conversation=[], voice_transcript=None))) == ""
