"""Standalone Firestore client — no Sunholo dependency.

Provides async-style access to Firestore collections.
Uses the synchronous google-cloud-firestore SDK (no async driver needed
for Cloud Run's concurrency model — one request per container instance).

When ``LOCAL_MODE=1`` is set the client is the in-memory drop-in from
``db.firestore_inmemory`` — no GCP credentials required. See
``config/local_mode.py`` for the flag definition and safety asserts.
"""

from __future__ import annotations

import logging
from typing import Any

from google.cloud import firestore

from config.gcp import resolve_gcp_project
from config.local_mode import is_local_mode
from db.firestore_protocol import FirestoreClient

logger = logging.getLogger(__name__)

_client: FirestoreClient | None = None


def get_client() -> FirestoreClient:
    """Return a module-level Firestore client (lazy singleton).

    Returns ``InMemoryFirestoreClient`` when LOCAL_MODE is on, else the
    real ``google.cloud.firestore.Client``. Both satisfy the
    :class:`~db.firestore_protocol.FirestoreClient` contract — the single
    duck-typed surface the whole backend programs against, and the typed
    checklist a future Postgres adapter must implement (see
    docs/design/aipla/v2.0.0-handover/firestore-portability-seam.md).

    Code outside ``db/`` must NOT call this directly — go through the
    helper functions below (``get_document``, ``set_document``,
    ``query_documents``, …) so the data-access surface stays centralised
    and portable.
    """
    global _client
    if _client is None:
        if is_local_mode():
            from db.firestore_inmemory import InMemoryFirestoreClient

            logger.info("LOCAL_MODE=1 — using InMemoryFirestoreClient (no GCP)")
            _client = InMemoryFirestoreClient()
        else:
            project = resolve_gcp_project()
            _client = firestore.Client(project=project) if project else firestore.Client()
    return _client


def _reset_client_for_testing() -> None:
    """Test helper — clears the singleton so tests can flip LOCAL_MODE."""
    global _client
    _client = None


def _require_path(collection: str, doc_id: str) -> None:
    """Refuse a blank collection or document id before it reaches Firestore.

    A blank id builds the path ``.../documents/<collection>/`` with a trailing
    slash, which Firestore rejects as ``InvalidArgument: 400 Document name``
    from inside gRPC — an error that reads like a service fault and says
    nothing about which caller passed the empty string.

    This has cost real sessions twice. ``auth/permissions.py`` fixed it locally
    on 2026-05-20 (see the comment there); ``db/clients.py`` hit the identical
    bug three months later and took every document upload down for the whole
    2026-08-21 teacher pilot, because an anonymous-group student has
    ``domain == ""`` (ADR-001). Guarding at the shared helper is what stops the
    third instance.

    Raises ``ValueError`` rather than returning ``None``: a blank id is a
    programming error, and returning "not found" would make it indistinguishable
    from a legitimate miss.
    """
    if not collection or not collection.strip():
        raise ValueError(f"Firestore collection must not be blank (doc_id={doc_id!r})")
    if not doc_id or not doc_id.strip():
        raise ValueError(
            f"Firestore doc_id must not be blank for collection {collection!r} — "
            "an empty key is usually an unguarded user.email/user.domain on an "
            "anonymous-group user (ADR-001)"
        )


def get_document(collection: str, doc_id: str) -> dict[str, Any] | None:
    """Get a single document by ID. Returns None if not found."""
    _require_path(collection, doc_id)
    doc = get_client().collection(collection).document(doc_id).get()
    return doc.to_dict() if doc.exists else None


def set_document(collection: str, doc_id: str, data: dict[str, Any], merge: bool = False) -> None:
    """Set (create or overwrite) a document."""
    _require_path(collection, doc_id)
    get_client().collection(collection).document(doc_id).set(data, merge=merge)


def update_document(collection: str, doc_id: str, data: dict[str, Any]) -> None:
    """Update specific fields on an existing document."""
    _require_path(collection, doc_id)
    get_client().collection(collection).document(doc_id).update(data)


def delete_document(collection: str, doc_id: str) -> None:
    """Delete a document by ID."""
    _require_path(collection, doc_id)
    get_client().collection(collection).document(doc_id).delete()


def query_documents(
    collection: str,
    filters: list[tuple[str, str, Any]] | None = None,
    order_by: str | None = None,
    order_direction: str = "DESCENDING",
    limit: int | None = None,
) -> list[dict[str, Any]]:
    """Query documents with optional filters, ordering, and limit.

    Args:
        collection: Firestore collection path.
        filters: List of (field, op, value) tuples. Op is a Firestore operator
                 string like "==", "in", "array_contains".
        order_by: Field to order results by.
        order_direction: "ASCENDING" or "DESCENDING".
        limit: Max documents to return.

    Returns:
        List of document dicts (each includes the document ID as "__id").
    """
    ref = get_client().collection(collection)
    query = ref

    if filters:
        for field, op, value in filters:
            query = query.where(filter=firestore.FieldFilter(field, op, value))

    if order_by:
        direction = firestore.Query.DESCENDING if order_direction == "DESCENDING" else firestore.Query.ASCENDING
        query = query.order_by(order_by, direction=direction)

    if limit:
        query = query.limit(limit)

    results = []
    for doc in query.stream():
        data = doc.to_dict()
        if data is not None:
            data["__id"] = doc.id
            results.append(data)
    return results


def increment_field(collection: str, doc_id: str, field: str, amount: int = 1) -> None:
    """Atomically increment a numeric field."""
    get_client().collection(collection).document(doc_id).update({field: firestore.Increment(amount)})
