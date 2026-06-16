"""1.1.36 A4 — settle job (warm-summaries) scan + auth."""

import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from protocols import internal_routes


def _doc(session_id: str, minutes_ago: int, summary: str = "") -> dict:
    return {
        "sessionId": session_id,
        "lastMessageAt": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat(),
        "summaryText": summary,
    }


def test_warm_requires_configured_token(monkeypatch):
    monkeypatch.delenv("WARM_SUMMARIES_TOKEN", raising=False)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(internal_routes.warm_summaries(x_internal_token=None))
    assert ei.value.status_code == 503


def test_warm_rejects_wrong_token(monkeypatch):
    monkeypatch.setenv("WARM_SUMMARIES_TOKEN", "secret")
    with pytest.raises(HTTPException) as ei:
        asyncio.run(internal_routes.warm_summaries(x_internal_token="nope"))
    assert ei.value.status_code == 403


def test_warm_only_settled_and_unwarmed(monkeypatch):
    monkeypatch.setenv("WARM_SUMMARIES_TOKEN", "secret")
    docs = [
        _doc("recent", 5),  # too recent (< 20 min) -> skip
        _doc("warmed", 60, summary="already"),  # has a summary -> skip
        _doc("settled", 60),  # settled + unwarmed -> warm
    ]
    warmed_ids: list = []

    async def _fake_resolve_summary(sid):
        return {"id": sid}  # truthy stand-in for a SessionSummary

    async def _fake_resolve_narrative(summary):
        warmed_ids.append(summary["id"])
        return "narrative"

    monkeypatch.setattr(internal_routes, "query_documents", lambda *a, **k: docs)
    monkeypatch.setattr(internal_routes, "resolve_session_summary", _fake_resolve_summary)
    monkeypatch.setattr(internal_routes, "resolve_narrative", _fake_resolve_narrative)

    out = asyncio.run(internal_routes.warm_summaries(x_internal_token="secret"))
    assert out["warmed"] == 1 and out["scanned"] == 1
    assert warmed_ids == ["settled"]


def test_warm_handles_resolve_failure(monkeypatch):
    monkeypatch.setenv("WARM_SUMMARIES_TOKEN", "secret")
    monkeypatch.setattr(internal_routes, "query_documents", lambda *a, **k: [_doc("settled", 60)])
    monkeypatch.setattr(internal_routes, "resolve_session_summary", AsyncMock(side_effect=RuntimeError("bq down")))
    out = asyncio.run(internal_routes.warm_summaries(x_internal_token="secret"))
    assert out["warmed"] == 0  # failure swallowed, job keeps going
