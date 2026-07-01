"""Unit tests for db.group_sessions — group→session-id Firestore mapping.

Covers: set, get, expiry filter, archive filter, archive + new session,
first-wins (no clobber), idempotency, and session_id round-trip.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest


@pytest.fixture(autouse=True)
def reset_firestore(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    from db import firestore

    firestore._reset_client_for_testing()
    yield
    firestore._reset_client_for_testing()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(UTC)


def _past(days: int) -> str:
    return (_now() - timedelta(days=days)).isoformat()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_get_returns_none_when_empty():
    from db.group_sessions import get_active_session_for_group

    assert get_active_session_for_group("group-abc") is None


def test_set_then_get_returns_session_id():
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
    assert get_active_session_for_group("group-abc") == "sess-001"


def test_set_does_not_clobber_active_session():
    """First-wins (2026-06-13): the group runs ONE shared conversation, so a
    second fresh session must NOT overwrite the established active one — that
    clobber orphaned the conversation with all the history. The first session
    stays the group's session until archived/expired."""
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
    set_active_session_for_group("group-abc", "sess-002")  # ignored — active exists
    assert get_active_session_for_group("group-abc") == "sess-001"


def test_set_same_session_is_idempotent():
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
    set_active_session_for_group("group-abc", "sess-001")  # same id — fine
    assert get_active_session_for_group("group-abc") == "sess-001"


def test_set_after_archive_establishes_new_session():
    """A teacher [Reset session] archives the mapping; the next session then
    becomes the new shared one (first-wins resets after archive)."""
    from db.group_sessions import (
        archive_session_for_group,
        get_active_session_for_group,
        set_active_session_for_group,
    )

    set_active_session_for_group("group-abc", "sess-001")
    archive_session_for_group("group-abc")
    assert get_active_session_for_group("group-abc") is None
    set_active_session_for_group("group-abc", "sess-002")
    assert get_active_session_for_group("group-abc") == "sess-002"


def test_get_returns_none_when_expired(monkeypatch):
    """An entry whose expires_at is in the past is ignored."""
    from db import firestore as fs
    from db.group_sessions import get_active_session_for_group

    # Manually plant an expired record
    expired_at = (_now() - timedelta(days=1)).isoformat()
    created_at = (_now() - timedelta(days=31)).isoformat()
    fs.set_document(
        "group_sessions",
        "group-expired",
        {
            "session_id": "sess-old",
            "created_at": created_at,
            "expires_at": expired_at,
            "archived_at": None,
        },
    )
    assert get_active_session_for_group("group-expired") is None


def test_get_returns_none_when_archived():
    from db.group_sessions import archive_session_for_group, get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
    archive_session_for_group("group-abc")
    assert get_active_session_for_group("group-abc") is None


def test_set_after_archive_creates_fresh_session():
    from db.group_sessions import archive_session_for_group, get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
    archive_session_for_group("group-abc")
    set_active_session_for_group("group-abc", "sess-002")
    assert get_active_session_for_group("group-abc") == "sess-002"


def test_get_active_returns_value_within_ttl():
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-live", ttl_days=30)
    result = get_active_session_for_group("group-abc")
    assert result == "sess-live"


def test_different_groups_are_isolated():
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-a", "sess-a")
    set_active_session_for_group("group-b", "sess-b")
    assert get_active_session_for_group("group-a") == "sess-a"
    assert get_active_session_for_group("group-b") == "sess-b"


def test_archive_is_idempotent():
    """Archiving twice should not raise."""
    from db.group_sessions import archive_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
    archive_session_for_group("group-abc")
    archive_session_for_group("group-abc")  # second call should not raise


def test_archive_nonexistent_group_is_noop():
    """Archiving a group with no session record is a no-op."""
    from db.group_sessions import archive_session_for_group

    archive_session_for_group("group-never-existed")  # should not raise


# ---------------------------------------------------------------------------
# ALS-1: per-activity scoping
# ---------------------------------------------------------------------------


