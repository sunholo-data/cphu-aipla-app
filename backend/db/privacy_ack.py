"""Teacher privacy-notice acknowledgements (2026-10-05).

KU legal asked that every teacher be informed, in writing and before using the
platform, how their data is handled — a verbal explanation is not enough. The
teacher shell shows the notice until it is acknowledged; this module records the
acknowledgement so the programme can SHOW who was informed, of which version,
and when.

One document per (teacher, notice version) at
``privacy_acknowledgements/{uid}|{version}``. A new version re-shows the notice;
earlier acknowledgements stay as the record of what each teacher saw. The time
is the server's, never the client's.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from db.firestore import get_document, query_documents, set_document

_COLLECTION = "privacy_acknowledgements"

#: Bump when the notice's substance changes (the text in
#: frontend/messages/{da,en}/teacher-shell.json `PrivacyNoticeGate`, and the
#: /privacy page it links to). Every teacher then sees it again on next visit.
PRIVACY_NOTICE_VERSION = "2026-10-05"


def _doc_id(uid: str, version: str) -> str:
    return f"{uid}|{version}"


def get_acknowledgement(uid: str, version: str = PRIVACY_NOTICE_VERSION) -> dict[str, Any] | None:
    """The stored acknowledgement for this teacher and version, or ``None``."""
    if not uid:
        return None
    return get_document(_COLLECTION, _doc_id(uid, version)) or None


def record_acknowledgement(uid: str, email: str, version: str = PRIVACY_NOTICE_VERSION) -> dict[str, Any]:
    """Record that ``uid`` acknowledged ``version``. Idempotent: the FIRST time wins."""
    if not uid:
        raise ValueError("uid required")
    existing = get_acknowledgement(uid, version)
    if existing:
        return existing
    doc = {
        "uid": uid,
        "email": email or "",
        "version": version,
        "acknowledgedAt": datetime.now(UTC).isoformat(),
    }
    set_document(_COLLECTION, _doc_id(uid, version), doc, merge=False)
    return doc


def list_acknowledgements(version: str | None = None) -> list[dict[str, Any]]:
    """Every acknowledgement, optionally for one version. For the ops listing."""
    filters = [("version", "==", version)] if version else []
    return query_documents(_COLLECTION, filters=filters, limit=10_000)


__all__ = [
    "PRIVACY_NOTICE_VERSION",
    "get_acknowledgement",
    "list_acknowledgements",
    "record_acknowledgement",
]
