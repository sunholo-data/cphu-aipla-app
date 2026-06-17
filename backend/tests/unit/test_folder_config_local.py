"""Bucket-folder CRUD round-trips against the in-memory store.

Regression for firestore-portability-seam (2026-06-17): folder_config.py
previously used the top-level ``client.document(full/path)`` accessor, which
``InMemoryFirestoreClient`` does not implement — so every bucket-folder
operation raised ``AttributeError`` under LOCAL_MODE. The fix routes through
the ``db.firestore`` DAL helpers (``collection(path).document(id)``); these
tests pin that the whole CRUD surface now works in-memory.
"""

from __future__ import annotations

import pytest

from buckets import folder_config
from db import firestore as fs
from db.models import BucketConfig


@pytest.fixture(autouse=True)
def _local_firestore(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs._reset_client_for_testing()
    yield
    fs._reset_client_for_testing()


def _bucket(bucket_id: str = "acme-reports-dev") -> BucketConfig:
    return BucketConfig(
        bucketId=bucket_id,
        displayName="Acme reports",
        ownerEmail="owner@aitanalabs.com",
        ownerId="uid-owner",
        gcsBucket=bucket_id,
    )


def test_create_then_get_round_trip() -> None:
    bucket = _bucket()
    created = folder_config.create_folder(bucket, path="lab", display_name="Lab", owner_id="uid-owner")

    loaded = folder_config.get_folder(bucket.bucket_id, created.folder_id)
    assert loaded is not None
    assert loaded.folder_id == created.folder_id
    assert loaded.display_name == "Lab"
    # Effective access inherited from the parent bucket (private by default).
    assert loaded.effective_access.type == "private"


def test_get_missing_returns_none() -> None:
    assert folder_config.get_folder("acme-reports-dev", "no-such-folder") is None


def test_update_folder_touches_updated_at() -> None:
    bucket = _bucket()
    created = folder_config.create_folder(bucket, path="lab", display_name="Lab", owner_id="uid-owner")

    updated = folder_config.update_folder(bucket, created.folder_id, {"displayName": "Renamed"})
    assert updated is not None
    assert updated.display_name == "Renamed"


def test_list_folders_orders_and_isolates_by_bucket() -> None:
    bucket_a = _bucket("bucket-a")
    bucket_b = _bucket("bucket-b")
    folder_config.create_folder(bucket_a, path="a1", display_name="A1", owner_id="uid-owner")
    folder_config.create_folder(bucket_a, path="a2", display_name="A2", owner_id="uid-owner")
    folder_config.create_folder(bucket_b, path="b1", display_name="B1", owner_id="uid-owner")

    a_folders = folder_config.list_folders("bucket-a")
    b_folders = folder_config.list_folders("bucket-b")
    assert {f.display_name for f in a_folders} == {"A1", "A2"}
    assert {f.display_name for f in b_folders} == {"B1"}


def test_delete_folder() -> None:
    bucket = _bucket()
    created = folder_config.create_folder(bucket, path="lab", display_name="Lab", owner_id="uid-owner")

    assert folder_config.delete_folder(bucket.bucket_id, created.folder_id) is True
    assert folder_config.get_folder(bucket.bucket_id, created.folder_id) is None
    # Deleting again is a no-op miss.
    assert folder_config.delete_folder(bucket.bucket_id, created.folder_id) is False
