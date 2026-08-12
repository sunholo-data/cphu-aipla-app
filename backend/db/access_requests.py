"""The queue of people asking to join the programme (ACCESS-1 M4).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

A visitor who wants a live tutor has exactly one route: ask, and have a human
grant it. This is where the asking lands, so that granting is a queue to work
through rather than an inbox to remember.

PRIVACY
    These rows hold a name, an email and an institution for people who may never
    be granted anything. ``purge_stale`` exists so that is a bounded liability,
    and the retention window is named on the privacy page rather than left to
    whatever Firestore happens to still contain.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from db.firestore import delete_document, get_document, query_documents, set_document

logger = logging.getLogger(__name__)

_COLLECTION = "access_requests"

RequestStatus = Literal["pending", "granted", "declined"]

#: How long a decided-or-abandoned request is kept. Named on the privacy page.
RETENTION_DAYS = 90


@dataclass(frozen=True)
class AccessRequest:
    uid: str
    email: str
    name: str = ""
    institution: str = ""
    message: str = ""
    status: RequestStatus = "pending"
    requested_at: str = ""
    decided_at: str | None = None
    decided_by: str = ""

    def to_doc(self) -> dict[str, Any]:
        return {
            "uid": self.uid,
            "email": self.email,
            "name": self.name,
            "institution": self.institution,
            "message": self.message,
            "status": self.status,
            "requestedAt": self.requested_at,
            "decidedAt": self.decided_at,
            "decidedBy": self.decided_by,
        }

    @classmethod
    def from_doc(cls, doc: dict[str, Any]) -> AccessRequest:
        raw_status = str(doc.get("status") or "pending")
        status: RequestStatus = raw_status if raw_status in {"pending", "granted", "declined"} else "pending"  # type: ignore[assignment]
        return cls(
            uid=str(doc.get("uid") or doc.get("__id") or ""),
            email=str(doc.get("email") or ""),
            name=str(doc.get("name") or ""),
            institution=str(doc.get("institution") or ""),
            message=str(doc.get("message") or ""),
            status=status,
            requested_at=str(doc.get("requestedAt") or ""),
            decided_at=doc.get("decidedAt"),
            decided_by=str(doc.get("decidedBy") or ""),
        )


def upsert_access_request(
    *,
    uid: str,
    email: str,
    name: str = "",
    institution: str = "",
    message: str = "",
) -> AccessRequest:
    """Record (or update) one person's request. Keyed by uid, so re-submitting
    replaces rather than piles up.

    A re-submission from someone already granted or declined resets them to
    pending — they are asking again, which is information, not noise.
    """
    if not uid:
        raise ValueError("uid is required")
    request = AccessRequest(
        uid=uid,
        email=email,
        name=name,
        institution=institution,
        message=message,
        status="pending",
        requested_at=datetime.now(UTC).isoformat(),
    )
    set_document(_COLLECTION, uid, request.to_doc(), merge=False)
    return request


def get_access_request(uid: str) -> AccessRequest | None:
    doc = get_document(_COLLECTION, uid)
    return AccessRequest.from_doc(doc) if doc else None


def list_access_requests(*, status: RequestStatus | None = "pending", limit: int = 200) -> list[AccessRequest]:
    """Requests, newest first. ``status=None`` returns every state."""
    filters = [("status", "==", status)] if status else None
    docs = query_documents(_COLLECTION, filters=filters, limit=limit)
    requests = [AccessRequest.from_doc(d) for d in docs]
    return sorted(requests, key=lambda r: r.requested_at or "", reverse=True)


def mark_decided(uid: str, *, status: RequestStatus, decided_by: str = "") -> bool:
    """Close a request. Returns False if there was no such request."""
    existing = get_access_request(uid)
    if existing is None:
        return False
    doc = existing.to_doc()
    doc["status"] = status
    doc["decidedAt"] = datetime.now(UTC).isoformat()
    doc["decidedBy"] = decided_by
    set_document(_COLLECTION, uid, doc, merge=False)
    return True


def purge_stale(*, older_than_days: int = RETENTION_DAYS) -> int:
    """Delete decided requests older than the retention window. Returns the count.

    Only touches DECIDED rows: a pending request is still live work, however old,
    and silently dropping it would lose someone's ask.
    """
    cutoff = (datetime.now(UTC) - timedelta(days=older_than_days)).isoformat()
    purged = 0
    for request in list_access_requests(status=None, limit=1000):
        if request.status == "pending":
            continue
        stamp = request.decided_at or request.requested_at
        if stamp and stamp < cutoff:
            delete_document(_COLLECTION, request.uid)
            purged += 1
    if purged:
        logger.info("access_requests.purge_stale: removed %d decided request(s)", purged)
    return purged


__all__ = [
    "RETENTION_DAYS",
    "AccessRequest",
    "RequestStatus",
    "get_access_request",
    "list_access_requests",
    "mark_decided",
    "purge_stale",
    "upsert_access_request",
]
