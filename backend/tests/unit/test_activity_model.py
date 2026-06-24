"""Unit tests for the class-independent Activity model (ALS-1 M0.1)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from db.models.activity import Activity, mint_activity_id


def test_mint_activity_id_is_prefixed_and_unique():
    ids = {mint_activity_id() for _ in range(200)}
    assert len(ids) == 200  # no collisions
    assert all(i.startswith("act-") for i in ids)
    # An act- id can never equal a skill id (the overwrite-bug root cause).
    assert not any(i == "concept-dialogue" or ":" in i for i in ids)


def test_minimal_activity_defaults():
    a = Activity(activityId="act-abc", ownerUid="teacher-1")
    assert a.activity_id == "act-abc"
    assert a.owner_uid == "teacher-1"
    assert a.visibility == "private"  # student-facing by default (no separate publish step yet)
    assert a.workbench_type == "none"
    assert a.checklist == [] and a.materials == []
    assert a.source_activity_id is None


def test_artefact_implies_app_workbench():
    a = Activity(activityId="act-1", ownerUid="t", artefactId="boldkast")
    assert a.workbench_type == "app"


def test_explicit_workbench_type_not_overridden():
    a = Activity(activityId="act-1", ownerUid="t", artefactId="boldkast", workbenchType="document")
    assert a.workbench_type == "document"


def test_element_cap_enforced():
    with pytest.raises(ValidationError):
        Activity(
            activityId="act-1",
            ownerUid="t",
            solution=[{"id": "s1", "prompt": "a"}, {"id": "s2", "prompt": "b"}],  # cap is 1
        )


def test_round_trips_through_camel_alias():
    a = Activity(
        activityId="act-xyz",
        ownerUid="teacher-9",
        title="Energibevarelse",
        teachingGoal="Explore energy conservation.",
        visibility="draft",
        sourceActivityId="act-src",
        sourceOwnerUid="teacher-other",
    )
    dumped = a.model_dump(by_alias=True, mode="json")
    assert dumped["activityId"] == "act-xyz"
    assert dumped["sourceOwnerUid"] == "teacher-other"
    again = Activity.model_validate(dumped)
    assert again.title == "Energibevarelse"
    assert again.source_activity_id == "act-src"
