"""Tests for the activity backfill (ALS-1 M0.2) — in-memory Firestore."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from db import firestore as fs_module
from db.activities import get_activity, list_activities_by_owner
from db.activity_configs import upsert_activity_config
from db.classes import create_class, get_class
from db.models.class_ import Class
from scripts.backfill_activities import migrated_activity_id, run_backfill

OWNER = "teacher-1"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


def _class(class_id: str, *, lessons: list[str]) -> None:
    now = datetime.now(UTC)
    create_class(
        Class(
            classId=class_id,
            ownerUid=OWNER,
            name=f"Class {class_id}",
            tagNamespace=f"class:{OWNER}:{class_id}",
            lessons=lessons,
            createdAt=now,
            updatedAt=now,
        )
    )


def test_dry_run_writes_nothing():
    upsert_activity_config(teacher_uid=OWNER, class_id="c1", activity_id="boldkast", teaching_goal="G")
    _class("c1", lessons=["boldkast"])
    report = run_backfill(dry_run=True)
    assert report.configs_migrated  # reported as would-migrate
    assert list_activities_by_owner(OWNER) == []  # but nothing actually written


def test_apply_migrates_config_to_activity_and_assigns_to_class():
    upsert_activity_config(
        teacher_uid=OWNER, class_id="c1", activity_id="boldkast", title="Kast", teaching_goal="Find the angle."
    )
    _class("c1", lessons=["boldkast"])
    run_backfill(dry_run=False)

    act_id = migrated_activity_id(f"{OWNER}:c1:boldkast")
    activity = get_activity(act_id)
    assert activity is not None
    assert activity.owner_uid == OWNER
    assert activity.teaching_goal == "Find the angle."
    assert activity.visibility == "private"
    # The class now references the migrated activity.
    assert act_id in get_class("c1").activity_ids


def test_apply_wraps_bare_lesson_with_no_config():
    # A lesson skill id with NO activity_config (a sim added via old "Add from catalogue").
    _class("c2", lessons=["boldkast"])  # no upsert_activity_config for it
    run_backfill(dry_run=False)

    act_id = migrated_activity_id(f"bare:{OWNER}:boldkast")  # deduped per owner+skill
    activity = get_activity(act_id)
    assert activity is not None
    assert act_id in get_class("c2").activity_ids
    # boldkast is a known artefact → carried onto the wrapping activity.
    assert activity.artefact_id == "boldkast"


def test_bare_sim_deduped_across_classes():
    """A sim added to N of a teacher's classes → ONE library activity assigned to
    all N (not N copies)."""
    _class("c1", lessons=["boldkast"])
    _class("c2", lessons=["boldkast"])
    _class("c3", lessons=["boldkast"])
    run_backfill(dry_run=False)

    act_id = migrated_activity_id(f"bare:{OWNER}:boldkast")
    # Exactly ONE boldkast activity in the library...
    boldkast_acts = [a for a in list_activities_by_owner(OWNER) if a.skill_id == "boldkast"]
    assert len(boldkast_acts) == 1 and boldkast_acts[0].activity_id == act_id
    # ...assigned to all three classes.
    for cid in ("c1", "c2", "c3"):
        assert act_id in get_class(cid).activity_ids


def test_teacher_only_skill_skipped(monkeypatch):
    """A teacher-tooling skill (manage-class) is never wrapped as a student activity."""
    import scripts.backfill_activities as bf

    monkeypatch.setattr(bf, "_is_teacher_only_skill", lambda sid: sid == "manage-class")
    _class("c1", lessons=["manage-class", "boldkast"])
    report = run_backfill(dry_run=False)

    titles = {a.skill_id for a in list_activities_by_owner(OWNER)}
    assert "manage-class" not in titles  # not wrapped
    assert "boldkast" in titles  # student sim still wrapped
    assert any("manage-class" in s for s in report.skipped_teacher_only)


def test_backfill_is_idempotent():
    upsert_activity_config(teacher_uid=OWNER, class_id="c1", activity_id="boldkast", teaching_goal="G")
    _class("c1", lessons=["boldkast"])
    run_backfill(dry_run=False)
    first = list_activities_by_owner(OWNER)
    second_report = run_backfill(dry_run=False)
    after = list_activities_by_owner(OWNER)
    assert len(after) == len(first)  # no duplicates on re-run
    assert second_report.skipped_already_migrated  # detected as already-migrated
    # Class assignment stays deduped.
    assert get_class("c1").activity_ids.count(migrated_activity_id(f"{OWNER}:c1:boldkast")) == 1


def test_backfill_is_additive_legacy_config_survives():
    upsert_activity_config(teacher_uid=OWNER, class_id="c1", activity_id="boldkast", teaching_goal="G")
    _class("c1", lessons=["boldkast"])
    run_backfill(dry_run=False)
    # Legacy store untouched — dual-read needs it through cutover.
    from db.activity_configs import get_activity_config

    assert get_activity_config(teacher_uid=OWNER, class_id="c1", activity_id="boldkast") is not None
    assert "boldkast" in get_class("c1").lessons  # lessons not stripped
