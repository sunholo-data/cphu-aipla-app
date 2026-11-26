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


def _patch_sessions(monkeypatch, sessions, works=None):
    monkeypatch.setattr(
        "db.chat_sessions.list_sessions_for_group_codes",
        lambda codes, page_size=200: sessions,
    )
    # 1.1.161 work stamps. Default: every group's page is open and nothing but
    # chat has been stamped, which is the chat-only behaviour these tests pin.
    stamps = works if works is not None else {"*": {"last_seen_at": NOW - timedelta(seconds=5)}}

    def _read(codes):
        if "*" in stamps:
            return {c: dict(stamps["*"]) for c in codes}
        return {c: stamps[c] for c in codes if c in stamps}

    monkeypatch.setattr("db.group_work.read_work", _read)


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


# ── 1.1.161 — work counts, not only chat ────────────────────────────────────


def _work(minutes_ago: float | None, kind: str = "table", *, seen_s: float | None = 5):
    return {
        "last_work_at": None if minutes_ago is None else NOW - timedelta(minutes=minutes_ago),
        "last_work_kind": kind,
        "last_seen_at": None if seen_s is None else NOW - timedelta(seconds=seen_s),
    }


def test_a_group_working_only_in_the_table_is_active_not_stuck(monkeypatch):
    """The test that failed before 1.1.161: 8 min since the last chat turn,
    but the group edited the table a minute ago."""
    _patch_sessions(monkeypatch, [_sess("g", 8, turns=5)], works={"g": _work(1, "table")})
    [g] = compute_group_signals(["g"], now=NOW)
    assert (g.status, g.stuck, g.last_work_kind, g.page_open) == ("active", False, "table", True)
    assert g.idle_seconds == 60


def test_chat_newer_than_work_says_chat(monkeypatch):
    _patch_sessions(monkeypatch, [_sess("g", 1)], works={"g": _work(4, "sim")})
    [g] = compute_group_signals(["g"], now=NOW)
    assert g.last_work_kind == "chat" and g.status == "active"


def test_page_open_and_nothing_for_ten_minutes_is_stuck(monkeypatch):
    _patch_sessions(monkeypatch, [_sess("g", 12, turns=5)], works={"g": _work(10, "sim")})
    [g] = compute_group_signals(["g"], now=NOW)
    assert (g.status, g.stuck, g.page_open) == ("idle", True, True)


def test_a_closed_page_is_quiet_never_stuck(monkeypatch):
    _patch_sessions(monkeypatch, [_sess("g", 12, turns=5)], works={"g": _work(10, "sim", seen_s=600)})
    [g] = compute_group_signals(["g"], now=NOW)
    assert (g.status, g.stuck, g.page_open) == ("idle", False, False)


def test_work_alone_counts_as_having_worked(monkeypatch):
    """A group that never chatted but ran the sim, then went silent with the page open."""
    _patch_sessions(monkeypatch, [_sess("g", 40, turns=0)], works={"g": _work(8, "sim")})
    [g] = compute_group_signals(["g"], now=NOW)
    assert g.stuck is True


def test_recent_work_keeps_a_group_in_the_live_view(monkeypatch):
    """The 90-min live window measures the latest activity of any kind."""
    _patch_sessions(monkeypatch, [_sess("g", 200, turns=5)], works={"g": _work(3, "writing")})
    [g] = compute_group_signals(["g"], now=NOW)
    assert g.status == "active" and g.last_work_kind == "writing"


def test_unreadable_stamps_fall_back_to_the_chat_only_rule(monkeypatch):
    """Never pretend to know: page_open is None, and stuck uses the old rule."""
    _patch_sessions(monkeypatch, [_sess("g", 10, turns=5)])

    def _boom(codes):
        raise RuntimeError("firestore down")

    monkeypatch.setattr("db.group_work.read_work", _boom)
    [g] = compute_group_signals(["g"], now=NOW)
    assert (g.stuck, g.page_open, g.last_work_kind) == (True, None, "chat")
