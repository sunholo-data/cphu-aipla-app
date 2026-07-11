"""Teacher account defaults (1.1.58 / SETTINGS-1).

One Firestore doc per teacher at ``teacher_prefs/{uid}`` — the account-level
DEFAULTS that seed contextual controls (builder language on /new, class persona
at create) plus the beta-features opt-in map. Missing doc ⇒ ``{}`` ⇒ every
consumer behaves exactly as before this feature existed.

Own-uid only by construction: callers pass the VERIFIED token uid; there is no
cross-teacher read or admin surface here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, set_document

_COLLECTION = "teacher_prefs"

#: The storable fields — the route model is the validation layer; this list is
#: the storage allow-list so a widened route model can't silently persist junk.
_FIELDS = ("defaultLanguage", "defaultPersonaId", "features")


def get_teacher_prefs(uid: str) -> dict[str, Any]:
    """The teacher's prefs doc, or ``{}`` when unset."""
    if not uid:
        return {}
    doc = get_document(_COLLECTION, uid) or {}
    return {k: doc[k] for k in _FIELDS if k in doc}


def merge_teacher_prefs(uid: str, updates: dict[str, Any]) -> dict[str, Any]:
    """Partial-merge ``updates`` into the teacher's prefs; returns the result.

    ``None`` values are stored (an explicit clear); unknown keys are dropped by
    the allow-list. Timestamps ride along for audit.
    """
    current = get_teacher_prefs(uid)
    merged = {**current, **{k: v for k, v in updates.items() if k in _FIELDS}}
    set_document(
        _COLLECTION,
        uid,
        {**merged, "updatedAt": datetime.now(UTC).isoformat()},
        merge=False,
    )
    return merged


__all__ = ["get_teacher_prefs", "merge_teacher_prefs"]