def test_sessions_are_scoped_per_activity():
    """A group's different activities each keep their own session (the bug:
    they used to share one)."""
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("grp", "sess-A", activity_id="act-1")
    set_active_session_for_group("grp", "sess-B", activity_id="act-2")

    assert get_active_session_for_group("grp", "act-1") == "sess-A"
    assert get_active_session_for_group("grp", "act-2") == "sess-B"
    # The group-level (no-activity) lookup is independent of either.
    assert get_active_session_for_group("grp") is None


def test_first_wins_is_per_activity():
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("grp", "sess-A1", activity_id="act-1")
    set_active_session_for_group("grp", "sess-A2", activity_id="act-1")  # later — must NOT clobber
    assert get_active_session_for_group("grp", "act-1") == "sess-A1"


def test_archive_all_resets_every_activity_session():
    """Teacher reset (no activity_id) archives EVERY activity's session for the group."""
    from db.group_sessions import archive_session_for_group, get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("grp", "sess-A", activity_id="act-1")
    set_active_session_for_group("grp", "sess-B", activity_id="act-2")

    archive_session_for_group("grp")  # reset the whole group

    assert get_active_session_for_group("grp", "act-1") is None
    assert get_active_session_for_group("grp", "act-2") is None


def test_archive_one_activity_leaves_others():
    from db.group_sessions import archive_session_for_group, get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("grp", "sess-A", activity_id="act-1")
    set_active_session_for_group("grp", "sess-B", activity_id="act-2")

    archive_session_for_group("grp", activity_id="act-1")

    assert get_active_session_for_group("grp", "act-1") is None
    assert get_active_session_for_group("grp", "act-2") == "sess-B"


# ---------------------------------------------------------------------------
# 1.1.53 M0 — per-group turn-lock (best-effort mutex over the shared session)
# ---------------------------------------------------------------------------


def test_acquire_turn_lock_succeeds_when_free():
    from db.group_sessions import acquire_turn_lock

    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True


def test_acquire_turn_lock_refused_when_held_by_another():
    """The core race guard: while one token holds the turn, a second token is
    refused. Two students sending at once → one runs, one 409s."""
    from db.group_sessions import acquire_turn_lock

    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True
    assert acquire_turn_lock("grp", "tok-2", activity_id="act-1") is False


def test_acquire_turn_lock_reacquire_same_token_is_ok():
    """Idempotent re-acquire by the holder (a retry within one request)."""
    from db.group_sessions import acquire_turn_lock

    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True
    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True


def test_release_turn_lock_frees_it():
    from db.group_sessions import acquire_turn_lock, release_turn_lock

    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True
    release_turn_lock("grp", "tok-1", activity_id="act-1")
    # Now a different token can acquire.
    assert acquire_turn_lock("grp", "tok-2", activity_id="act-1") is True


def test_release_only_by_holding_token():
    """A foreign token must not be able to release a live turn (a stale release
    from a different client can't unlock someone else's turn)."""
    from db.group_sessions import acquire_turn_lock, release_turn_lock

    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True
    release_turn_lock("grp", "tok-2", activity_id="act-1")  # wrong token — no-op
    assert acquire_turn_lock("grp", "tok-3", activity_id="act-1") is False


def test_stale_lock_is_stealable():
    """A lock older than the TTL is reclaimable — a device that closed its tab
    mid-turn must not wedge the group forever."""
    from db import firestore as fs
    from db.group_sessions import acquire_turn_lock

    stale = (_now() - timedelta(seconds=999)).isoformat()
    fs.set_document(
        "group_sessions",
        "grp:act-1",
        {"turn_in_flight_at": stale, "turn_lock_token": "tok-dead"},
    )
    assert acquire_turn_lock("grp", "tok-new", activity_id="act-1") is True


def test_get_turn_lock_reports_in_flight():
    from db.group_sessions import acquire_turn_lock, get_turn_lock

    acquire_turn_lock("grp", "tok-1", activity_id="act-1")
    lock = get_turn_lock("grp", activity_id="act-1")
    assert lock["in_flight"] is True
    assert lock["started_at"]


