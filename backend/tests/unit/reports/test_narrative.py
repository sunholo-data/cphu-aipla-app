"""Tests for reports.narrative — AI session-summary generation + cache (1.1.4).

The LLM call (`_call_gemini`) and the session-index store are mocked.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from reports import narrative
from reports.session_summary import SessionSummary, SessionTurn, WorkbenchEvent

NOW = datetime(2026, 6, 15, tzinfo=UTC)


def _summary(*, turns: int = 2, events: bool = False) -> SessionSummary:
    convo = [SessionTurn(timestamp="2026-06-15T10:00:00Z", role="student", content=f"q{i}") for i in range(turns)]
    wb = (
        [WorkbenchEvent(timestamp="2026-06-15T10:01:00Z", server="boldkast", tool="state", field="angle", value="45")]
        if events
        else []
    )
    return SessionSummary(
        sessionId="s-1",
        groupCode="g-1",
        activityId="boldkast",
        startedAt=NOW,
        durationSeconds=600,
        messageCount=turns,
        simRunCount=1,
        conversation=convo,
        workbenchEvents=wb,
    )


def test_prompt_grounds_in_workbench_events() -> None:
    prompt = narrative.build_narrative_prompt(_summary(events=True))
    assert "boldkast.state angle=45" in prompt
    assert "invent" in prompt.lower()  # grounding instruction present


def test_prompt_marks_no_workbench_events() -> None:
    prompt = narrative.build_narrative_prompt(_summary(events=False))
    assert "(no workbench events)" in prompt


async def test_generate_empty_conversation_returns_empty() -> None:
    s = _summary(turns=0)
    assert await narrative.generate_narrative(s) == ""


async def test_resolve_generates_and_caches() -> None:
    s = _summary(turns=3)
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex(None, None)),
        patch.object(narrative, "_call_gemini", new=AsyncMock(return_value="A narrative.")),
        patch.object(narrative, "update_session_fields") as mock_update,
    ):
        result = await narrative.resolve_narrative(s)
    assert result == "A narrative."
    assert s.narrative == "A narrative."
    # cache written with the live message count
    args = mock_update.call_args.args
    assert args[0] == "s-1"
    assert args[1]["summaryText"] == "A narrative."
    assert args[1]["summaryBasedOnTurnCount"] == 3


async def test_resolve_uses_cache_when_fresh() -> None:
    s = _summary(turns=3)
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex("cached", 3)),
        patch.object(narrative, "_call_gemini", new=AsyncMock()) as mock_llm,
    ):
        result = await narrative.resolve_narrative(s)
    assert result == "cached"
    mock_llm.assert_not_called()


async def test_resolve_regenerates_when_turns_grew() -> None:
    s = _summary(turns=5)
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex("stale", 3)),
        patch.object(narrative, "_call_gemini", new=AsyncMock(return_value="fresh")),
        patch.object(narrative, "update_session_fields"),
    ):
        result = await narrative.resolve_narrative(s)
    assert result == "fresh"


async def test_resolve_debounced_serves_cache_when_grown_but_recent() -> None:
    # 1.1.36 A2: grew (5 > 3) BUT generated 1 min ago -> within the 5-min debounce
    # -> serve cache, no LLM (cost guard on a teacher refreshing a live lesson).
    s = _summary(turns=5)
    recent = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex("stale", 3, generated_at=recent)),
        patch.object(narrative, "_call_gemini", new=AsyncMock()) as mock_llm,
    ):
        result = await narrative.resolve_narrative(s)
    assert result == "stale"
    mock_llm.assert_not_called()


async def test_resolve_force_bypasses_debounce_and_regenerates() -> None:
    # Manual "Refresh summary" on a live drill-down: even within the debounce
    # window with a cached summary, force=True regenerates now.
    s = _summary(turns=5)
    recent = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex("stale", 3, generated_at=recent)),
        patch.object(narrative, "_call_gemini", new=AsyncMock(return_value="forced fresh")) as mock_llm,
        patch.object(narrative, "update_session_fields"),
    ):
        result = await narrative.resolve_narrative(s, force=True)
    assert result == "forced fresh"
    mock_llm.assert_called_once()


async def test_resolve_regenerates_when_voice_grew() -> None:
    # 1.1.36 A2: turns unchanged (3 == 3) but the audio transcript grew -> regen.
    s = _summary(turns=3)
    s.voice_transcript = "we discussed it aloud at length"
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex("stale", 3, voice_chars=0)),
        patch.object(narrative, "_call_gemini", new=AsyncMock(return_value="fresh w/ voice")),
        patch.object(narrative, "update_session_fields") as mock_update,
    ):
        result = await narrative.resolve_narrative(s)
    assert result == "fresh w/ voice"
    assert mock_update.call_args.args[1]["summaryBasedOnVoiceChars"] == len("we discussed it aloud at length")


async def test_resolve_swallows_llm_failure() -> None:
    s = _summary(turns=3)
    with (
        patch.object(narrative, "get_session_index", return_value=_FakeIndex(None, None)),
        patch.object(narrative, "_call_gemini", new=AsyncMock(side_effect=RuntimeError("boom"))),
    ):
        result = await narrative.resolve_narrative(s)
    assert result is None  # report still renders without a narrative


async def test_resolve_skips_empty_conversation() -> None:
    s = _summary(turns=0)
    with patch.object(narrative, "_call_gemini", new=AsyncMock()) as mock_llm:
        result = await narrative.resolve_narrative(s)
    assert result is None
    mock_llm.assert_not_called()


class _FakeIndex:
    """Minimal stand-in for ChatSessionIndex with the summary cache fields."""

    def __init__(self, summary_text, based_on, *, generated_at=None, voice_chars=0):
        self.summary_text = summary_text
        self.summary_based_on_turn_count = based_on
        self.summary_generated_at = generated_at
        self.summary_based_on_voice_chars = voice_chars


async def test_narrative_runs_on_the_analysis_model(monkeypatch) -> None:
    """BENCH-1 / 1.1.139 D1 — the narrative is after-the-fact, so it calls the
    analysis model, not the tutor's platform default."""
    import types

    from google import genai

    from config.models import analysis_model, default_model

    monkeypatch.delenv("ANALYSIS_MODEL", raising=False)
    seen: dict[str, str] = {}

    class _Models:
        async def generate_content(self, *, model: str, contents: str):
            seen["model"] = model
            return types.SimpleNamespace(text="ok")

    class _Client:
        def __init__(self, **_kw):
            self.aio = types.SimpleNamespace(models=_Models())

    monkeypatch.setattr(genai, "Client", _Client)

    assert await narrative._call_gemini("p") == "ok"
    assert seen["model"] == analysis_model()
    assert seen["model"] != default_model()


async def test_session_index_io_runs_off_the_event_loop() -> None:
    """1.1.131 follow-up: resolve_narrative's Firestore read and cache write are
    synchronous; inside the async report route they must not run on the loop
    thread that every student stream on the instance shares."""
    import threading
    from types import SimpleNamespace

    loop_thread = threading.get_ident()
    seen: dict[str, int] = {}

    def fake_index(session_id: str):
        seen["read"] = threading.get_ident()
        return SimpleNamespace(summary_text="", summary_based_on_turn_count=0)

    def fake_update(session_id: str, fields: dict) -> None:
        seen["write"] = threading.get_ident()

    with (
        patch.object(narrative, "get_session_index", fake_index),
        patch.object(narrative, "update_session_fields", fake_update),
        patch.object(narrative, "generate_narrative", AsyncMock(return_value="**Narrative** ok")),
    ):
        out = await narrative.resolve_narrative(_summary())

    assert out == "**Narrative** ok"
    assert seen["read"] != loop_thread, "get_session_index ran on the event loop"
    assert seen["write"] != loop_thread, "update_session_fields ran on the event loop"
