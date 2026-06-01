"""Unit tests for db.group_sessions — group→session-id Firestore mapping.

Covers: set, get, expiry filter, archive filter, archive + new session,
simultaneous-write idempotency (last-writer-wins), and session_id round-trip.
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


def test_set_overwrites_existing_active_session():
    from db.group_sessions import get_active_session_for_group, set_active_session_for_group

    set_active_session_for_group("group-abc", "sess-001")
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
