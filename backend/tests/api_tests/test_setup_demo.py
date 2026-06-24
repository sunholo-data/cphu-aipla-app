"""Test the demo seed (scripts/setup_demo) — in-memory Firestore."""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.activities import create_activity, list_activities_by_owner
from db.classes import list_classes_for_owner
from db.firestore import get_document, set_document
from db.models.activity import Activity
from scripts.setup_demo import DEMO_CODE, DEMO_TEACHER, run


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    # The demo code must already exist (created standalone), unbound.
    set_document("anon_groups", DEMO_CODE, {"group_id": DEMO_CODE, "skill_ids": [], "revoked": False})
    yield
    fs_module._reset_client_for_testing()


def test_seeds_demo_class_with_distinct_activities_and_binds_code():
    # Two teachers; the same sim under both (a duplicate) + a unique one.
    create_activity(Activity(activityId="act-bk-t1", skillId="boldkast", title="Boldkast", ownerUid="teacher-1"))
    create_activity(Activity(activityId="act-bk-t2", skillId="boldkast", title="Boldkast", ownerUid="teacher-2"))
    create_activity(Activity(activityId="act-led", skillId="led", title="LED", ownerUid="teacher-1"))

    report = run(dry_run=False)

    # Distinct-by-title: ONE Boldkast + ONE LED (the duplicate collapsed).
    demo_lib = list_activities_by_owner(DEMO_TEACHER)
    titles = sorted(a.title for a in demo_lib)
    assert titles == ["Boldkast", "LED"]
    assert report["demo_activities"] == 2

    # A Demo class exists, owned by the demo teacher, with both assigned.
    demo = [c for c in list_classes_for_owner(DEMO_TEACHER) if c.name == "Demo class"]
    assert len(demo) == 1
    assert len(demo[0].activity_ids) == 2

    # The demo code is bound to the class + recorded on it.
    assert get_document("anon_groups", DEMO_CODE)["classId"] == demo[0].class_id
    assert DEMO_CODE in demo[0].group_codes
    # Copies record provenance.
    assert all(a.source_activity_id for a in demo_lib)


def test_is_idempotent():
    create_activity(Activity(activityId="act-x", skillId="s", title="X", ownerUid="teacher-1"))
    run(dry_run=False)
    run(dry_run=False)
    demo = [c for c in list_classes_for_owner(DEMO_TEACHER) if c.name == "Demo class"]
    assert len(demo) == 1  # one class, not two
    assert len(list_activities_by_owner(DEMO_TEACHER)) == 1  # one copy, not two
