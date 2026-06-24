"""Repo tests for db.activities (ALS-1 M0.1) — in-memory Firestore round-trips."""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.activities import (
    create_activity,
    get_activity,
    list_activities_by_owner,
    save_activity,
    soft_delete_activity,
)
from db.models.activity import Activity

OWNER = "teacher-1"
OTHER = "teacher-other"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def test_create_mints_id_and_stamps_timestamps():
    a = create_activity(Activity(activityId="", ownerUid=OWNER, title="A"))
    assert a.activity_id.startswith("act-")
    assert a.created_at is not None and a.updated_at is not None
    fetched = get_activity(a.activity_id)
    assert fetched is not None and fetched.title == "A"


def test_create_honours_explicit_id():
    a = create_activity(Activity(activityId="act-explicit", ownerUid=OWNER))
    assert a.activity_id == "act-explicit"


def test_save_preserves_created_at_bumps_updated_at():
    a = create_activity(Activity(activityId="act-1", ownerUid=OWNER, title="v1"))
    created = a.created_at
    edited = save_activity(a.model_copy(update={"title": "v2"}))
    assert edited.title == "v2"
    assert edited.created_at == created  # preserved
    assert edited.updated_at >= a.updated_at  # bumped (monotonic)
    assert get_activity("act-1").title == "v2"


def test_list_by_owner_is_scoped_and_excludes_deleted():
    create_activity(Activity(activityId="act-mine-1", ownerUid=OWNER, title="m1"))
    create_activity(Activity(activityId="act-mine-2", ownerUid=OWNER, title="m2"))
    create_activity(Activity(activityId="act-theirs", ownerUid=OTHER, title="t"))
    mine = list_activities_by_owner(OWNER)
    assert {a.activity_id for a in mine} == {"act-mine-1", "act-mine-2"}  # never leaks OTHER

    soft_delete_activity("act-mine-1")
    after = list_activities_by_owner(OWNER)
    assert {a.activity_id for a in after} == {"act-mine-2"}
    assert list_activities_by_owner(OWNER, include_deleted=True)  # still retrievable when asked


def test_get_hides_soft_deleted_by_default():
    create_activity(Activity(activityId="act-del", ownerUid=OWNER))
    soft_delete_activity("act-del")
    assert get_activity("act-del") is None
    assert get_activity("act-del", include_deleted=True) is not None


def test_get_missing_returns_none():
    assert get_activity("act-nope") is None
