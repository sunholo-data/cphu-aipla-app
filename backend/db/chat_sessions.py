"""Firestore repository for ChatSessionIndex.

All I/O goes through `db.firestore` helpers — no raw SDK calls here.
`list_sessions_for_document` performs server-side filtering where Firestore
supports it (ownerUid, archivedAt, documentIds array_contains) and
post-filters tagged sessions in Python, since Firestore's ARRAY_CONTAINS_ANY
is unpredictable when the viewer's tag list is empty.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Literal

from google.cloud import firestore as _fs

from auth.access_context import AccessContext, can_access
from db.firestore import get_client, get_document, query_documents, set_document, update_document
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex

logger = logging.getLogger(__name__)

_COLLECTION = "chat_sessions"


def _utcnow() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------


def create_session_index(
    *,
    session_id: str,
    skill_id: str,
    owner_uid: str,
    access_control: AccessControl,
    document_ids: list[str] | None = None,
    first_message_at: datetime | None = None,
    group_code: str | None = None,
) -> ChatSessionIndex:
    """Persist a new ChatSessionIndex row. Idempotent: overwrites if exists."""
    now = first_message_at or _utcnow()
    idx = ChatSessionIndex(
        sessionId=session_id,
        documentIds=list(document_ids) if document_ids else [],
        skillId=skill_id,
        ownerUid=owner_uid,
        accessControl=access_control,
        firstMessageAt=now,
        lastMessageAt=now,
        groupCode=group_code,
    )
    set_document(_COLLECTION, session_id, _to_firestore(idx))
    return idx


def save_session_index(idx: ChatSessionIndex) -> None:
    """Overwrite the full index row (used after bumping counters / title)."""
    set_document(_COLLECTION, idx.session_id, _to_firestore(idx))


def update_session_fields(session_id: str, fields: dict) -> None:
    """Partial update — only send changed fields to Firestore."""
    update_document(_COLLECTION, session_id, fields)


def add_session_documents(session_id: str, doc_ids: list[str]) -> None:
    """Atomically add doc ids to the session's ``documentIds`` array.

    Uses Firestore ``ArrayUnion`` so concurrent turns don't clobber each
    other and re-adding an existing id is a no-op. Called by
    ``make_document_loader`` whenever new tabs are loaded mid-session.
    """
    if not doc_ids:
        return
    update_document(
        _COLLECTION,
        session_id,
        {
            "documentIds": _fs.ArrayUnion(list(doc_ids)),
        },
    )


def soft_delete_session(session_id: str) -> None:
    """Soft-delete: set archivedAt to now. Owner-only gate is in the route."""
    update_document(_COLLECTION, session_id, {"archivedAt": _utcnow().isoformat()})


def increment_proactive_turn_count(session_id: str) -> None:
    """Record one SIM-REACTIVE proactive tutor turn firing.

    Bumps ``proactiveTurnCount`` by 1 atomically AND stamps
    ``lastProactiveTurnAt`` to now. Used by the sim-reactive path
    (post-AG-UI run for ``[event_reactive:*]`` sentinels) where the
    timestamp drives the 90s session-wide cooldown between proactive
    turns. Greet uses ``increment_proactive_turn_count_no_stamp`` so
    that the first sim-reactive after the greet isn't blocked by
    cooldown — see M8-fix #3 (2026-06-03).
    """
    update_document(
        _COLLECTION,
        session_id,
        {
            "proactiveTurnCount": _fs.Increment(1),
            "lastProactiveTurnAt": _utcnow().isoformat(),
        },
    )


def increment_proactive_turn_count_no_stamp(session_id: str) -> None:
    """Record one greet-style proactive turn firing WITHOUT touching
    ``lastProactiveTurnAt``.

    Used by ``/greet`` (Phase A auto-greet) so the greet counts toward
    ``proactiveTurnCount`` (analytics signal) but does NOT establish a
    cooldown window. Reasoning: the brief asked for "tutor responds to
    every serious student interaction"; blocking the very first
    sim-reactive turn just because the greet streamed within the last
    90s defeats that intent. The greet is structurally different from
    a reactive turn — it's a welcome, not a response to a student
    action — so it should not occupy the cooldown slot.
    """
    update_document(
        _COLLECTION,
        session_id,
        {"proactiveTurnCount": _fs.Increment(1)},
    )


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------


def get_session_index(session_id: str) -> ChatSessionIndex | None:
    """Return the index row or None if it doesn't exist."""
    data = get_document(_COLLECTION, session_id)
    if data is None:
        return None
    return _from_firestore(data, session_id)


