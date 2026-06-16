"""Unit tests for reports.session_summary."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from db import firestore as fs_module
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex
from reports.session_summary import (
    SessionSummary,
    _count_sim_runs,
    _group_code_from_owner_uid,
    find_latest_session_for_group,
    summarize_session,
)


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _make_event(author: str, text: str | None, timestamp: float = 1.0):
    event = MagicMock()
    event.author = author
    event.timestamp = timestamp
    if text is None:
        event.content = None
    else:
        part = MagicMock()
        part.text = text
        event.content = MagicMock()
        event.content.parts = [part]
    return event


# --- _group_code_from_owner_uid ---


class TestGroupCodeFromOwnerUid:
    def test_anon_uid_with_simple_group(self):
        assert _group_code_from_owner_uid("anon-local-demo-abc123") == "local-demo"

    def test_anon_uid_with_multiword_group(self):
        assert _group_code_from_owner_uid("anon-bold-kazoo-87-def456") == "bold-kazoo-87"

    def test_non_anon_returns_none(self):
        assert _group_code_from_owner_uid("workshop-user") is None
        assert _group_code_from_owner_uid("firebase-uid-x") is None

    def test_malformed_returns_none(self):
        # Just the prefix with no body.
        assert _group_code_from_owner_uid("anon-") is None


# --- _count_sim_runs ---


class TestCountSimRuns:
    def test_empty_state(self):
        assert _count_sim_runs({}) == 0

    def test_no_mcp_keys(self):
        assert _count_sim_runs({"foo.bar": 1, "baz": 2}) == 0

    def test_counts_distinct_mcp_keys(self):
        state = {
            "mcp_app_context.boldkast.launch": {"angle": 45},
            "mcp_app_context.boldkast.reset": {},
            "mcp_app_context.led-planck.measure": {"voltage": 1.8},
            "unrelated.key": 1,
        }
        assert _count_sim_runs(state) == 3


# --- summarize_session ---


@pytest.mark.asyncio
async def test_summarize_session_returns_none_when_no_index():
    out = await summarize_session("does-not-exist")
    assert out is None


@pytest.mark.asyncio
async def test_summarize_session_builds_a_full_report():
    now = datetime(2026, 5, 25, 14, 12, 0, tzinfo=UTC)
    later = datetime(2026, 5, 25, 14, 34, 0, tzinfo=UTC)
    idx = ChatSessionIndex(
        sessionId="sess-1",
        skillId="boldkast",
        ownerUid="anon-boldkazoo87-abc",
        accessControl=AccessControl(type="public"),
        firstMessageAt=now,
        lastMessageAt=later,
        turnCount=4,
    )

    with patch("reports.session_summary.get_session_index", return_value=idx):
        adk_session = MagicMock()
        adk_session.events = [
            _make_event("user", "hvad sker der hvis vinklen er 80?", timestamp=1.0),
            _make_event("agent", "Godt sporgsmal, prov simuleringen.", timestamp=2.0),
            _make_event("user", None),  # tool-call event with no text — skipped
        ]
        adk_session.state = {
            "mcp_app_context.boldkast.launch": {"angle": 45},
            "mcp_app_context.boldkast.reset": {},
            "unrelated": 1,
        }
        service = MagicMock()
        service.get_session = AsyncMock(return_value=adk_session)
        with patch("reports.session_summary.get_session_service", return_value=service):
            summary = await summarize_session("sess-1")

    assert isinstance(summary, SessionSummary)
    assert summary.session_id == "sess-1"
    # Realistic uid is hyphen-stripped (_synthesize_uid), so the session-state
    # path derives the cleaned code. The BigQuery path stores the real code.
    assert summary.group_code == "boldkazoo87"
    assert summary.activity_id == "boldkast"
    assert summary.message_count == 2  # the None-content event was skipped
    assert summary.duration_seconds == 22 * 60  # 22 minutes
    assert summary.sim_run_count == 2  # two distinct mcp_app_context keys
    assert summary.conversation[0].role == "student"
    assert summary.conversation[1].role == "tutor"


# --- find_latest_session_for_group ---


def _persist_index(*, session_id: str, owner_uid: str, last_at: datetime) -> None:
    """Write a session-index row directly into the in-memory store."""
    from db.firestore import set_document

    idx = ChatSessionIndex(
        sessionId=session_id,
        skillId="boldkast",
        ownerUid=owner_uid,
        accessControl=AccessControl(type="public"),
        firstMessageAt=last_at,
        lastMessageAt=last_at,
    )
    set_document("chat_sessions", session_id, idx.model_dump(by_alias=True, mode="json"))


def test_find_latest_session_for_group_returns_none_when_empty():
    assert find_latest_session_for_group("bold-kazoo-87") is None


def test_find_latest_session_for_group_picks_most_recent():
    early = datetime(2026, 5, 25, 12, 0, 0, tzinfo=UTC)
    late = datetime(2026, 5, 25, 14, 0, 0, tzinfo=UTC)
    # Realistic uids are hyphen-stripped (_synthesize_uid), and the lookup
    # cleans the queried code to match.
    _persist_index(
        session_id="early",
        owner_uid="anon-boldkazoo87-aaa",
        last_at=early,
    )
    _persist_index(
        session_id="late",
        owner_uid="anon-boldkazoo87-bbb",
        last_at=late,
    )
    # And one for a different group — should be ignored.
    _persist_index(
        session_id="other",
        owner_uid="anon-othergroup99-ccc",
        last_at=late,
    )

    found = find_latest_session_for_group("bold-kazoo-87")
    assert found is not None
    assert found.session_id == "late"


def test_find_latest_session_for_group_matches_new_deterministic_uid():
    """Regression (2026-06-16): the deterministic uid ``anon-{cleaned}`` (NO
    suffix) must be found. The old ``anon-{cleaned}-`` prefix range excluded it
    — which is why the teacher dashboard showed 'No activity yet' + empty
    reports despite live chat history."""
    when = datetime(2026, 6, 16, 9, 0, 0, tzinfo=UTC)
    _persist_index(session_id="new", owner_uid="anon-boldkazoo87", last_at=when)
    found = find_latest_session_for_group("bold-kazoo-87")
    assert found is not None
    assert found.session_id == "new"


def test_list_sessions_for_group_codes_matches_new_deterministic_uid():
    """Same regression on the teacher recent-sessions path (the 'No activity
    yet' rows on the class page)."""
    from db.chat_sessions import list_sessions_for_group_codes

    when = datetime(2026, 6, 16, 9, 0, 0, tzinfo=UTC)
    _persist_index(session_id="s-new", owner_uid="anon-woolykettle61", last_at=when)
    rows = list_sessions_for_group_codes(["wooly-kettle-61"])
    assert "s-new" in {r.session_id for r in rows}
    # group_code is backfilled to the queried code for display.
    assert any(r.group_code == "wooly-kettle-61" for r in rows)


def test_anon_owner_uid_match_brackets_both_schemes():
    from auth.group_id_auth import anon_owner_uid_match

    exact, lo, hi = anon_owner_uid_match("wooly-kettle-61")
    assert exact == "anon-woolykettle61"  # new deterministic uid (no suffix)
    assert lo == "anon-woolykettle61-"  # legacy suffixed range start
    # The new exact uid is NOT inside the legacy range — that's the original
    # bug, and exactly why callers must ALSO query `ownerUid == exact`.
    assert not (lo <= exact < hi)
