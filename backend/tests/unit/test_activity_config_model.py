"""Unit tests for the ActivityConfig model extensions (TAA-1 M0.1).

Covers the new fields added for teacher activity authoring:
``workbench_type`` (incl. the legacy ``paired_workbench`` -> ``app``
backfill), ``title``, and ``source_activity_id``.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from db.models.activity_config import ActivityConfig

_TS = datetime(2026, 6, 8, tzinfo=UTC)


def _cfg(**overrides) -> ActivityConfig:
    base = {
        "activityId": "concept-energy",
        "classId": "7b-physics-a-2026",
        "teacherUid": "teacher-1",
        "updatedAt": _TS,
    }
    base.update(overrides)
    return ActivityConfig(**base)


def test_new_fields_have_sensible_defaults():
    cfg = _cfg()
    assert cfg.workbench_type == "none"
    assert cfg.title == ""
    assert cfg.source_activity_id is None


def test_round_trip_camelcase_aliases():
    cfg = _cfg(title="Energibevarelse 7B", workbenchType="notebook", sourceActivityId="teacher:abc123")
    dumped = cfg.model_dump(by_alias=True, mode="json")
    assert dumped["workbenchType"] == "notebook"
    assert dumped["title"] == "Energibevarelse 7B"
    assert dumped["sourceActivityId"] == "teacher:abc123"
    # Re-validate the dumped wire shape — round-trips without loss.
    assert ActivityConfig.model_validate(dumped) == cfg


def test_legacy_dict_without_new_fields_back_compat():
    """A row written before this sprint (no workbenchType/title/source) loads cleanly."""
    legacy = {
        "activityId": "concept-energy",
        "classId": "7b-physics-a-2026",
        "teacherUid": "teacher-1",
        "teachingGoal": "Discover energy conservation.",
        "language": "da",
        "difficulty": "standard",
        "updatedAt": _TS.isoformat(),
    }
    cfg = ActivityConfig.model_validate(legacy)
    assert cfg.workbench_type == "none"
    assert cfg.title == ""
    assert cfg.source_activity_id is None


def test_paired_workbench_backfills_to_app():
    """Legacy sim rows have pairedWorkbench but no workbenchType -> resolve to 'app'."""
    cfg = ActivityConfig.model_validate(
        {
            "activityId": "boldkast",
            "classId": "7b-physics-a-2026",
            "teacherUid": "teacher-1",
            "pairedWorkbench": "boldkast-simulator-v1",
            "updatedAt": _TS.isoformat(),
        }
    )
    assert cfg.workbench_type == "app"


def test_explicit_workbench_type_is_not_overridden_by_backfill():
    cfg = _cfg(pairedWorkbench="some-workbench", workbenchType="notebook")
    assert cfg.workbench_type == "notebook"


def test_no_paired_workbench_stays_none():
    cfg = _cfg(pairedWorkbench=None)
    assert cfg.workbench_type == "none"


def test_invalid_workbench_type_rejected():
    with pytest.raises(ValidationError):
        _cfg(workbenchType="banana")