SessionFilter = Literal["mine", "team", "all"]


def list_sessions_for_document(
    doc_id: str,
    viewer_ctx: AccessContext,
    filter: SessionFilter = "all",
    page_size: int = 20,
    cursor: str | None = None,
) -> tuple[list[ChatSessionIndex], str | None]:
    """List non-archived sessions for a document visible to the viewer.

    Returns (sessions, next_cursor). next_cursor is the last sessionId in the
    page, or None when the page is the last one. Cursor-based pagination is
    implemented by re-querying and skipping to the cursor document — Firestore
    start_after() requires a DocumentSnapshot, so we fetch a small page-sized
    window after the cursor document.

    Access semantics:
    - filter=mine: only sessions owned by viewer (fast; single equality query)
    - filter=team: sessions where can_access() passes AND not owned by viewer
    - filter=all:  union of mine + team (post-filtered by can_access())

    Post-filter is needed because Firestore's ARRAY_CONTAINS_ANY returns no
    results when the provided array is empty (viewer has no tags), which would
    incorrectly hide public/domain/specific sessions the viewer can see.
    """
    client = get_client()
    col = client.collection(_COLLECTION)

    # Base query: non-archived sessions whose documentIds list contains this
    # doc, newest first. ``array_contains`` is the canonical way to find a
    # value inside an array field — sessions with multiple docs match each
    # of their docs' panels.
    query = (
        col.where(filter=_fs.FieldFilter("documentIds", "array_contains", doc_id))
        .where(filter=_fs.FieldFilter("archivedAt", "==", None))
        .order_by("lastMessageAt", direction=_fs.Query.DESCENDING)
        .limit(page_size * 4)  # over-fetch to absorb post-filter losses
    )

    # Apply cursor: start after the cursor document
    if cursor:
        cursor_doc = col.document(cursor).get()
        if cursor_doc.exists:
            query = query.start_after(cursor_doc)

    # Pull raw documents and post-filter by access. Stream errors typically
    # mean the composite index hasn't been deployed — Firestore's error
    # carries the create-index URL, so re-raise after logging so the dev
    # sees both the intent ("missing index") and the actionable link.
    try:
        snaps = list(query.stream())
    except Exception as exc:
        logger.error(
            "list_sessions_for_document failed for doc=%s — likely missing "
            "Firestore index for chat_sessions[documentIds array_contains, "
            "archivedAt ==, lastMessageAt desc]. Underlying: %s",
            doc_id,
            exc,
        )
        raise

    results: list[ChatSessionIndex] = []
    last_id: str | None = None
    for snap in snaps:
        if snap.id is None or not snap.exists:
            continue
        data = snap.to_dict()
        if data is None:
            continue
        try:
            idx = _from_firestore(data, snap.id)
        except Exception as exc:
            logger.warning("malformed chat_sessions/%s: %s", snap.id, exc)
            continue

        if not can_access(idx.access_control, viewer_ctx, idx.owner_uid):
            continue

        if filter == "mine" and idx.owner_uid != viewer_ctx.uid:
            continue
        if filter == "team" and idx.owner_uid == viewer_ctx.uid:
            continue

        results.append(idx)
        last_id = snap.id
        if len(results) >= page_size:
            break

    next_cursor = last_id if len(results) == page_size else None
    return results, next_cursor


