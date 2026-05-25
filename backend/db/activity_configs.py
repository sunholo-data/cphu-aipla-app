"""Firestore repository for ActivityConfig.

All I/O goes through ``db.firestore`` helpers. The doc id is the
composite ``{teacher_uid}:{class_id}:{activity_id}`` so each
(teacher, class, activity) tuple has exactly one config.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, set_document
from db.models.activity_config import ActivityConfig, Difficulty, Language

logger = logging.getLogger(__name__)

_COLLECTION = "activity_configs"


def _utcnow() -> datetime:
    return datetime.now(UTC)


def _to_firestore(cfg: ActivityConfig) -> dict[str, Any]:
    """Pydantic → Firestore dict (camelCase keys, ISO timestamps)."""
    return cfg.model_dump(by_alias=True, mode="json")


def _from_firestore(data: dict[str, Any]) -> ActivityConfig:
    """Firestore dict → Pydantic. Accepts both alias and snake_case."""
    return ActivityConfig.model_validate(data)


def upsert_activity_config(
    *,
    teacher_uid: str,
    class_id: str,
    activity_id: str,
    teaching_goal: str,
    language: Language = "da",
    difficulty: Difficulty = "standard",
    paired_workbench: str | None = None,
) -> ActivityConfig:
    """Create or overwrite the activity config for this (teacher, class, activity).

    Idempotent: the doc id is deterministic, so re-saving updates in
    place. ``updated_at`` is bumped on every write so callers can sort
    or diff against a previous version.
    """
    cfg = ActivityConfig(
        activityId=activity_id,
        classId=class_id,
        teacherUid=teacher_uid,
        teachingGoal=teaching_goal,
        language=language,
        difficulty=difficulty,
        pairedWorkbench=paired_workbench,
        updatedAt=_utcnow(),
    )
    set_document(_COLLECTION, ActivityConfig.doc_id(teacher_uid, class_id, activity_id), _to_firestore(cfg))
    return cfg


def get_activity_config(*, teacher_uid: str, class_id: str, activity_id: str) -> ActivityConfig | None:
    """Return the config or ``None`` if no config has been saved yet.

    Used at agent instantiation: a missing config substitutes the empty
    string for ``{teacher_focus}`` so the trailing prompt block becomes
    a no-op rather than an error.
    """
    data = get_document(_COLLECTION, ActivityConfig.doc_id(teacher_uid, class_id, activity_id))
    return _from_firestore(data) if data is not None else None


def delete_activity_config(*, teacher_uid: str, class_id: str, activity_id: str) -> None:
    """Hard delete. No soft-delete here — teaching goals are cheap to re-enter."""
    delete_document(_COLLECTION, ActivityConfig.doc_id(teacher_uid, class_id, activity_id))


__all__ = [
    "delete_activity_config",
    "get_activity_config",
    "upsert_activity_config",
]
