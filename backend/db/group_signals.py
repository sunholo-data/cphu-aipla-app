"""Firestore repository for live per-group classroom signals (1.1.29).

One ``group_signals/{group_id}`` doc per group. Today it carries a single
signal — the raised hand — but the shape is deliberately a per-group
live-signals doc so the live dashboard (1.1.31) and any future signal
("needs materials") extend it without a new collection.

Writes are keyed by the *caller's* ``group_id`` (the student session), never a
path param — a student can only raise their own group's hand. Reads are
class-scoped and gated by the teacher routes (``assert_can_read_class``).

See ``db/models/group_signal.py`` and
docs/design/aipla/v1.1.0-feedback/call-teacher.md.
"""

from __future__ import annotations

from datetime import UTC, datetime

from db.firestore import get_document, query_documents, set_document
from db.models.group_signal import GroupSignal

_COLLECTION = "group_signals"


def _utcnow_iso() -> str:
    return datetime.now(UTC).isoformat()


def get_signal(group_id: str) -> GroupSignal | None:
    """Return the group's signal doc, or None if it has never had one."""
    doc = get_document(_COLLECTION, group_id)
    if not doc:
        return None
    doc.pop("__id", None)
    return GroupSignal(**doc)


def raise_hand(
    group_id: str,
    class_id: str = "",
    activity_id: str = "",
    activity_title: str = "",
) -> GroupSignal:
    """Raise the group's hand. Idempotent: if a hand is already up, this is a
    no-op and returns the existing signal unchanged (so a double-tap or a
    network retry can't double-fire). Otherwise sets ``raised_hand_at`` now and
    clears any prior cleared/raised state.
    """
    existing = get_signal(group_id)
    if existing and existing.is_raised:
        return existing

    signal = GroupSignal(
        group_id=group_id,
        class_id=class_id,
        activity_id=activity_id,
        activity_title=activity_title,
        raised_hand_at=_utcnow_iso(),
        cleared_at=None,
        cleared_by="",
    )
    set_document(_COLLECTION, group_id, signal.model_dump())
    return signal


def clear_hand(group_id: str, cleared_by: str) -> GroupSignal | None:
    """Lower/acknowledge the group's hand. Idempotent — clearing an already-clear
    (or absent) signal is a no-op. ``cleared_by`` is the teacher uid (ack) or the
    literal ``"student"`` (self-lower). Returns the updated signal, or None if no
    signal exists.
    """
    existing = get_signal(group_id)
    if existing is None:
        return None
    if not existing.is_raised:
        return existing

    existing.cleared_at = _utcnow_iso()
    existing.cleared_by = cleared_by
    existing.raised_hand_at = None
    set_document(_COLLECTION, group_id, existing.model_dump())
    return existing


def list_raised_for_class(class_id: str) -> list[GroupSignal]:
    """All groups in a class with an active raised hand, newest first.

    Filters by ``class_id`` in Firestore, then keeps only active signals in
    Python (a ``!= None`` filter on ``raised_hand_at`` is awkward in Firestore
    and the per-class signal count is tiny).
    """
    docs = query_documents(_COLLECTION, filters=[("class_id", "==", class_id)])
    signals = []
    for doc in docs:
        doc.pop("__id", None)
        sig = GroupSignal(**doc)
        if sig.is_raised:
            signals.append(sig)
    signals.sort(key=lambda s: s.raised_hand_at or "", reverse=True)
    return signals
