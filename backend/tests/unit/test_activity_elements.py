"""Activity element registry — 1.1.38 M0.

The registry (``ELEMENT_REGISTRY``) is the single source of truth for which
teacher-authorable element kinds exist and their bounds. These tests pin the
two M0 guarantees: the registry is internally consistent, and the per-kind cap
is enforced on ``ActivityConfig`` (without changing checklist behaviour).
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from db.models.activity_config import (
    ELEMENT_REGISTRY,
    ActivityConfig,
    ChecklistItem,
)


def _config(**overrides: object) -> ActivityConfig:
    base: dict[str, object] = {
        "activityId": "act-1",
        "classId": "class-1",
        "teacherUid": "teacher-1",
        "updatedAt": datetime.now(UTC),
    }
    base.update(overrides)
    return ActivityConfig(**base)  # type: ignore[arg-type]


def _checklist(n: int) -> list[ChecklistItem]:
    return [ChecklistItem(id=f"s{i}", label=f"step {i}") for i in range(n)]


def test_registry_specs_are_internally_consistent() -> None:
    for kind, spec in ELEMENT_REGISTRY.items():
        assert spec.kind == kind, "registry key must match spec.kind"
        assert spec.render in ("workspace", "inline")
        assert spec.max_items > 0
        # every registered element's storage field must exist on ActivityConfig
        assert spec.field in ActivityConfig.model_fields, f"{spec.field} missing on ActivityConfig"


def test_checklist_is_a_registered_workspace_element() -> None:
    spec = ELEMENT_REGISTRY["checklist"]
    assert spec.field == "checklist"
    assert spec.render == "workspace"


def test_checklist_within_cap_roundtrips() -> None:
    cfg = _config(checklist=_checklist(5))
    assert len(cfg.checklist) == 5


def test_checklist_at_cap_is_allowed() -> None:
    cap = ELEMENT_REGISTRY["checklist"].max_items
    cfg = _config(checklist=_checklist(cap))
    assert len(cfg.checklist) == cap


def test_checklist_over_cap_is_rejected() -> None:
    cap = ELEMENT_REGISTRY["checklist"].max_items
    with pytest.raises(ValidationError):
        _config(checklist=_checklist(cap + 1))
