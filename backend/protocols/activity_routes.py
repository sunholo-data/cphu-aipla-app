"""Activity REST endpoints (ALS-1 M0/M1) — the class-independent activity library.

The activity-era replacement for the per-class ``activity_config_routes``. An
``Activity`` is owned by a teacher, minted ``act-…``, and assigned to classes via
``Class.activity_ids`` (many-to-many). Distinct ids per activity are what removed
the overwrite collision.

Endpoints (all teacher-auth; owner-only for read/write of a specific activity):
  POST   /api/activities            create (mint act-); optional classId auto-assigns
  GET    /api/activities?owner=me   the caller's library
  GET    /api/activities/{id}       load one (owner-only)
  PATCH  /api/activities/{id}       edit (owner-only, full payload)
  DELETE /api/activities/{id}       soft-delete (owner-only)

Cross-teacher publish/adopt + researcher CRUD are M3/M3b — not here.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field

from artefacts.loader import is_known_artefact
from auth import User, get_current_user
from db.activities import (
    create_activity,
    get_activity,
    list_activities_by_owner,
    save_activity,
    soft_delete_activity,
)
from db.classes import add_activities, get_class
from db.models.activity import Activity, Visibility
from db.models.activity_config import (
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

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/activities", tags=["activities"])


class ActivityUpsert(BaseModel):
    """Body for ``POST /api/activities`` and ``PATCH /api/activities/{id}``.

    ``skill_id`` is the skill the activity runs (concept-dialogue for a concept
    activity; the sim's skill for a sim). ``class_id`` on POST is a convenience —
    the activity is created AND assigned to that class in one call (the builder
    always creates within a class). Omit it to create an unassigned library activity.
    """

    skill_id: str = Field(default="", alias="skillId", max_length=128)
    class_id: str | None = Field(default=None, alias="classId", max_length=128)
    title: str = Field(default="", max_length=200)
    teaching_goal: str = Field(default="", alias="teachingGoal", max_length=2000)
    language: Language = "da"
    difficulty: Difficulty = "standard"
    interaction_style: InteractionStyle | None = Field(default=None, alias="interactionStyle")
    persona: str | None = Field(default=None, max_length=64)
    workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
    artefact_id: str | None = Field(default=None, alias="artefactId", max_length=64)
    checklist: list[ChecklistItem] = Field(default_factory=list)
    table: list[TableElement] = Field(default_factory=list)
    chart: list[ChartElement] = Field(default_factory=list)
    calculator: list[CalculatorElement] = Field(default_factory=list)
    note: list[NoteElement] = Field(default_factory=list)
    solution: list[SolutionElement] = Field(default_factory=list)
    document: list[DocumentElement] = Field(default_factory=list)
    materials: list[MaterialRef] = Field(default_factory=list)
    visibility: Visibility = "private"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _assert_teacher(user: User) -> None:
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail="teacher access required")


def _assert_known_artefact(artefact_id: str | None) -> None:
    if artefact_id and not is_known_artefact(artefact_id):
        raise HTTPException(status_code=400, detail=f"unknown artefact: {artefact_id}")


def _load_owned(activity_id: str, user: User) -> Activity:
    """Load + ownership-check. 404 if missing OR not owned (don't leak existence)."""
    activity = get_activity(activity_id)
    if activity is None or activity.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="activity not found")
    return activity


def _serialize(activity: Activity) -> dict:
    return activity.model_dump(by_alias=True, mode="json")


def _activity_from_body(body: ActivityUpsert, *, owner_uid: str, activity_id: str = "") -> Activity:
    return Activity(
        activityId=activity_id,
        skillId=body.skill_id,
        ownerUid=owner_uid,
        title=body.title,
        teachingGoal=body.teaching_goal,
        language=body.language,
        difficulty=body.difficulty,
        interactionStyle=body.interaction_style,
        persona=body.persona,
        workbenchType=body.workbench_type,
        artefactId=body.artefact_id,
        checklist=body.checklist,
        table=body.table,
        chart=body.chart,
        calculator=body.calculator,
        note=body.note,
        solution=body.solution,
        document=body.document,
        materials=body.materials,
        visibility=body.visibility,
    )


@router.post("", status_code=201)
async def post_activity(
    body: ActivityUpsert,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Create a new activity (mints a fresh ``act-…`` id — never collides).

    When ``classId`` is given, the activity is also assigned to that class (the
    builder's create-within-a-class flow), after an owner check on the class.
    """
    _assert_teacher(user)
    _assert_known_artefact(body.artefact_id)
    activity = create_activity(_activity_from_body(body, owner_uid=user.uid))
    if body.class_id:
        cls = get_class(body.class_id)
        if cls is None or cls.owner_uid != user.uid:
            raise HTTPException(status_code=404, detail="class not found")
        add_activities(body.class_id, [activity.activity_id])
    log.info("activity created id=%s owner=%s class=%s", activity.activity_id, user.uid, body.class_id or "-")
    return _serialize(activity)


@router.get("")
async def list_my_activities(
    owner: str = Query(default="me"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> list[dict]:
    """The caller's activity library. ``?owner=me`` (the only mode in M1) — the
    cross-teacher ``?published=true`` catalogue is M3."""
    _assert_teacher(user)
    if owner != "me":
        raise HTTPException(status_code=400, detail="only owner=me is supported (published catalogue is M3)")
    return [_serialize(a) for a in list_activities_by_owner(user.uid)]


@router.get("/{activity_id}")
async def get_activity_route(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Load one activity for editing (owner-only)."""
    _assert_teacher(user)
    return _serialize(_load_owned(activity_id, user))


@router.patch("/{activity_id}")
async def patch_activity(
    body: ActivityUpsert,
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Edit an activity (owner-only). Full payload — same shape as create.

    Preserves immutable identity (id, owner, provenance, created_at) and overwrites
    the editable content + visibility.
    """
    _assert_teacher(user)
    existing = _load_owned(activity_id, user)
    _assert_known_artefact(body.artefact_id)
    updated = _activity_from_body(body, owner_uid=user.uid, activity_id=activity_id).model_copy(
        update={
            "created_at": existing.created_at,
            "source_activity_id": existing.source_activity_id,
            "source_owner_uid": existing.source_owner_uid,
        }
    )
    return _serialize(save_activity(updated))


@router.delete("/{activity_id}", status_code=204)
async def delete_activity_route(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Soft-delete (owner-only). Idempotent."""
    _assert_teacher(user)
    _load_owned(activity_id, user)
    soft_delete_activity(activity_id)
    return None
