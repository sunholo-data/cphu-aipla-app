"""Unit tests for the placeholder-framework live summary (1.1.31 M1).

Mocks ``_call_gemini`` so the gate / cache / debounce / failure-degradation
logic is tested without an LLM call.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from analytics import live_class_summary as mod
from analytics.live_class_summary import resolve_live_summary, summary_enabled

T0 = datetime(2026, 6, 28, 12, 0, 0, tzinfo=UTC)


def _sig(code: str = "g1", *, turns: int = 5, status: str = "active", stuck: bool = False, title: str = "Energi"):
    return SimpleNamespace(group_code=code, turns=turns, status=status, stuck=stuck, activity_title=title)


@pytest.fixture(autouse=True)
def _clear_cache():
    mod._cache.clear()
    yield
    mod._cache.clear()


@pytest.mark.asyncio
async def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("AIPLA_LIVE_SUMMARY", raising=False)
    assert summary_enabled() is False
    assert await resolve_live_summary("c1", [_sig()]) is None


@pytest.mark.asyncio
async def test_empty_signals_returns_none(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")
    assert await resolve_live_summary("c1", []) is None


@pytest.mark.asyncio
async def test_generates_when_enabled(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")
    seen = []

    async def fake(prompt):
        seen.append(prompt)
        return "Most groups working; g1 looks stuck."

    monkeypatch.setattr(mod, "_call_gemini", fake)
    s = await resolve_live_summary("c1", [_sig(stuck=True)], now=T0)
    assert s is not None
    assert "working" in s.text
    assert s.framework == "AIPLA live-summary v0"
    assert len(seen) == 1
    assert "ICAP" in seen[0]  # the placeholder framework's preamble is in the prompt


@pytest.mark.asyncio
async def test_caches_within_debounce(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")
    n = {"c": 0}

    async def fake(prompt):
        n["c"] += 1
        return f"summary {n['c']}"

    monkeypatch.setattr(mod, "_call_gemini", fake)
    s1 = await resolve_live_summary("c1", [_sig()], now=T0)
    # 2 min later, even with changed signals → still within the 5-min window → cache.
    s2 = await resolve_live_summary("c1", [_sig(turns=9)], now=T0 + timedelta(minutes=2))
    assert n["c"] == 1
    assert s2.text == s1.text


@pytest.mark.asyncio
async def test_regenerates_after_debounce_when_changed(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")
    n = {"c": 0}

    async def fake(prompt):
        n["c"] += 1
        return f"summary {n['c']}"

    monkeypatch.setattr(mod, "_call_gemini", fake)
    await resolve_live_summary("c1", [_sig(turns=1)], now=T0)
    s2 = await resolve_live_summary("c1", [_sig(turns=9)], now=T0 + timedelta(minutes=6))
    assert n["c"] == 2
    assert s2.text == "summary 2"


@pytest.mark.asyncio
async def test_failure_degrades_to_none(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")

    async def boom(prompt):
        raise RuntimeError("flash down")

    monkeypatch.setattr(mod, "_call_gemini", boom)
    assert await resolve_live_summary("c1", [_sig()], now=T0) is None
