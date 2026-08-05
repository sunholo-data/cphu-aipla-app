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
from auth import assert_teacher as _assert_teacher
from auth.owner_labels import resolve_owner_labels
from db.activities import (
    apply_activity_filters,
    copy_activity,
    create_activity,
    facets_for_activities,
    get_activity,
    inherited_facets_for,
    list_activities_by_owner,
    list_all_activities,
    list_published_activities,
    save_activity,
    soft_delete_activity,
)
from db.classes import add_activities, get_class
from db.curriculum import list_curriculum_for_teacher
from db.models.activity import Activity, Visibility
from db.models.activity_config import (
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
)
from db.models.curriculum import CurriculumDoc
from db.models.taxonomy import MAX_SUBJECT_LEN, StxLevel, normalize_tags

log = logging.getLogger(__name__)

# Page size for the activity library. Matches the curriculum browse cap so the
# two libraries paginate identically.
_MAX_LIMIT = 200
_DEFAULT_LIMIT = 50

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
    concept_map: list[ConceptMapElement] = Field(default_factory=list, alias="conceptMap")
    materials: list[MaterialRef] = Field(default_factory=list)
    # 1.1.61 — the teacher's own facets. Optional, so an existing client that
    # omits them is unchanged; but note this body is a FULL REPLACE, so a client
    # that renders these and then omits them on save will clear them. That is the
    # documented full-overwrite footgun — `useActivityBuilder.elementPayload()`
    # carries all three, with a test pinning it.
    tags: list[str] = Field(default_factory=list)
    subject: str | None = Field(default=None, max_length=MAX_SUBJECT_LEN)
    level: StxLevel | None = None
    visibility: Visibility = "private"

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


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


def _serialize(activity: Activity, inherited: dict[str, dict[str, set[str]]] | None = None) -> dict:
    row = activity.model_dump(by_alias=True, mode="json")
    if inherited is not None:
        # 1.1.61 — what this activity gets from the documents it cites, kept
        # SEPARATE from its own tags/subject/level rather than merged. The client
        # renders these visibly as inherited (dimmed, paperclip) so "why is this
        # tagged Mekanik?" is answerable without opening the activity, and so an
        # override is never mistaken for an inheritance.
        facets = inherited.get(activity.activity_id, {"subjects": set(), "levels": set(), "tags": set()})
        row["inheritedSubjects"] = sorted(facets["subjects"])
        row["inheritedLevels"] = sorted(facets["levels"])
        row["inheritedTags"] = sorted(facets["tags"])
    return row


def _visible_docs_for(user: User, *, cross_teacher: bool) -> dict[str, CurriculumDoc]:
    """The documents THIS CALLER can see, keyed by id — the input to inheritance.

    ``cross_teacher`` (the shared catalogue and the researcher scan) restricts to
    the SHARED corpus. Without that, an activity published by teacher A would
    advertise the tags of A's private upload to teacher B, who cannot see the
    document those tags came from. Resolving against the caller rather than the
    owner is what makes the leak structurally impossible instead of merely
    unlikely.

    Cheap: the shared corpus is a process-global TTL cache (db.curriculum), so
    this is the same read the Materials browse already performs.
    """
    scope = "shared" if cross_teacher else None
    return {d.doc_id: d for d in list_curriculum_for_teacher(user.uid, scope=scope)}


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
        conceptMap=body.concept_map,
        materials=body.materials,
        tags=body.tags,
        subject=body.subject,
        level=body.level,
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


def _serialize_with_owner_labels(
    activities: list[Activity], inherited: dict[str, dict[str, set[str]]] | None = None
) -> list[dict]:
    """Serialize + enrich each row with a friendly ``ownerLabel`` (display name /
    email) so cross-owner views don't show raw Firebase uids. Best-effort:
    unresolved owners carry no label and the client falls back to the uid."""
    labels = resolve_owner_labels({a.owner_uid for a in activities})
    rows: list[dict] = []
    for a in activities:
        row = _serialize(a, inherited)
        label = labels.get(a.owner_uid)
        if label:
            row["ownerLabel"] = label
        rows.append(row)
    return rows


def _select_activities(
    user: User,
    *,
    owner: str,
    scope: str,
    published: bool,
) -> tuple[list[Activity], bool]:
    """Resolve which activity set this request is about, applying the ACL gates.

    Returns ``(activities, cross_teacher)``. ``cross_teacher`` drives the
    inheritance scope: cross-teacher views resolve citations against the SHARED
    corpus only. Shared by the list and facets endpoints so the two can never
    disagree about who may see what.
    """
    _assert_teacher(user)
    if published:
        log.info("activities shared catalogue (published=true) uid=%s", user.uid)
        return list_published_activities(), True
    if scope == "all":
        if not user.is_researcher:
            raise HTTPException(status_code=403, detail="researcher access required")
        log.info("activities research view (scope=all) uid=%s", user.uid)
        return list_all_activities(), True
    if owner != "me":
        raise HTTPException(status_code=400, detail="only owner=me, scope=all, or published=true are supported")
    return list_activities_by_owner(user.uid), False


