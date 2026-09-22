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
