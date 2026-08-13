"""Firestore repository for ActivityConfig.

All I/O goes through ``db.firestore`` helpers. The doc id is the
composite ``{teacher_uid}:{class_id}:{activity_id}`` so each
(teacher, class, activity) tuple has exactly one config.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from db.firestore import delete_document, get_document, query_documents, set_document
from db.models.activity_config import (
    ActivityConfig,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    ConceptMapElement,
    Difficulty,
    DocumentElement,
    InteractionStyle,
    Language,
    MaterialRef,
    NoteElement,
    SolutionElement,
    TableElement,
    WorkbenchType,
    WritingElement,
)

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
    title: str = "",
    language: Language = "da",
    difficulty: Difficulty = "standard",
    interaction_style: InteractionStyle = "socratic",
    persona: str | None = None,
    paired_workbench: str | None = None,
    workbench_type: WorkbenchType = "none",
    artefact_id: str | None = None,
    checklist: list[ChecklistItem] | None = None,
    table: list[TableElement] | None = None,
    chart: list[ChartElement] | None = None,
    calculator: list[CalculatorElement] | None = None,
    note: list[NoteElement] | None = None,
    writing: list[WritingElement] | None = None,
    solution: list[SolutionElement] | None = None,
    document: list[DocumentElement] | None = None,
    concept_map: list[ConceptMapElement] | None = None,
    materials: list[MaterialRef] | None = None,
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
        title=title,
        teachingGoal=teaching_goal,
        language=language,
        difficulty=difficulty,
        interactionStyle=interaction_style,
        persona=persona,
        pairedWorkbench=paired_workbench,
        workbenchType=workbench_type,
        artefactId=artefact_id,
        checklist=checklist or [],
        table=table or [],
        chart=chart or [],
        calculator=calculator or [],
        note=note or [],
        writing=writing or [],
        solution=solution or [],
        document=document or [],
        conceptMap=concept_map or [],
        materials=materials or [],
        updatedAt=_utcnow(),
    )
    set_document(_COLLECTION, ActivityConfig.doc_id(teacher_uid, class_id, activity_id), _to_firestore(cfg))
    return cfg


def list_activity_configs(*, teacher_uid: str, class_id: str | None = None) -> list[ActivityConfig]:
    """List a teacher's activity configs, optionally scoped to one class.

    Teacher-scoped by construction (``teacherUid ==``) so it can never
    leak another teacher's activities. Backs ``aiplatform activity list``
    and the teacher builder's activity index (TAA-1 M0.3).
    """
    filters: list[tuple[str, str, Any]] = [("teacherUid", "==", teacher_uid)]
    if class_id:
        filters.append(("classId", "==", class_id))
    return [_from_firestore(data) for data in query_documents(_COLLECTION, filters=filters)]


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
    "list_activity_configs",
    "upsert_activity_config",
]
