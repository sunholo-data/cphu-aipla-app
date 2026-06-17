"""The Firestore client surface is a pinned, portable contract.

Guards firestore-portability-seam: both the in-memory client (today) and a
future Postgres adapter must satisfy ``FirestoreClient``. ``runtime_checkable``
isinstance verifies method presence — a coarse but real guard against the
in-memory drop-in silently diverging from the contract the backend relies on.
"""

from __future__ import annotations

from db.firestore_inmemory import InMemoryFirestoreClient
from db.firestore_protocol import (
    CollectionReference,
    DocumentReference,
    FirestoreClient,
)


def test_inmemory_client_satisfies_contract() -> None:
    client = InMemoryFirestoreClient()
    assert isinstance(client, FirestoreClient)


def test_inmemory_collection_and_document_satisfy_contract() -> None:
    client = InMemoryFirestoreClient()
    coll = client.collection("anything")
    assert isinstance(coll, CollectionReference)
    assert isinstance(coll.document("doc-1"), DocumentReference)


def test_real_firestore_client_would_satisfy_contract() -> None:
    """The real google client exposes the same surface (collection →
    document/where/order_by/limit/start_after/stream). We don't construct
    it here (no creds), but assert the contract names exist on the SDK
    classes so a SDK upgrade that renames them is caught."""
    from google.cloud.firestore_v1 import CollectionReference as GCollection
    from google.cloud.firestore_v1 import DocumentReference as GDocument

    for name in ("document", "where", "order_by", "limit", "start_after", "stream"):
        assert hasattr(GCollection, name), f"google CollectionReference lost .{name}"
    for name in ("get", "set", "update", "delete"):
        assert hasattr(GDocument, name), f"google DocumentReference lost .{name}"
