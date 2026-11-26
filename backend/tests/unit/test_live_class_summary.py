"""Unit tests for the placeholder-framework live summary (1.1.31 M1).

Mocks ``_call_model`` so the gate / cache / debounce / failure-degradation
logic is tested without an LLM call.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from analytics import live_class_summary as mod
from analytics.group_window import GroupWindow, SheetChange, SimChange
from analytics.live_class_summary import build_prompt, resolve_live_summary, summary_enabled
from analytics.live_framework import DEFAULT_FRAMEWORK

T0 = datetime(2026, 6, 28, 12, 0, 0, tzinfo=UTC)


def _sig(code: str = "g1", *, turns: int = 5, status: str = "active", stuck: bool = False, title: str = "Energi"):
    return SimpleNamespace(group_code=code, turns=turns, status=status, stuck=stuck, activity_title=title)


WINDOW_READS: list[str] = []


@pytest.fixture(autouse=True)
def _clear_cache(monkeypatch):
    mod._cache.clear()
    WINDOW_READS.clear()

    # 1.1.163 M4 — the summary reads each group's last minutes from BigQuery
    # when it regenerates. Never from a unit test: an empty window by default.
    def _window(code, minutes):
        WINDOW_READS.append(code)
        now = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
        return GroupWindow(group_code=code, since=now - timedelta(minutes=minutes), until=now)

    monkeypatch.setattr("analytics.group_window.read_group_window", _window)
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

    monkeypatch.setattr(mod, "_call_model", fake)
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

    monkeypatch.setattr(mod, "_call_model", fake)
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

    monkeypatch.setattr(mod, "_call_model", fake)
    await resolve_live_summary("c1", [_sig(turns=1)], now=T0)
    s2 = await resolve_live_summary("c1", [_sig(turns=9)], now=T0 + timedelta(minutes=6))
    assert n["c"] == 2
    assert s2.text == "summary 2"


@pytest.mark.asyncio
async def test_failure_degrades_to_none(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")

    async def boom(prompt):
        raise RuntimeError("flash down")

    monkeypatch.setattr(mod, "_call_model", boom)
    assert await resolve_live_summary("c1", [_sig()], now=T0) is None


# ── 1.1.163 M4 — the summary reads the work, in the teacher's language ──────
# On dev (2026-11-26) the counts-only summary called an ACTIVE group "stuck
# working on an 'unknown activity'", in English on a Danish page.


def _live(code="lucky-swan-54", *, status="active", stuck=False, kind="sim", page_open=True, title="", idle=30):
    return SimpleNamespace(
        group_code=code,
        turns=1,
        status=status,
        stuck=stuck,
        activity_title=title,
        last_work_kind=kind,
        page_open=page_open,
        idle_seconds=idle,
    )


def test_prompt_carries_where_and_the_counted_window():
    now = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
    win = GroupWindow(
        group_code="g1",
        since=now,
        until=now,
        questions=2,
        feedback_requests=1,
        sheets=[SheetChange(title="Undervejs", words_before=40, words_now=85)],
        sims=[SimChange(server="li-ion-batteri", name="Lithium-ion-batteri", changes=4)],
    )
    p = build_prompt([_live("g1")], DEFAULT_FRAMEWORK, {"g1": win}, "da")
    assert "g1: active now, in the simulation" in p
    assert "wrote +45 words in 'Undervejs'" in p
    assert "4 change(s) in the simulation 'Lithium-ion-batteri'" in p
    assert "2 question(s)" in p and "1 request(s) for feedback" in p
    assert "Write in Danish" in p


def test_no_unknown_activity_and_stuck_only_when_flagged():
    p = build_prompt([_live("g1", title=""), _live("g2", status="idle", idle=600)], DEFAULT_FRAMEWORK, {}, "en")
    assert "unknown activity'" not in p.split("Live group signals:")[1]
    assert "STUCK (" not in p
    assert "g2: no activity for 10 min, page open" in p
    assert "Write in English" in p
    stuck = build_prompt([_live("g3", status="idle", stuck=True, idle=600)], DEFAULT_FRAMEWORK, {}, "da")
    assert "g3: no activity for 10 min, page open, STUCK" in stuck


def test_an_unreadable_window_says_not_available_never_nothing():
    p = build_prompt([_live("g1")], DEFAULT_FRAMEWORK, {"g1": None}, "da")
    assert "Last 10 min: not available" in p


@pytest.mark.asyncio
async def test_windows_are_read_only_when_regenerating_and_cached_per_language(monkeypatch):
    monkeypatch.setenv("AIPLA_LIVE_SUMMARY", "1")
    prompts = []

    async def fake(prompt):
        prompts.append(prompt)
        return "Opsummering."

    monkeypatch.setattr(mod, "_call_model", fake)
    await resolve_live_summary("c1", [_live("g1")], now=T0, lang="da")
    await resolve_live_summary("c1", [_live("g1")], now=T0 + timedelta(seconds=10), lang="da")  # the poll: cached
    assert WINDOW_READS == ["g1"] and len(prompts) == 1
    await resolve_live_summary("c1", [_live("g1")], now=T0 + timedelta(seconds=20), lang="en")  # other language
    assert len(prompts) == 2 and "Write in English" in prompts[1]
    await resolve_live_summary("c1", [_live("g1")], now=T0, lang="xx")  # unknown → Danish, cached
    assert len(prompts) == 2
