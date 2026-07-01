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

from db.firestore import get_document, query_documents, set_document, update_document

_COLLECTION = "group_sessions"

# 1.1.53 M0 — how long a held turn-lock stays valid before it's considered stale
# and stealable. A device that closes its tab mid-turn never runs the release, so
# without a TTL the group's shared conversation would wedge. Tutor turns are
# short; 90s is a generous ceiling on a single turn.
TURN_LOCK_TTL_SECONDS = 90


def _doc_key(group_id: str, activity_id: str | None) -> str:
    """The session-mapping doc id. ALS-1: a group now runs MANY activities, each
    with its own conversation, so the active session is scoped per (group,
    activity) — ``{group_id}:{activity_id}``. ``activity_id=None`` reads the legacy
    group-level doc (pre-ALS-1 groups had one shared session)."""
    return f"{group_id}:{activity_id}" if activity_id else group_id


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _parse_dt(iso: str | None) -> datetime | None:
    if not iso:
        return None
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def get_active_session_for_group(group_id: str, activity_id: str | None = None) -> str | None:
    """Return the active session_id for *(group_id, activity_id)*, or None.

    ALS-1: scoped per activity so a group's different activities each keep their
    own conversation (they used to share one). ``activity_id=None`` reads the
    legacy group-level mapping.

    Returns None when:
    - no record exists yet (first open of this activity)
    - the record has ``archived_at`` set (teacher reset)
    - the record's ``expires_at`` is in the past (TTL expired)
    """
    data = get_document(_COLLECTION, _doc_key(group_id, activity_id))
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
    activity_id: str | None = None,
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
    existing = get_active_session_for_group(group_id, activity_id)
    if existing is not None and existing != session_id:
        # An active session already exists for this (group, activity) — don't clobber.
        return

    now = _utcnow()
    expires_at = now + timedelta(days=ttl_days)
    set_document(
        _COLLECTION,
        _doc_key(group_id, activity_id),
        {
            "session_id": session_id,
            # group_id / activity_id are stored as fields too so archive-all (teacher
            # reset) can query every activity's session for a group.
            "group_id": group_id,
            "activity_id": activity_id,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "archived_at": None,
        },
    )


def archive_session_for_group(group_id: str, activity_id: str | None = None) -> None:
    """Mark a group's session(s) archived so the next open starts fresh.

    Called from the teacher [Reset session] button. With ``activity_id`` set,
    archives only that activity's session. Without it (the teacher resets the
    whole group), archives EVERY activity's session for the group (ALS-1 —
    sessions are now per-activity) plus the legacy group-level doc. A no-op when
    nothing matches.
    """
    now = _utcnow().isoformat()
    if activity_id is not None:
        if get_document(_COLLECTION, _doc_key(group_id, activity_id)) is not None:
            update_document(_COLLECTION, _doc_key(group_id, activity_id), {"archived_at": now})
        return

    # Reset-all: every per-activity doc (carries a group_id field) + the legacy
    # group-level doc (id == group_id, no group_id field — query misses it).
    for d in query_documents(_COLLECTION, filters=[("group_id", "==", group_id)]):
        update_document(_COLLECTION, d["__id"], {"archived_at": now})
    legacy = get_document(_COLLECTION, group_id)
    if legacy is not None and legacy.get("archived_at") is None:
        update_document(_COLLECTION, group_id, {"archived_at": now})


# ---------------------------------------------------------------------------
# 1.1.53 M0 — per-group turn-lock
# ---------------------------------------------------------------------------
#
# A group shares ONE ADK session (deterministic uid + one session pointer), so
# two students sending at once would fire two parallel ``ADKAgent.run()`` calls
# against the same session with no serialisation — undefined turn order, events
# that can interleave/clobber the shared transcript. This is a **best-effort
# mutex**: a read-check-write over the same ``group_sessions`` doc, keyed by a
# per-request token, with a TTL so a crashed turn self-heals.
#
# It is best-effort by design, not a hard mutex: the firestore abstraction
# deliberately exposes no transactions (see ``db/firestore_inmemory``: "No
# transactions. v6 doesn't use them.") — same posture as
# ``set_active_session_for_group`` above, which also accepts a sub-second race
# window with strict once-only semantics deferred to the prod Terraform runbook.
# The residual window here is milliseconds wide, the client-side composer lock
# (1.1.53 M1) removes most simultaneous sends before they reach the wire, and
# the worst case of a lost race is simply today's behaviour (two turns) for that
# one turn — never a new corruption. Net: a large reduction in the race, no
# regression when it's lost.


def acquire_turn_lock(
    group_id: str,
    token: str,
    *,
    activity_id: str | None = None,
    ttl_seconds: int = TURN_LOCK_TTL_SECONDS,
) -> bool:
    """Try to hold the turn-lock for *(group_id, activity_id)*.

    Returns True if the lock is now held by ``token`` (it was free, stale, or
    already ours), False if another token holds a non-stale lock. The lock rides
    the group's existing ``group_sessions`` doc (created lock-only if the group
    hasn't bootstrapped a session yet — a lock-only doc has no ``session_id`` so
    the pointer read still returns None).
    """
    key = _doc_key(group_id, activity_id)
    data = get_document(_COLLECTION, key)
    now = _utcnow()
    if data is not None:
        in_flight_at = _parse_dt(data.get("turn_in_flight_at"))
        holder = data.get("turn_lock_token")
        held = in_flight_at is not None and (now - in_flight_at) < timedelta(seconds=ttl_seconds)
        if held and holder != token:
            return False

    set_document(
        _COLLECTION,
        key,
        {"turn_in_flight_at": now.isoformat(), "turn_lock_token": token},
        merge=True,
    )
    return True


def release_turn_lock(group_id: str, token: str, *, activity_id: str | None = None) -> None:
    """Release the turn-lock — but ONLY if ``token`` holds it.

    A no-op when the doc is missing or a *different* token holds the lock (a
    stale release from another client must not unlock a live turn — the TTL, not
    a foreign release, is what reclaims a wedged lock).
    """
    key = _doc_key(group_id, activity_id)
    data = get_document(_COLLECTION, key)
    if data is None:
        return
    holder = data.get("turn_lock_token")
    if holder is not None and holder != token:
        return
    set_document(
        _COLLECTION,
        key,
        {"turn_in_flight_at": None, "turn_lock_token": None},
        merge=True,
    )


def get_turn_lock(
    group_id: str,
    *,
    activity_id: str | None = None,
    ttl_seconds: int = TURN_LOCK_TTL_SECONDS,
) -> dict[str, object]:
    """Read the turn-lock state for the pulse endpoint (1.1.53 M1).

    Returns ``{"in_flight": bool, "started_at": str | None}``. A stale (past-TTL)
    or absent lock reports ``in_flight=False`` so a crashed turn never shows other
    devices a permanently-locked composer.
    """
    data = get_document(_COLLECTION, _doc_key(group_id, activity_id))
    if data is None:
        return {"in_flight": False, "started_at": None}
    in_flight_at = _parse_dt(data.get("turn_in_flight_at"))
    if in_flight_at is None or (_utcnow() - in_flight_at) >= timedelta(seconds=ttl_seconds):
        return {"in_flight": False, "started_at": None}
    return {"in_flight": True, "started_at": data.get("turn_in_flight_at")}


__all__ = [
    "TURN_LOCK_TTL_SECONDS",
    "acquire_turn_lock",
    "archive_session_for_group",
    "get_active_session_for_group",
    "get_turn_lock",
    "release_turn_lock",
    "set_active_session_for_group",
]
