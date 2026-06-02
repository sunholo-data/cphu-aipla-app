"""Tests for the BigQuery-backed read path (SEQUENCE 1.2, M3).

summarize_session_bq reads the raw sink tables via mocked run_query;
resolve_session_summary is BQ-first with a session-state fallback.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from db import bigquery
from protocols import reports_routes
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


def _wb(ts, server="boldkast", tool="state", field="theta", value="45"):
    return {"ts": ts, "server": server, "tool": tool, "field": field, "value": value}


async def test_summarize_session_bq_roundtrip():
    t0 = datetime(2026, 5, 29, 10, 0, 0, tzinfo=UTC)
    t1 = datetime(2026, 5, 29, 10, 1, 0, tzinfo=UTC)
    turns = [
        _turn(t0, "student", "why does it go further at 45?", idx=0),
        _turn(t1, "tutor", "think about the vertical and horizontal parts", idx=1),
    ]
    wb_events = [_wb(t0, field="theta", value="45"), _wb(t0, field="v0", value="10"), _wb(t1, field="g", value="9.8")]
    with patch.object(bigquery, "run_query", side_effect=[turns, wb_events]):
        summary = await session_summary.summarize_session_bq("sess-1")

    assert summary is not None
    assert summary.session_id == "sess-1"
    assert summary.group_code == "bold-kazoo-87"
    assert summary.activity_id == "boldkast"
    assert summary.message_count == 2
    assert summary.sim_run_count == 3  # exact COUNT, derived from len(workbench_events)
    assert len(summary.workbench_events) == 3
    assert summary.workbench_events[0].server == "boldkast"
    assert summary.workbench_events[0].field == "theta"
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


# --- group-code consistency fix (V1) ---


def test_find_latest_session_for_group_cleans_hyphens():
    """The ownerUid prefix must use the hyphen-stripped code (matches _synthesize_uid)."""
    captured = {}

    def fake_query(collection, filters=None, limit=None):
        captured["filters"] = filters
        return []

    with patch.object(session_summary, "query_documents", side_effect=fake_query):
        session_summary.find_latest_session_for_group("aipla-demo-1")

    lo = next(value for (field, op, value) in captured["filters"] if op == ">=")
    assert lo == "anon-aiplademo1-"  # NOT "anon-aipla-demo-1-"


# --- ?source=bq report mode (V1) ---


async def test_report_source_bq_404_when_not_in_bq():
    # source=bq must NOT fall back to session state — 404 until BQ has the row.
    with patch.object(reports_routes, "summarize_session_bq", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc:
            await reports_routes.get_session_report(session_id="s", source="bq", _user=MagicMock())
    assert exc.value.status_code == 404


async def test_report_source_bq_returns_when_present():
    summ = session_summary.SessionSummary(
        sessionId="s",
        groupCode="aipla-demo-1",
        activityId="boldkast",
        startedAt=datetime(2026, 5, 29, tzinfo=UTC),
        endedAt=None,
        durationSeconds=0,
        messageCount=1,
        simRunCount=0,
        conversation=[],
    )
    with patch.object(reports_routes, "summarize_session_bq", AsyncMock(return_value=summ)):
        result = await reports_routes.get_session_report(session_id="s", source="bq", _user=MagicMock())
    assert result["groupCode"] == "aipla-demo-1"


async def test_report_source_auto_uses_resolve():
    with (
        patch.object(reports_routes, "resolve_session_summary", AsyncMock(return_value=MagicMock())) as resolve,
        patch.object(reports_routes, "_serialize", lambda s: {"ok": True}),
    ):
        result = await reports_routes.get_session_report(session_id="s", source="auto", _user=MagicMock())
    assert result == {"ok": True}
    resolve.assert_awaited_once_with("s")
