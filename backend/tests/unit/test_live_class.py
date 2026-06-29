"""Unit tests for deterministic live-class signals (1.1.31 M0).

Stubs ``list_sessions_for_group_codes`` so the active/idle, "stuck", and
newest-session-per-group logic is tested without seeding Firestore.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

from analytics.live_class import compute_group_signals

NOW = datetime(2026, 6, 28, 12, 0, 0, tzinfo=UTC)


def _sess(code: str, minutes_ago: float, *, turns: int = 5, title: str = "Energi", skill: str = "boldkast"):
    return SimpleNamespace(
        group_code=code,
        last_message_at=NOW - timedelta(minutes=minutes_ago),
        turn_count=turns,
        title=title,
        skill_id=skill,
    )


def _patch_sessions(monkeypatch, sessions):
    monkeypatch.setattr(
        "db.chat_sessions.list_sessions_for_group_codes",
        lambda codes, page_size=200: sessions,
    )


def test_empty_group_codes_returns_empty():
    assert compute_group_signals([]) == []


def test_active_vs_idle(monkeypatch):
    _patch_sessions(monkeypatch, [_sess("g-active", 1), _sess("g-idle", 20)])
    out = {g.group_code: g for g in compute_group_signals(["g-active", "g-idle"], now=NOW)}
    assert out["g-active"].status == "active"
    assert out["g-idle"].status == "idle"


def test_stuck_flag_needs_idle_band_and_prior_work(monkeypatch):
    _patch_sessions(
        monkeypatch,
        [
            _sess("g-stuck", 10, turns=5),  # 10 min quiet, was working → stuck
            _sess("g-noturns", 10, turns=0),  # quiet but never worked → not stuck
            _sess("g-active", 1, turns=5),  # working now → not stuck
        ],
    )
    out = {g.group_code: g for g in compute_group_signals(["g-stuck", "g-noturns", "g-active"], now=NOW)}
    assert out["g-stuck"].stuck is True
    assert out["g-noturns"].stuck is False
    assert out["g-active"].stuck is False


def test_one_row_per_group_uses_newest_session(monkeypatch):
    _patch_sessions(monkeypatch, [_sess("g", 30, title="Old"), _sess("g", 2, title="Current")])
    out = compute_group_signals(["g"], now=NOW)
    assert len(out) == 1
    assert out[0].activity_title == "Current"
    assert out[0].status == "active"


def test_sessions_without_group_code_skipped(monkeypatch):
    s = _sess("g", 1)
    s.group_code = None
    _patch_sessions(monkeypatch, [s])
    assert compute_group_signals(["g"], now=NOW) == []


def test_stale_group_beyond_live_window_excluded(monkeypatch):
    # A session from another day (200 min idle) is historical, not live, and
    # must not surface as a stale "idle"/"stuck" row in the live view.
    _patch_sessions(monkeypatch, [_sess("g-live", 5), _sess("g-old", 200)])
    out = {g.group_code for g in compute_group_signals(["g-live", "g-old"], now=NOW)}
    assert out == {"g-live"}
