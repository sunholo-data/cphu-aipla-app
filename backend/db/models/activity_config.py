"""ActivityConfig — per-teacher, per-class, per-activity configuration.

Stores the teaching goal that gets injected into a skill's system prompt
at agent-instantiation time via the ``{teacher_focus}`` placeholder. See
``adk/teacher_focus.py`` for the wrapper that performs the substitution.

The doc id is the composite ``{teacher_uid}:{class_id}:{activity_id}`` so
each (teacher, class, activity) tuple has exactly one config row — saves
a query when the agent boots up.

Phase 2 scope (1.G-Ph2): LOCAL_MODE teacher stub owns one seeded demo
class. Firebase teacher auth + multi-class ownership land in Phase 3
(1.G-Ph3) — the access-control field is wired here so the swap is a
no-op in routes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Language = Literal["da", "en"]
Difficulty = Literal["standard", "guided"]

# Tutor interaction style (1.1.20). ``socratic`` is the default and the
# untouched current behaviour (no preamble injected — the SKILL.md rule
# stands). The other styles inject an override preamble that changes the
# tutor's voice for this activity. See ``adk/interaction_style.py``.
InteractionStyle = Literal["socratic", "concise", "rigorous", "warm"]


class ChecklistItem(BaseModel):
    """One teacher-authored, student-tickable sub-step of an activity (M1).

    Generalises the Boldkast a/b/c/d sub-parts: ``id`` is the stable slug
    used as the storage key (must survive reloads); ``label`` is the
    display text. Mirrors the frontend ``ChecklistItem`` in
    ``ProgressChecklist.tsx``.
    """

    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=200)

    model_config = ConfigDict(populate_by_name=True)


# Workbench type system (1.J expanded-workbench-types). ``none`` is a
# first-class, no-simulator activity (chat-only Socratic dialogue, the
# v1.1 teacher-authoring headline). ``app`` is a paired MCP-App sim.
WorkbenchType = Literal["app", "drawing", "sensor", "video", "notebook", "none"]


class ActivityConfig(BaseModel):
    """Firestore document at ``activity_configs/{teacher_uid}:{class_id}:{activity_id}``.

    All fields are camelCased in Firestore (consistent with the rest of
    the v6 store). The Pydantic model accepts either casing because
    ``populate_by_name=True``.
    """

    activity_id: str = Field(alias="activityId")
    class_id: str = Field(alias="classId")
    teacher_uid: str = Field(alias="teacherUid")
    title: str = Field(default="", alias="title", max_length=200)
    teaching_goal: str = Field(default="", alias="teachingGoal", max_length=2000)
    language: Language = "da"
    difficulty: Difficulty = "standard"
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    paired_workbench: str | None = Field(default=None, alias="pairedWorkbench")
    workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
    source_activity_id: str | None = Field(default=None, alias="sourceActivityId")
    checklist: list[ChecklistItem] = Field(default_factory=list)
    updated_at: datetime = Field(alias="updatedAt")

    model_config = ConfigDict(populate_by_name=True)

    @model_validator(mode="after")
    def _backfill_workbench_type(self) -> ActivityConfig:
        """Legacy rows (written before TAA-1) have ``paired_workbench`` set
        but no ``workbench_type``. Resolve those to ``app`` so a Boldkast /
        LED-Planck / KineBot config keeps rendering its sim. An explicitly
        chosen type is never overridden.
        """
        if self.workbench_type == "none" and self.paired_workbench:
            self.workbench_type = "app"
        return self

    @staticmethod
    def doc_id(teacher_uid: str, class_id: str, activity_id: str) -> str:
        """Composite Firestore document id."""
        return f"{teacher_uid}:{class_id}:{activity_id}"

    @property
    def owner_id(self) -> str:
        """Satisfies the ``_HasAccess`` protocol used elsewhere."""
        return self.teacher_uid


__all__ = [
    "ActivityConfig",
    "ChecklistItem",
    "Difficulty",
    "InteractionStyle",
    "Language",
    "WorkbenchType",
]