@router.get("/facets")
async def activity_facets(
    owner: str = Query(default="me"),
    scope: str = Query(default="own"),
    published: bool = Query(default=False),
    level: Literal["A", "B", "C", "__unlevelled__"] | None = None,
    subject: str | None = None,
    tags: list[str] | None = Query(default=None),  # noqa: B008
    q: str | None = None,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Facet options + narrowed counts for the activity library (1.1.61).

    Twin of ``GET /api/curriculum/facets``, same semantics: options come from the
    whole visible set, counts from the set filtered by every facet except the one
    being counted.

    MUST stay declared above ``/{activity_id}`` — FastAPI matches in order, and
    below it this route would be swallowed as an activity called "facets".
    """
    activities, cross_teacher = _select_activities(user, owner=owner, scope=scope, published=published)
    inherited = inherited_facets_for(activities, _visible_docs_for(user, cross_teacher=cross_teacher))
    return facets_for_activities(activities, inherited, level=level, subject=subject, tags=tags, q=q)


@router.get("")
async def list_my_activities(
    owner: str = Query(default="me"),
    scope: str = Query(default="own"),
    published: bool = Query(default=False),
    # 1.1.61 — the same facet params the curriculum browse takes.
    level: Literal["A", "B", "C", "__unlevelled__"] | None = None,
    subject: str | None = None,
    tags: list[str] | None = Query(default=None),  # noqa: B008
    q: str | None = None,
    limit: int = Query(default=_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List activities, filtered and paginated.

    - ``scope=own`` (default, ``?owner=me``): the caller's own library.
    - ``?published=true``: the cross-teacher **shared catalogue** — every
      teacher's ``published`` activities, owner-labelled for by-owner grouping
      (ALS-SHARE M3.2). Open to **any** teacher (publish is the share gate);
      read-only — adopt is the only cross-teacher write.
    - ``scope=all``: every activity across all teachers — **researcher-only**
      (1.1.5 Research view, mirroring ``GET /api/classes?scope=all``).
      Non-researchers get 403 even via a URL-hack, never a silent fallback.

    ``published`` and ``scope=all`` are deliberately different gates.

    1.1.61 changed the response from a bare list to
    ``{activities, total, limit, offset}`` — ``total`` is the full match count so
    the client can show "X of Y", and the list is a page of it.
    """
    activities, cross_teacher = _select_activities(user, owner=owner, scope=scope, published=published)
    inherited = inherited_facets_for(activities, _visible_docs_for(user, cross_teacher=cross_teacher))
    matched = apply_activity_filters(activities, inherited, level=level, subject=subject, tags=tags, q=q)
    page = matched[offset : offset + limit]
    rows = _serialize_with_owner_labels(page, inherited) if cross_teacher else [_serialize(a, inherited) for a in page]
    return {"activities": rows, "total": len(matched), "limit": limit, "offset": offset}


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


class _FacetPatch(BaseModel):
    """Partial facet edit — deliberately NOT the full ``ActivityUpsert`` (1.1.61).

    The library row is where a teacher files an activity, and that row holds only
    a summary: no elements, no materials. Routing this through the full-replace
    PATCH would mean the client sends an activity body it does not have, and a
    tag edit from the list would silently wipe every element. That is the
    documented full-overwrite footgun, and the fix here is to not offer the gun —
    this endpoint can only touch the three facet fields.

    Mirrors ``_DocPatch`` on the curriculum side, including the add/remove pair so
    a chip toggle is one request and cannot clobber a concurrent edit's tags.
    """

    tags: list[str] | None = None
    add_tags: list[str] | None = Field(default=None, alias="addTags")
    remove_tags: list[str] | None = Field(default=None, alias="removeTags")
    subject: str | None = Field(default=None, max_length=MAX_SUBJECT_LEN)
    level: StxLevel | None = None
    # Explicit clears — `null` is indistinguishable from "not sent" in JSON, so a
    # teacher un-setting a subject needs a way to say so.
    clear_subject: bool = Field(default=False, alias="clearSubject")
    clear_level: bool = Field(default=False, alias="clearLevel")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


@router.patch("/{activity_id}/facets")
async def patch_activity_facets(
    body: _FacetPatch,
    activity_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Set/clear an activity's OWN tags, subject and level (1.1.61).

    Only ever touches those three fields — see ``_FacetPatch``. Inherited facets
    are not editable here (or anywhere): they belong to the cited documents, and
    the way to change them is to re-file the document, or cite a different one.
    """
    _assert_teacher(user)
    existing = _load_for_modify(activity_id, user)

    tags = list(existing.tags) if body.tags is None else list(body.tags)
    if body.add_tags:
        tags += list(body.add_tags)
    if body.remove_tags:
        drop = set(normalize_tags(body.remove_tags))
        tags = [t for t in normalize_tags(tags) if t not in drop]

    subject = existing.subject if body.subject is None else body.subject
    if body.clear_subject:
        subject = None
    level = existing.level if body.level is None else body.level
    if body.clear_level:
        level = None

    # Activity's validator canonicalises tags/subject on construction.
    updated = existing.model_copy(update={"tags": tags, "subject": subject, "level": level})
    updated = Activity.model_validate(updated.model_dump(by_alias=True, mode="json"))
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
