"""Structural contract for the Firestore client surface v6 depends on.

This Protocol pins the *exact* duck-typed surface that the data-access layer
(`db/firestore.py` and the per-collection modules under `db/`) programs
against. Three implementations satisfy it:

  - ``google.cloud.firestore.Client``                  (production)
  - ``db.firestore_inmemory.InMemoryFirestoreClient``  (LOCAL_MODE + tests)
  - a future ``PostgresFirestoreClient``               (UCPH self-host — see
    docs/design/aipla/v2.0.0-handover/firestore-portability-seam.md)

Keeping the contract explicit is the cheap half of the on-prem migration:
the Postgres adapter becomes a typed checklist rather than a
reverse-engineering exercise, and any ``db/`` code that reaches for a
Firestore feature *outside* this surface (transactions, ``on_snapshot``,
collection-group queries — none of which v6 uses) stands out as
non-portable.

Argument types are intentionally permissive (``Any`` for filters, values,
and snapshots) so the Protocol structurally matches the real google SDK
without importing its concrete types. The surface mirrors the docstring
contract at the top of ``db/firestore_inmemory.py``.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class DocumentSnapshot(Protocol):
    """Result of ``DocumentReference.get()`` / a row from ``Query.stream()``."""

    id: str
    exists: bool

    def to_dict(self) -> dict[str, Any] | None: ...


@runtime_checkable
class DocumentReference(Protocol):
    """A handle to a single document."""

    id: str

    def get(self) -> DocumentSnapshot: ...
    def set(self, data: dict[str, Any], merge: bool = ...) -> Any: ...
    def update(self, data: dict[str, Any]) -> Any: ...
    def delete(self) -> Any: ...


@runtime_checkable
class Query(Protocol):
    """A composable, immutable query — each method returns a new Query."""

    def where(self, *, filter: Any = ...) -> Query: ...
    def order_by(self, field: str, direction: Any = ...) -> Query: ...
    def limit(self, count: int) -> Query: ...
    def start_after(self, snapshot: Any) -> Query: ...
    def stream(self) -> Iterable[DocumentSnapshot]: ...


@runtime_checkable
class CollectionReference(Query, Protocol):
    """A collection: a Query with no constraints yet, plus ``.document()``."""

    def document(self, doc_id: str | None = ...) -> DocumentReference: ...


@runtime_checkable
class FirestoreClient(Protocol):
    """The client surface. ``.collection(path)`` accepts multi-segment
    subcollection paths (e.g. ``buckets/{id}/folders``); v6 never uses a
    top-level ``.document(path)`` accessor, so it is deliberately absent
    from the contract (the in-memory client does not implement it)."""

    def collection(self, name: str) -> CollectionReference: ...


__all__ = [
    "CollectionReference",
    "DocumentReference",
    "DocumentSnapshot",
    "FirestoreClient",
    "Query",
]
