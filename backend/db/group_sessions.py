"""Firestore repository for group→session-id mapping (sprint 1.F).

Maps an anonymous group code to the most-recent active ADK session id so
that re-joining students resume their prior conversation instead of starting
a blank session.

Collection: ``group_sessions``  —  one document per group_id.
Schema:
    session_id  : str   — the ADK session id (= frontend thread id)
    created_at  : str   — ISO-8601 timestamp when this record was written
    expires_at  : str   — ISO-8601; records past this timestamp are ignored at
                         read time (matches the group code's 30-day TTL in
                         ADR-001)
    archived_at : str | None — set by the teacher [Reset session] button;
                              None while the session is active

Read semantics: a record is "active" iff ``archived_at is None`` AND
``expires_at > utcnow()``.

Write semantics (called from ``POST /api/sessions/{id}/bootstrap``):
    - ``set_active_session_for_group`` upserts the record unconditionally.
      The race window between a simultaneous-join and bootstrap is very small
      in practice (sub-second) and last-writer-wins is acceptable for v1.
      Production Firestore could use a transaction here for strict
      once-only semantics — noted for the 1.1 Terraform runbook.

Archive semantics (called from teacher [Reset session]):
    - ``archive_session_for_group`` is a no-op when no record exists (the
      group may never have had a completed session).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from db.firestore import get_document, set_document, update_document

_COLLECTION = "group_sessions"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def get_active_session_for_group(group_id: str) -> str | None:
    """Return the active session_id for *group_id*, or None.

    Returns None when:
    - no record exists yet (first join)
    - the record has ``archived_at`` set (teacher reset)
    - the record's ``expires_at`` is in the past (TTL expired)
    """
    data = get_document(_COLLECTION, group_id)
    if data is None:
        return None

    archived_at = _parse_dt(data.get("archived_at"))
    if archived_at is not None:
        return None

    expires_at = _parse_dt(data.get("expires_at"))
    if expires_at is not None and expires_at < _utcnow():
        return None

    return data.get("session_id") or None


def set_active_session_for_group(
    group_id: str,
    session_id: str,
    *,
    ttl_days: int = 30,
) -> None:
    """Register the group's shared session — FIRST-WINS, not last-writer-wins.

    Called from ``POST /api/sessions/{id}/bootstrap``. The group runs ONE shared
    conversation (2026-06-13): the first session established for the group is THE
    session, and every later join resumes it rather than starting a new one.

    So this does NOT overwrite an existing ACTIVE mapping (non-archived,
    non-expired) — that was the clobber bug: a stray fresh session (e.g. from a
    pre-resume race) would overwrite the pointer and orphan the conversation with
    all the history. We only (re)write when there's no active mapping yet, i.e.
    first session, or after a teacher [Reset session] (archived) / TTL expiry.

    Idempotent: re-registering the SAME session id refreshes the record.
    """
    existing = get_active_session_for_group(group_id)
    if existing is not None and existing != session_id:
        # An active shared session already exists — don't clobber it.
        return

    now = _utcnow()
    expires_at = now + timedelta(days=ttl_days)
    set_document(
        _COLLECTION,
        group_id,
        {
            "session_id": session_id,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "archived_at": None,
        },
    )


def archive_session_for_group(group_id: str) -> None:
    """Mark the current session as archived so the next join starts fresh.

    Called from the teacher [Reset session] button.  A no-op when no
    record exists for the group (the group may never have had a completed
    session or was already archived).
    """
    data = get_document(_COLLECTION, group_id)
    if data is None:
        return
    update_document(_COLLECTION, group_id, {"archived_at": _utcnow().isoformat()})


__all__ = [
    "archive_session_for_group",
    "get_active_session_for_group",
    "set_active_session_for_group",
]
