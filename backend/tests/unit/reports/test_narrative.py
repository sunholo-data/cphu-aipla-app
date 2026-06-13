"""Tests for reports.narrative — AI session-summary generation + cache (1.1.4).

The LLM call (`_call_gemini`) and the session-index store are mocked.
"""

from __future__ import annotations

from datetime import UTC, datetime
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

    def __init__(self, summary_text, based_on):
        self.summary_text = summary_text
        self.summary_based_on_turn_count = based_on
