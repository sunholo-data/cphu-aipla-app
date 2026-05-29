"""Tests for the BigQuery-backed read path (SEQUENCE 1.2, M3).

summarize_session_bq reads the raw sink tables via mocked run_query;
resolve_session_summary is BQ-first with a session-state fallback.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from db import bigquery
from reports import session_summary


def _turn(ts, role, content, group="bold-kazoo-87", skill="boldkast", idx=0):
    return {
        "ts": ts,
        "group_id": group,
        "skill_id": skill,
        "role": role,
        "content": content,
        "turn_index": idx,
    }


async def test_summarize_session_bq_roundtrip():
    t0 = datetime(2026, 5, 29, 10, 0, 0, tzinfo=UTC)
    t1 = datetime(2026, 5, 29, 10, 1, 0, tzinfo=UTC)
    turns = [
        _turn(t0, "student", "why does it go further at 45?", idx=0),
        _turn(t1, "tutor", "think about the vertical and horizontal parts", idx=1),
    ]
    count = [{"n": 3}]
    with patch.object(bigquery, "run_query", side_effect=[turns, count]):
        summary = await session_summary.summarize_session_bq("sess-1")

    assert summary is not None
    assert summary.session_id == "sess-1"
    assert summary.group_code == "bold-kazoo-87"
    assert summary.activity_id == "boldkast"
    assert summary.message_count == 2
    assert summary.sim_run_count == 3  # exact COUNT, not the key heuristic
    assert [t.role for t in summary.conversation] == ["student", "tutor"]
    assert summary.duration_seconds == 60


async def test_summarize_session_bq_none_when_no_rows():
    with patch.object(bigquery, "run_query", return_value=[]):
        assert await session_summary.summarize_session_bq("sess-x") is None


async def test_summarize_session_bq_none_on_query_error():
    # Missing table / no creds -> None so the caller falls back.
    with patch.object(bigquery, "run_query", side_effect=RuntimeError("404 table not found")):
        assert await session_summary.summarize_session_bq("sess-x") is None


async def test_summarize_session_bq_sim_runs_zero_when_workbench_query_errors():
    t0 = datetime(2026, 5, 29, 10, 0, 0, tzinfo=UTC)
    turns = [_turn(t0, "student", "hi", idx=0)]
    # First call (turns) succeeds; second call (workbench count) raises.
    with patch.object(bigquery, "run_query", side_effect=[turns, RuntimeError("boom")]):
        summary = await session_summary.summarize_session_bq("sess-1")
    assert summary is not None
    assert summary.sim_run_count == 0


async def test_resolve_prefers_bq():
    bq_summary = MagicMock(name="bq_summary")
    with (
        patch.object(session_summary, "summarize_session_bq", AsyncMock(return_value=bq_summary)),
        patch.object(session_summary, "summarize_session", AsyncMock()) as fallback,
    ):
        result = await session_summary.resolve_session_summary("sess-1")
    assert result is bq_summary
    fallback.assert_not_awaited()


async def test_resolve_falls_back_to_session_state_when_bq_empty():
    fallback_summary = MagicMock(name="session_state_summary")
    with (
        patch.object(session_summary, "summarize_session_bq", AsyncMock(return_value=None)),
        patch.object(session_summary, "summarize_session", AsyncMock(return_value=fallback_summary)) as fallback,
    ):
        result = await session_summary.resolve_session_summary("sess-1")
    assert result is fallback_summary
    fallback.assert_awaited_once_with("sess-1")