def test_get_turn_lock_reports_free_when_absent():
    from db.group_sessions import get_turn_lock

    lock = get_turn_lock("grp", activity_id="act-1")
    assert lock["in_flight"] is False
    assert lock["started_at"] is None


def test_get_turn_lock_reports_free_when_stale():
    from db import firestore as fs
    from db.group_sessions import get_turn_lock

    stale = (_now() - timedelta(seconds=999)).isoformat()
    fs.set_document(
        "group_sessions",
        "grp:act-1",
        {"turn_in_flight_at": stale, "turn_lock_token": "tok-dead"},
    )
    assert get_turn_lock("grp", activity_id="act-1")["in_flight"] is False


def test_turn_lock_is_per_activity():
    """A turn in activity 1 does not lock activity 2 for the same group."""
    from db.group_sessions import acquire_turn_lock

    assert acquire_turn_lock("grp", "tok-1", activity_id="act-1") is True
    assert acquire_turn_lock("grp", "tok-2", activity_id="act-2") is True


def test_lock_does_not_corrupt_session_pointer_read():
    """Acquiring a lock creates/updates the group_sessions doc, but must not make
    the session-pointer read return a bogus session (lock-only doc → no session)."""
    from db.group_sessions import acquire_turn_lock, get_active_session_for_group

    acquire_turn_lock("grp", "tok-1", activity_id="act-1")
    assert get_active_session_for_group("grp", "act-1") is None


def test_lock_coexists_with_active_session_pointer():
    """Locking an activity that already has a session keeps the session intact."""
    from db.group_sessions import acquire_turn_lock, get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("grp", "sess-A", activity_id="act-1")
    acquire_turn_lock("grp", "tok-1", activity_id="act-1")
    assert get_active_session_for_group("grp", "act-1") == "sess-A"


# ---------------------------------------------------------------------------
# 1.1.53 M1 — turn revision + live pulse
# ---------------------------------------------------------------------------


def test_bump_turn_revision_is_monotone():
    from db.group_sessions import bump_turn_revision

    assert bump_turn_revision("grp", activity_id="act-1") == 1
    assert bump_turn_revision("grp", activity_id="act-1") == 2
    assert bump_turn_revision("grp", activity_id="act-1") == 3


def test_bump_turn_revision_is_per_activity():
    from db.group_sessions import bump_turn_revision

    assert bump_turn_revision("grp", activity_id="act-1") == 1
    assert bump_turn_revision("grp", activity_id="act-2") == 1  # independent counter


def test_read_group_pulse_defaults_when_absent():
    from db.group_sessions import read_group_pulse

    pulse = read_group_pulse("grp", activity_id="act-1")
    assert pulse == {"revision": 0, "in_flight": False, "started_at": None}


def test_read_group_pulse_reflects_revision_and_in_flight():
    from db.group_sessions import acquire_turn_lock, bump_turn_revision, read_group_pulse

    bump_turn_revision("grp", activity_id="act-1")
    bump_turn_revision("grp", activity_id="act-1")
    acquire_turn_lock("grp", "tok-1", activity_id="act-1")

    pulse = read_group_pulse("grp", activity_id="act-1")
    assert pulse["revision"] == 2
    assert pulse["in_flight"] is True
    assert pulse["started_at"]


def test_read_group_pulse_ignores_stale_lock():
    from db import firestore as fs
    from db.group_sessions import read_group_pulse

    stale = (_now() - timedelta(seconds=999)).isoformat()
    fs.set_document(
        "group_sessions",
        "grp:act-1",
        {"turn_in_flight_at": stale, "turn_lock_token": "dead", "turn_revision": 5},
    )
    pulse = read_group_pulse("grp", activity_id="act-1")
    assert pulse["revision"] == 5
    assert pulse["in_flight"] is False


def test_bump_survives_a_lock_only_doc():
    """A turn that acquired a lock (lock-only doc, no session pointer) can still
    bump its revision at completion."""
    from db.group_sessions import acquire_turn_lock, bump_turn_revision, read_group_pulse

    acquire_turn_lock("grp", "tok-1", activity_id="act-1")
    bump_turn_revision("grp", activity_id="act-1")
    assert read_group_pulse("grp", activity_id="act-1")["revision"] == 1


