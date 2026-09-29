"""1.1.131 — a slow BigQuery-backed route must not freeze the event loop.

On 2026-09-22 a researcher opened ``/api/insights/compare?scope=all``. The
route was ``async def`` and ran synchronous BigQuery inline; with one uvicorn
worker, that blocked the loop for 59 s and a student's tutor reply sat
undelivered for the whole minute.

These tests drive the REAL route through ASGI with the query layer replaced by
a ``time.sleep`` — the same blocking shape as ``client.query().result()`` — and
assert that a concurrent request on the same app is answered while the slow
one is still running. Against the old inline ``compute()`` they fail: the fast
request waits for the slow one.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
import pytest
from fastapi import FastAPI, Request

from auth import User, build_access_context, get_current_user
from db import bigquery
from db import firestore as fs_module
from insights.cache import CACHE
from protocols.insights_routes import router as insights_router
from protocols.research_logs_routes import router as research_logs_router

SLOW_S = 0.8
# Generous: the point is "not after the slow one", which is ≥ SLOW_S.
FAST_BUDGET_S = 0.4


@pytest.fixture(autouse=True)
def _local_state(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    CACHE.clear()
    yield
    fs_module._reset_client_for_testing()
    CACHE.clear()


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(insights_router)
    app.include_router(research_logs_router)

    async def _override(request: Request) -> User:
        u = User(uid="researcher-r", email="r@example.test", is_teacher=True, is_researcher=True)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override

    @app.get("/ping")
    async def ping() -> dict:
        return {"ok": True}

    return app


async def _slow_and_fast(app: FastAPI, slow_path: str) -> tuple[float, float]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        t0 = time.monotonic()

        async def slow() -> float:
            r = await client.get(slow_path)
            assert r.status_code == 200, r.text
            return time.monotonic() - t0

        async def fast() -> float:
            await asyncio.sleep(0.1)  # let the slow request reach its query
            r = await client.get("/ping")
            assert r.status_code == 200
            return time.monotonic() - t0

        slow_s, fast_s = await asyncio.gather(slow(), fast())
    return slow_s, fast_s


async def test_insights_compare_does_not_block_the_loop(monkeypatch):
    def _blocking_compare(**_kw):
        time.sleep(SLOW_S)
        return {"rows": [], "_debug": {"queries": []}}

    monkeypatch.setattr("insights.aggregates.teacher_compare", _blocking_compare)
    slow_s, fast_s = await _slow_and_fast(_app(), "/api/insights/compare?since=7d&scope=all")
    assert slow_s >= SLOW_S
    assert fast_s < FAST_BUDGET_S, f"/ping waited {fast_s:.2f}s behind a {SLOW_S}s insights query"


async def test_research_logs_do_not_block_the_loop(monkeypatch):
    def _blocking_tabs():
        time.sleep(SLOW_S)
        return []

    monkeypatch.setattr("analytics.research_logs.framework_tabs", _blocking_tabs)
    monkeypatch.setattr("analytics.research_logs.excluded_counts", lambda: {})
    slow_s, fast_s = await _slow_and_fast(_app(), "/api/research/logs/tabs")
    assert slow_s >= SLOW_S
    assert fast_s < FAST_BUDGET_S, f"/ping waited {fast_s:.2f}s behind a {SLOW_S}s research-logs query"


async def test_run_query_on_the_loop_is_logged(caplog):
    with caplog.at_level(logging.ERROR, logger="db.bigquery"):
        bigquery._warn_if_on_event_loop()
    assert "run_query on the event loop" in caplog.text


def test_run_query_off_the_loop_is_silent(caplog):
    with caplog.at_level(logging.ERROR, logger="db.bigquery"):
        bigquery._warn_if_on_event_loop()
    assert caplog.text == ""


# ---------------------------------------------------------------------------
# 1.1.131 M3 — the teacher's group report. ``GET /api/reports/groups/{code}``
# is polled every few seconds by the live view; it resolved the group's latest
# session with a synchronous BigQuery query, then read the transcript with two
# more, all on the loop. The runtime guard logged 114 hits on 24 Sep.
#
# Here the REAL ``run_query`` is replaced by one that runs the real guard and
# then blocks, so the test witnesses both halves: ``/ping`` is not held up,
# AND the detector stays silent (every query on the path ran off the loop).
# ---------------------------------------------------------------------------


def _report_app() -> FastAPI:
    from protocols.reports_routes import router as reports_router

    app = FastAPI()
    app.include_router(reports_router)

    async def _override(request: Request) -> User:
        u = User(uid="teacher-t", email="t@example.test", is_teacher=True)
        request.state.access = build_access_context(u)
        return u

    app.dependency_overrides[get_current_user] = _override

    @app.get("/ping")
    async def ping() -> dict:
        return {"ok": True}

    return app


def _turn_row(role: str, content: str) -> dict:
    from datetime import UTC, datetime

    return {
        "ts": datetime(2026, 9, 24, 10, 0, tzinfo=UTC),
        "group_id": "bold-kazoo-64",
        "skill_id": "act-1",
        "role": role,
        "content": content,
        "turn_index": 0,
        "framework_id": None,
        "tutor_id": None,
    }


def _blocking_run_query_for_reports(per_query_s: float):
    def _run_query(sql: str, params=None):
        bigquery._warn_if_on_event_loop()  # the real detector, on whatever thread we are on
        time.sleep(per_query_s)
        if "GROUP BY session_id" in sql:
            return [{"session_id": "sess-1", "last_ts": None}]
        if "jsonPayload.role" in sql:
            return [_turn_row("student", "hej")]
        return []  # workbench events

    return _run_query


async def test_group_report_does_not_block_the_loop(monkeypatch, caplog):
    from unittest.mock import AsyncMock

    # The route makes three queries (latest session, turns, workbench events).
    monkeypatch.setattr(bigquery, "run_query", _blocking_run_query_for_reports(SLOW_S / 2))
    monkeypatch.setattr("protocols.reports_routes.resolve_narrative", AsyncMock(return_value=None))
    monkeypatch.setattr("protocols.reports_routes._fidelity_for", AsyncMock(return_value=None))

    with caplog.at_level(logging.ERROR, logger="db.bigquery"):
        slow_s, fast_s = await _slow_and_fast(_report_app(), "/api/reports/groups/bold-kazoo-64")

    assert slow_s >= SLOW_S
    assert fast_s < FAST_BUDGET_S, f"/ping waited {fast_s:.2f}s behind the group report's queries"
    assert "run_query on the event loop" not in caplog.text, caplog.text


async def test_session_report_bq_does_not_block_the_loop(monkeypatch, caplog):
    """``?source=bq`` (``aiplatform logs verify``) reads the same two transcript queries."""
    monkeypatch.setattr(bigquery, "run_query", _blocking_run_query_for_reports(SLOW_S / 2))

    with caplog.at_level(logging.ERROR, logger="db.bigquery"):
        slow_s, fast_s = await _slow_and_fast(_report_app(), "/api/reports/sessions/sess-1?source=bq")

    assert slow_s >= SLOW_S
    assert fast_s < FAST_BUDGET_S, f"/ping waited {fast_s:.2f}s behind the session report's queries"
    assert "run_query on the event loop" not in caplog.text, caplog.text
