"""Firestore repository for the class-independent ``Activity`` (ALS-1 M0).

All I/O goes through ``db.firestore`` helpers. The doc id is the activity's own
``act-…`` id (a flat top-level collection), NOT a composite key — an activity
exists independently of any class and is assigned to classes via
``Class.activity_ids``.

This is the M0 replacement for the per-class ``activity_configs`` composite-key
store. The legacy store stays in place through the dual-read window (M0.2); this
module never deletes from it.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, query_documents, set_document, update_document
from db.models.activity import Activity, mint_activity_id

logger = logging.getLogger(__name__)

_COLLECTION = "activities"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_firestore(activity: Activity) -> dict[str, Any]:
    """Pydantic → Firestore dict (camelCase keys, ISO timestamps)."""
    return activity.model_dump(by_alias=True, mode="json")


def _from_firestore(data: dict[str, Any]) -> Activity:
    """Firestore dict → Pydantic. Accepts both alias and snake_case."""
    return Activity.model_validate(data)


def save_activity(activity: Activity) -> Activity:
    """Create or overwrite an activity, stamping timestamps.

    The workhorse write used by create (caller mints the id), the backfill
    (M0.2 passes a fully-built ``Activity``), and edits. ``created_at`` is set
    once (preserved on re-save); ``updated_at`` is bumped every time.
    """
    now = _utcnow()
    stored = activity.model_copy(
        update={
            "created_at": activity.created_at or now,
            "updated_at": now,
        }
    )
    set_document(_COLLECTION, stored.activity_id, _to_firestore(stored))
    return stored


def create_activity(activity: Activity) -> Activity:
    """Persist a NEW activity, minting an ``act-…`` id when the caller left it blank.

    Convenience over ``save_activity`` for the create path: a route builds an
    ``Activity`` from the request body without knowing the id, and the repo mints
    one. An explicit id (e.g. an adopt-copy that wants provenance preserved) is
    honoured.
    """
    activity_id = activity.activity_id or mint_activity_id()
    return save_activity(activity.model_copy(update={"activity_id": activity_id}))


def get_activity(activity_id: str, *, include_deleted: bool = False) -> Activity | None:
    """Return the activity, or ``None`` if missing (or soft-deleted, unless asked)."""
    data = get_document(_COLLECTION, activity_id)
    if data is None:
        return None
    activity = _from_firestore(data)
    if activity.deleted_at is not None and not include_deleted:
        return None
    return activity


def list_activities_by_owner(owner_uid: str, *, include_deleted: bool = False) -> list[Activity]:
    """List a teacher's activities (newest first), soft-deleted excluded by default.

    Owner-scoped by construction (``ownerUid ==``) so it can never leak another
    teacher's activities. Backs the activities-library index (M1).
    """
    rows = [_from_firestore(d) for d in query_documents(_COLLECTION, filters=[("ownerUid", "==", owner_uid)])]
    if not include_deleted:
        rows = [a for a in rows if a.deleted_at is None]
    rows.sort(key=lambda a: a.updated_at or datetime.min.replace(tzinfo=UTC), reverse=True)
    return rows


def soft_delete_activity(activity_id: str) -> None:
    """Soft-delete (sets ``deletedAt``). Idempotent — no-op if already gone.

    Soft, not hard: a deleted activity may still be referenced by a class's
    ``activity_ids`` mid-cutover, and provenance (``source_activity_id``) on a
    copy should survive the source's deletion.
    """
    update_document(_COLLECTION, activity_id, {"deletedAt": _utcnow().isoformat()})


__all__ = [
    "create_activity",
    "get_activity",
    "list_activities_by_owner",
    "save_activity",
    "soft_delete_activity",
]
