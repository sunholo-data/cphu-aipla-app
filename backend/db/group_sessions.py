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
    """Upsert the active session mapping for *group_id*.

    Called from ``POST /api/sessions/{id}/bootstrap`` when a fresh session
    has just been created.  Overwrites any existing (possibly archived or
    expired) record so the mapping is always current after a bootstrap.

    Args:
        group_id: The anonymous group code (Firestore document id).
        session_id: The ADK session id to associate.
        ttl_days: Lifetime of this record; defaults to 30 to match ADR-001
                  group-code TTL.
    """
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
    "get_active_session_for_group",
    "set_active_session_for_group",
    "archive_session_for_group",
]