# ---------------------------------------------------------------------------
# 1.1.53 M2 — workbench "share with the tutor" bumps the session's revision
# ---------------------------------------------------------------------------


def test_bump_for_session_finds_the_activity_doc_by_session_id():
    from db.group_sessions import (
        bump_turn_revision_for_session,
        read_group_pulse,
        set_active_session_for_group,
    )

    set_active_session_for_group("grp", "sess-1", activity_id="act-1")
    assert bump_turn_revision_for_session("grp", "sess-1") == 1
    # The pulse the watcher reads (same group+activity) now sees the bump.
    assert read_group_pulse("grp", activity_id="act-1")["revision"] == 1


def test_bump_for_session_targets_the_right_activity():
    """Two activities, one group: a push in act-1's session must not bump act-2."""
    from db.group_sessions import (
        bump_turn_revision_for_session,
        read_group_pulse,
        set_active_session_for_group,
    )

    set_active_session_for_group("grp", "sess-A", activity_id="act-1")
    set_active_session_for_group("grp", "sess-B", activity_id="act-2")

    bump_turn_revision_for_session("grp", "sess-A")

    assert read_group_pulse("grp", activity_id="act-1")["revision"] == 1
    assert read_group_pulse("grp", activity_id="act-2")["revision"] == 0


def test_bump_for_session_returns_none_when_no_match():
    from db.group_sessions import bump_turn_revision_for_session

    assert bump_turn_revision_for_session("grp", "unknown-session") is None


def test_bump_for_session_handles_legacy_group_level_doc():
    from db.group_sessions import (
        bump_turn_revision_for_session,
        read_group_pulse,
        set_active_session_for_group,
    )

    # A pre-ALS-1 group-level session (no activity_id → doc id == group_id).
    set_active_session_for_group("grp", "sess-legacy")
    assert bump_turn_revision_for_session("grp", "sess-legacy") == 1
    assert read_group_pulse("grp")["revision"] == 1


# ---------------------------------------------------------------------------
# 1.1.53 M3 — presence ("N here")
# ---------------------------------------------------------------------------


def test_touch_presence_counts_distinct_devices():
    from db.group_sessions import touch_presence

    assert touch_presence("grp", "dev-A", activity_id="act-1") == 1
    assert touch_presence("grp", "dev-B", activity_id="act-1") == 2
    # Re-heartbeat of an existing device doesn't double-count.
    assert touch_presence("grp", "dev-A", activity_id="act-1") == 2


def test_touch_presence_prunes_stale_devices():
    """A device that stopped polling drops out of the count after the window."""
    from db import firestore as fs
    from db.group_sessions import touch_presence

    stale = (_now() - timedelta(seconds=999)).isoformat()
    fs.set_document("group_sessions", "grp:act-1", {"presence": {"dev-gone": stale}})
    # A fresh device heartbeats; the stale one is not counted.
    assert touch_presence("grp", "dev-A", activity_id="act-1") == 1


def test_touch_presence_is_per_activity():
    from db.group_sessions import touch_presence

    assert touch_presence("grp", "dev-A", activity_id="act-1") == 1
    assert touch_presence("grp", "dev-A", activity_id="act-2") == 1  # independent surface


def test_touch_presence_empty_token_is_noop():
    from db.group_sessions import touch_presence

    assert touch_presence("grp", "", activity_id="act-1") == 0


def test_presence_does_not_disturb_revision_or_lock():
    """Heartbeating presence must not touch the turn revision or the lock."""
    from db.group_sessions import acquire_turn_lock, read_group_pulse, touch_presence

    acquire_turn_lock("grp", "tok-1", activity_id="act-1")
    touch_presence("grp", "dev-A", activity_id="act-1")
    pulse = read_group_pulse("grp", activity_id="act-1")
    assert pulse["in_flight"] is True
    assert pulse["revision"] == 0
