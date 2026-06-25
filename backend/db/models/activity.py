"""Activity — the owned, class-independent activity definition (ALS-1 M0).

Promotes the per-``(teacher, class, activity)`` ``ActivityConfig`` row to a
first-class, class-independent resource (``activity-library-sharing.md`` M0). An
activity is **owned** by a teacher, minted with an ``act-…`` id, and **assigned**
to zero or more of the owner's classes (``Class.activity_ids``).

The running skill is **resolved from content** (artefact → that sim's skill; else
the base ``concept-dialogue`` skill), NOT stored — so one activity id maps to one
instance-configured skill, which is exactly what lets a class hold *many* concept
activities (distinct activity ids, same underlying skill). That resolution lives
in ``adk/teacher_focus.py`` (M0.3); this module is just the owned content + the
ownership / sharing envelope.

Content fields mirror ``ActivityConfig`` verbatim (minus ``class_id`` /
``teacher_uid``) so the builder payload and the ``{teacher_focus}`` composition are
unchanged — only the identity, ownership, and sharing envelope is new.
"""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from db.models.activity_config import (
    ELEMENT_REGISTRY,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    Difficulty,
    DocumentElement,
    InteractionStyle,
    Language,
    MaterialRef,
    NoteElement,
    SolutionElement,
    TableElement,
    WorkbenchType,
)

# draft  — owner-only, not student-facing (the builder's "Save draft"; M3 surfaces it).
# private — finished, assignable to the owner's classes, students run it. NOT shared.
# published — finished AND listed in the cross-teacher catalogue (M3 — no setter yet).
Visibility = Literal["draft", "private", "published"]

_ID_PREFIX = "act-"


def mint_activity_id() -> str:
    """Mint a fresh library activity id (``act-…``).

    Distinct from any skill id by construction (the ``act-`` prefix), so an
    activity id can never collide with the shared ``concept-dialogue`` skill id —
    the root cause of the overwrite bug this entity removes.
    """
    return f"{_ID_PREFIX}{secrets.token_hex(8)}"


class Activity(BaseModel):
    """Firestore document at ``activities/{activity_id}``.

    camelCased in Firestore (consistent with the rest of the v6 store); the model
    accepts either casing via ``populate_by_name=True``.
    """

    activity_id: str = Field(alias="activityId", max_length=128)
    owner_uid: str = Field(alias="ownerUid")
    # The skill this activity RUNS (the "running skill"). For a concept activity
    # it's the concept-dialogue skill id; for a sim it's the sim's skill id. The
    # design doc derives this from content; we record it instead — both the create
    # flow and the backfill already know it (a legacy config's activity_id IS the
    # skill id, by the old welding), and storing it avoids a fragile backend
    # name→id + artefact→skill derivation. Many activities may share one skill_id
    # (distinct activity_ids), which is exactly what lets a class hold many concept
    # activities. Empty only for a not-yet-resolved draft.
    skill_id: str = Field(default="", alias="skillId", max_length=128)
    title: str = Field(default="", max_length=200)
    teaching_goal: str = Field(default="", alias="teachingGoal", max_length=2000)
    language: Language = "da"
    difficulty: Difficulty = "standard"
    interaction_style: InteractionStyle | None = Field(default=None, alias="interactionStyle")
    persona: str | None = Field(default=None, max_length=64)
    workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
    # The vetted sim artefact this activity hosts (1.1.41). Resolved to its skill at
    # student-instantiation time (M0.3); sets workbench_type=app via the validator.
    artefact_id: str | None = Field(default=None, alias="artefactId", max_length=64)
    checklist: list[ChecklistItem] = Field(default_factory=list)
    table: list[TableElement] = Field(default_factory=list)
    chart: list[ChartElement] = Field(default_factory=list)
    calculator: list[CalculatorElement] = Field(default_factory=list)
    note: list[NoteElement] = Field(default_factory=list)
    solution: list[SolutionElement] = Field(default_factory=list)
    document: list[DocumentElement] = Field(default_factory=list)
    materials: list[MaterialRef] = Field(default_factory=list)
    # Sharing envelope. Default ``private`` (not ``draft``): today's builder has no
    # separate publish step, so a created+assigned activity is immediately
    # student-facing — preserving the current "create → live" behaviour. ``draft``
    # is an explicit future opt-in; ``published`` has no setter until M3.
    visibility: Visibility = "private"
    # Provenance for duplicate / adopt (1.1.19 M3 / M2 here). Nullable until set.
    source_activity_id: str | None = Field(default=None, alias="sourceActivityId", max_length=128)
    source_owner_uid: str | None = Field(default=None, alias="sourceOwnerUid")
    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")
    deleted_at: datetime | None = Field(default=None, alias="deletedAt")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _backfill_workbench_type(self) -> Activity:
        """An activity hosting a sim implies an ``app`` workbench (mirrors
        ``ActivityConfig``). An explicitly chosen type is never overridden."""
        if self.workbench_type == "none" and self.artefact_id:
            self.workbench_type = "app"
        return self

    @model_validator(mode="after")
    def _enforce_element_caps(self) -> Activity:
        """Reject configs whose element lists exceed the registry cap (1.1.38) —
        ``ELEMENT_REGISTRY`` is the single source of element bounds."""
        for spec in ELEMENT_REGISTRY.values():
            value = getattr(self, spec.field, None)
            if isinstance(value, list) and len(value) > spec.max_items:
                raise ValueError(f"{spec.field} has {len(value)} items, exceeds the maximum of {spec.max_items}")
        return self

    @property
    def owner_id(self) -> str:
        """Satisfies the ``_HasAccess`` protocol used by the ownership helpers."""
        return self.owner_uid


__all__ = ["Activity", "Visibility", "mint_activity_id"]
