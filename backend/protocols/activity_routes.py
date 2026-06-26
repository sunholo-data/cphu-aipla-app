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
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict, Field

from artefacts.loader import is_known_artefact
from auth import User, get_current_user
from auth.owner_labels import resolve_owner_labels
from db.activities import (
    copy_activity,
    create_activity,
    get_activity,
    list_activities_by_owner,
    list_all_activities,
    list_published_activities,
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


def _load_for_modify(activity_id: str, user: User) -> Activity:
    """Load for a write op (publish/unpublish, and — M3b — patch/delete).

    Allowed for the **owner** OR a **researcher** (the post-hoc moderation
    bypass, ALS-SHARE M3b). Otherwise 404 (enumeration-resistant). When a
    researcher reaches another teacher's activity, span it like the class
    read-bypass so the elevated access is observable.
    """
    activity = get_activity(activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="activity not found")
    if activity.owner_uid != user.uid:
        if not user.is_researcher:
            raise HTTPException(status_code=404, detail="activity not found")
        span = trace.get_current_span()
        if span.is_recording():
            span.set_attribute("auth.researcher_bypass", True)
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


def _serialize_with_owner_labels(activities: list[Activity]) -> list[dict]:
    """Serialize + enrich each row with a friendly ``ownerLabel`` (display name /
    email) so cross-owner views don't show raw Firebase uids. Best-effort:
    unresolved owners carry no label and the client falls back to the uid."""
    labels = resolve_owner_labels({a.owner_uid for a in activities})
    rows: list[dict] = []
    for a in activities:
        row = _serialize(a)
        label = labels.get(a.owner_uid)
        if label:
            row["ownerLabel"] = label
        rows.append(row)
    return rows


@router.get("")
async def list_my_activities(
    owner: str = Query(default="me"),
    scope: str = Query(default="own"),
    published: bool = Query(default=False),
    user: User = Depends(get_current_user),  # noqa: B008
) -> list[dict]:
    """List activities.

    - ``scope=own`` (default, ``?owner=me``): the caller's own library.
    - ``?published=true``: the cross-teacher **shared catalogue** — every
      teacher's ``published`` activities, owner-labelled for by-owner grouping
      (ALS-SHARE M3.2). Open to **any** teacher (publish is the share gate);
      read-only — adopt is the only cross-teacher write.
    - ``scope=all``: every activity across all teachers — **researcher-only**
      (1.1.5 Research view, mirroring ``GET /api/classes?scope=all``).
      Non-researchers get 403 even via a URL-hack, never a silent fallback.

    ``published`` and ``scope=all`` are deliberately different gates.
    """
    _assert_teacher(user)
    if published:
        log.info("activities shared catalogue (published=true) uid=%s", user.uid)
        return _serialize_with_owner_labels(list_published_activities())
    if scope == "all":
        if not user.is_researcher:
            raise HTTPException(status_code=403, detail="researcher access required")
        log.info("activities research view (scope=all) uid=%s", user.uid)
        return _serialize_with_owner_labels(list_all_activities())
    if owner != "me":
        raise HTTPException(status_code=400, detail="only owner=me, scope=all, or published=true are supported")
    return [_serialize(a) for a in list_activities_by_owner(user.uid)]


@router.get("/{activity_id}")
async def get_activity_route(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Load one activity for editing. Owner — or a researcher (M3b moderation).

    For an adopted activity (``source_owner_uid`` set), enrich the payload with a
    friendly ``sourceOwnerLabel`` so the History panel can read 'Adapted from
    {name}' (M-HIST). Best-effort: an unresolved source owner carries no label
    and the client falls back to the raw uid.
    """
    _assert_teacher(user)
    activity = _load_for_modify(activity_id, user)
    row = _serialize(activity)
    if activity.source_owner_uid:
        label = resolve_owner_labels({activity.source_owner_uid}).get(activity.source_owner_uid)
        if label:
            row["sourceOwnerLabel"] = label
    return row


@router.patch("/{activity_id}")
async def patch_activity(
    body: ActivityUpsert,
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Edit an activity. Owner — or a **researcher** (ALS-SHARE M3b moderation).
    Full payload — same shape as create.

    Preserves immutable identity (id, **owner**, provenance, created_at) and
    overwrites the editable content. Ownership is taken from the EXISTING
    activity, not the caller — so a researcher edit never silently reassigns it.

    **Visibility is NOT edited here** — the card's status control owns it
    (ALS-SHARE-UX). The save preserves the existing state, except it promotes a
    freshly-copied ``draft`` to ``private`` (saving = "I've reviewed this copy,
    it's mine now"). This stops a save from silently *unpublishing* a shared
    activity, which the old "take visibility from the body (default private)"
    path did on every edit.
    """
    _assert_teacher(user)
    existing = _load_for_modify(activity_id, user)
    _assert_known_artefact(body.artefact_id)
    preserved_visibility: Visibility = "private" if existing.visibility == "draft" else existing.visibility
    updated = _activity_from_body(body, owner_uid=existing.owner_uid, activity_id=activity_id).model_copy(
        update={
            "created_at": existing.created_at,
            "source_activity_id": existing.source_activity_id,
            "source_owner_uid": existing.source_owner_uid,
            "visibility": preserved_visibility,
        }
    )
    return _serialize(save_activity(updated))


@router.delete("/{activity_id}", status_code=204)
async def delete_activity_route(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Soft-delete. Owner — or a researcher (M3b moderation). Idempotent."""
    _assert_teacher(user)
    _load_for_modify(activity_id, user)
    soft_delete_activity(activity_id)
    return None


@router.post("/{activity_id}/duplicate", status_code=201)
async def duplicate_activity_route(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Duplicate an activity into the caller's library (ALS-SHARE M2).

    "Edit on top of an existing one": copies the source into a fresh ``draft``
    owned by the caller, with ``source_*`` provenance and NO class assignment.
    The source must be the caller's **own** OR ``published`` (a colleague's
    private/draft is invisible) — else 404, enumeration-resistant.
    """
    _assert_teacher(user)
    source = get_activity(activity_id)
    if source is None or (source.owner_uid != user.uid and source.visibility != "published"):
        raise HTTPException(status_code=404, detail="Activity not found")
    copy = copy_activity(source, new_owner_uid=user.uid)
    log.info("activity duplicated src=%s -> %s owner=%s", activity_id, copy.activity_id, user.uid)
    return _serialize(copy)


@router.post("/{activity_id}/adopt", status_code=201)
async def adopt_activity_route(
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Adopt a **published** activity from the shared catalogue → a fresh ``draft``
    copy in the caller's library (ALS-SHARE M3.3). Copy semantics: provenance is
    recorded (``source_*``); the source teacher's later edits never mutate this
    copy, and the caller can only edit their copy. A non-published source (even
    one the caller doesn't own) is 404 — adopt is for the catalogue only.
    """
    _assert_teacher(user)
    source = get_activity(activity_id)
    if source is None or source.visibility != "published":
        raise HTTPException(status_code=404, detail="Activity not found")
    copy = copy_activity(source, new_owner_uid=user.uid)
    log.info("activity adopted src=%s owner=%s -> %s by=%s", activity_id, source.owner_uid, copy.activity_id, user.uid)
    return _serialize(copy)


def _set_visibility(activity: Activity, visibility: Visibility) -> dict:
    """Persist a visibility change, preserving all other fields. Unpublish never
    touches copies others already adopted — those are independent activities."""
    return _serialize(save_activity(activity.model_copy(update={"visibility": visibility})))


class VisibilitySet(BaseModel):
    """Body for the unified visibility setter — the teacher card's status control
    sends the target state directly (ALS-SHARE-UX M1).

    Only ``private`` and ``published`` are user-settable. **``draft`` is not** — it
    is a system state set on copy/adopt and cleared by review-and-save (the PATCH
    promotes draft→private). Selecting draft for a reviewed activity has no
    meaning and would be a back-door around "review before use", so the literal
    rejects it (422)."""

    visibility: Literal["private", "published"]


@router.post("/{activity_id}/visibility", status_code=200)
async def set_visibility_route(
    body: VisibilitySet,
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Set an activity's visibility to ``private`` or ``published`` — the single
    setter behind the card's status control (ALS-SHARE-UX M1), replacing the
    binary publish/unpublish pair. ``draft`` is not settable here (system state;
    422). Owner or researcher (shared ``_load_for_modify`` guard). Unpublishing
    (→ private) never touches copies others already adopted; those are
    independent activities."""
    _assert_teacher(user)
    activity = _load_for_modify(activity_id, user)
    log.info(
        "activity visibility set id=%s -> %s owner=%s by=%s",
        activity_id,
        body.visibility,
        activity.owner_uid,
        user.uid,
    )
    return _set_visibility(activity, body.visibility)