def list_sessions_for_skill(
    skill_id: str,
    owner_uid: str,
    page_size: int = 20,
    cursor: str | None = None,
) -> tuple[list[ChatSessionIndex], str | None]:
    """List non-archived sessions for a skill owned by owner_uid, newest first.

    Returns (sessions, next_cursor). Only the owner's sessions are returned —
    no access-control fan-out needed because this endpoint is owner-only.
    """
    client = get_client()
    col = client.collection(_COLLECTION)

    query = (
        col.where(filter=_fs.FieldFilter("skillId", "==", skill_id))
        .where(filter=_fs.FieldFilter("ownerUid", "==", owner_uid))
        .where(filter=_fs.FieldFilter("archivedAt", "==", None))
        .order_by("lastMessageAt", direction=_fs.Query.DESCENDING)
        .limit(page_size + 1)  # fetch one extra to detect next page
    )

    if cursor:
        cursor_doc = col.document(cursor).get()
        if cursor_doc.exists:
            query = query.start_after(cursor_doc)

    results: list[ChatSessionIndex] = []
    last_id: str | None = None
    for snap in query.stream():
        if snap.id is None or not snap.exists:
            continue
        data = snap.to_dict()
        if data is None:
            continue
        try:
            idx = _from_firestore(data, snap.id)
        except Exception as exc:
            logger.warning("malformed chat_sessions/%s: %s", snap.id, exc)
            continue
        results.append(idx)
        last_id = snap.id
        if len(results) >= page_size:
            break

    next_cursor = last_id if len(results) == page_size else None
    return results, next_cursor


def list_sessions_for_group_codes(
    group_codes: list[str],
    page_size: int = 50,
) -> list[ChatSessionIndex]:
    """List non-archived sessions for any of the given group codes, newest first.

    Used by the teacher dashboard to show recent student activity across all
    groups in a class. Returns at most ``page_size`` rows merged and re-sorted
    from per-code queries.

    Uses ownerUid prefix matching (``anon-{cleaned_code}-*``) rather than the
    ``groupCode`` field so sessions created before the groupCode backfill
    (2026-06-02) are also visible. This is the same strategy as
    ``find_latest_session_for_group``; archivedAt is filtered in Python because
    Firestore doesn't allow combining a range filter with an equality filter on
    a different field without a composite index for each combination.
    """
    if not group_codes:
        return []
    seen: set[str] = set()
    results: list[ChatSessionIndex] = []
    for code in group_codes:
        cleaned = code.replace("-", "")
        lo = f"anon-{cleaned}-"
        hi = lo + "￿"
        rows = query_documents(
            _COLLECTION,
            filters=[("ownerUid", ">=", lo), ("ownerUid", "<", hi)],
            limit=page_size,
        )
        for row in rows:
            try:
                idx = _from_firestore(row, row.get("__id") or row.get("sessionId", ""))
            except Exception as exc:
                logger.warning("malformed chat_sessions row for %s: %s", code, exc)
                continue
            if idx.archived_at is not None:
                continue  # skip archived sessions
            if idx.session_id in seen:
                continue
            # Backfill groupCode for sessions written before make_session_tracker
            # learned to pass group_id (2026-06-02). We matched them via the
            # ownerUid prefix; the loop variable `code` IS the group code we
            # matched on, so we can fill the display field reliably. Frontend
            # uses this to render the badge + deep-link to the session.
            if not idx.group_code:
                idx.group_code = code
            seen.add(idx.session_id)
            results.append(idx)
    results.sort(key=lambda s: s.last_message_at, reverse=True)
    return results[:page_size]


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------


def _to_firestore(idx: ChatSessionIndex) -> dict:
    """Convert to a flat dict suitable for Firestore set()."""
    d = idx.model_dump(by_alias=True, exclude_none=False)
    # Convert datetimes to ISO strings for consistent storage
    for key in (
        "firstMessageAt",
        "lastMessageAt",
        "archivedAt",
        "lastProactiveTurnAt",
        "lastStudentMessageAt",
    ):
        val = d.get(key)
        if isinstance(val, datetime):
            d[key] = val.isoformat()
    # Nested AccessControl → dict
    if "accessControl" in d and hasattr(d["accessControl"], "model_dump"):
        d["accessControl"] = d["accessControl"].model_dump(exclude_none=True)
    return d


def _from_firestore(data: dict, doc_id: str) -> ChatSessionIndex:
    """Hydrate a ChatSessionIndex from a Firestore document dict."""
    # Ensure sessionId is populated from doc ID if not stored explicitly
    if "sessionId" not in data:
        data = {**data, "sessionId": doc_id}
    return ChatSessionIndex.model_validate(data)
