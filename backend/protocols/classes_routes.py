"""REST endpoints for the Class collection (1.A teacher-permission-model).

Eight endpoints under ``/api/classes/*`` — CRUD + lessons + group codes
+ soft-delete. Every endpoint gates on ``user.is_teacher`` (set by M3
in the Firebase + LOCAL_MODE auth paths). Ownership is enforced
per-resource: a teacher can only read/write classes whose ``owner_uid``
matches their own.

The PATCH ``/lessons`` endpoint is the cross-collection operation: it
both updates ``Class.lessons`` AND writes the class's ``tag_namespace``
into each affected Skill's ``accessControl.tags`` so the existing 5-type
AccessControl evaluator picks up the binding without any code changes
(axiom 9: ``AccessContext.can_access`` stays untouched).

OTel spans are tagged with ``class_id`` + ``teacher_uid`` so observability
queries can filter teacher operations by class.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict, Field

from analytics.auth import assert_can_read_class
from auth import User, get_current_user
from db.classes import (
    add_lessons,
    create_class,
    get_class,
    list_all_classes,
    list_classes_for_owner,
    mint_group_codes_under_class,
    remove_lessons,
    revoke_class,
    revoke_group_code,
    update_class,
)
from db.firestore import get_document, set_document
from db.group_sessions import archive_session_for_group
from db.models.class_ import Class
from skills import skill_config

log = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)

router = APIRouter(prefix="/api/classes", tags=["classes"])


# ---------------------------------------------------------------------------
# Request / response shapes
# ---------------------------------------------------------------------------


class ClassCreate(BaseModel):
    """Body for ``POST /api/classes``."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ClassUpdate(BaseModel):
    """Body for ``PATCH /api/classes/{class_id}``."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class LessonsPatch(BaseModel):
    """Body for ``PATCH /api/classes/{class_id}/lessons``."""

    add: list[str] = Field(default_factory=list)
    remove: list[str] = Field(default_factory=list)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class GroupsMint(BaseModel):
    """Body for ``POST /api/classes/{class_id}/groups``."""

    count: int = Field(default=1, ge=1, le=50)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# ---------------------------------------------------------------------------
# Guards + helpers
# ---------------------------------------------------------------------------


def _assert_teacher(user: User) -> None:
    """Reject non-teacher callers. Anonymous-group students hit this gate
    when they try to call ``/api/classes/*``."""
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail="teacher access required")


def _load_owned(class_id: str, user: User) -> Class:
    """Load + ownership-check. 404 if not found OR not owned (don't
    leak existence to non-owners). 410 if soft-deleted."""
    cls = get_class(class_id)
    if cls is None or cls.owner_uid != user.uid:
        raise HTTPException(status_code=404, detail="class not found")
    return cls


def _load_readable(class_id: str, user: User) -> Class:
    """Load a class the caller may READ — owner OR researcher (sprint
    1.1.5). Same enumeration-resistant 404 for non-owner non-researcher
    as ``_load_owned``. Researcher reads tag the OTel span via
    ``assert_can_read_class``. Use on READ routes only; write/mint/delete
    keep ``_load_owned``."""
    try:
        assert_can_read_class(user, class_id)
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="class not found") from exc
    cls = get_class(class_id)
    if cls is None:  # pragma: no cover — assert_can_read_class already guards
        raise HTTPException(status_code=404, detail="class not found")
    return cls


def _serialize(cls: Class) -> dict:
    return cls.model_dump(by_alias=True, mode="json")


def _tag_span(class_id: str, teacher_uid: str) -> None:
    """Tag the current OTel span with class identity (axiom 8 — every
    class-routes span carries class_id + teacher_uid for observability
    queries / per-class budget enforcement attribution).

    Records the attributes on the current span without creating a new
    one. Safe to call even when no tracer is configured — returns
    silently if the current span is non-recording.
    """
    span = trace.get_current_span()
    if not span.is_recording():
        return
    span.set_attribute("class_id", class_id)
    span.set_attribute("teacher_uid", teacher_uid)


# ---------------------------------------------------------------------------
# Skill access-control mutation
# ---------------------------------------------------------------------------


def _add_namespace_to_skill_tags(skill_id: str, tag_namespace: str) -> None:
    """Append the class's tag namespace to a Skill's ``accessControl.tags``.

    Idempotent — calling twice produces no duplicates. Only mutates
    skills that are already ``type="tagged"`` or ``type="private"``.
    Public skills are intentionally left alone: they are discoverable by
    all teachers and students via the public evaluator regardless of
    class assignment. Mutating them to ``tagged`` would hide them from
    every teacher who doesn't carry the class tag — the bug that caused
    Boldkast to vanish from the catalogue after the first assignment.

    For class-lesson assignment, ``Class.lessons`` is the authoritative
    record; students receive ``skill_ids`` live-resolved from that list
    at join time. Tag mutation is only needed for teacher-private skills
    that are restricted to specific classes.
    """
    cfg = skill_config.get_skill(skill_id)
    if cfg is None:
        raise HTTPException(status_code=404, detail=f"skill {skill_id} not found")

    if cfg.access_control.type == "public":
        # Public skills stay public. Class assignment is tracked in
        # Class.lessons only; no access-control mutation needed.
        return

    doc = get_document("skills", skill_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"skill {skill_id} not found")

    ac = doc.get("accessControl") or {"type": "tagged", "tags": []}
    existing_tags = list(ac.get("tags") or [])
    if tag_namespace not in existing_tags:
        existing_tags.append(tag_namespace)
    doc["accessControl"] = {"type": "tagged", "tags": existing_tags}
    set_document("skills", skill_id, doc)


def _remove_namespace_from_skill_tags(skill_id: str, tag_namespace: str) -> None:
    """Drop the class's tag namespace from a Skill's ``accessControl.tags``.

    No-op for public skills (they were never tagged in the first place).
    For tagged skills, removes the namespace; if the resulting tags list
    is empty, the skill stays ``type="tagged"`` with an empty list
    (effectively private until re-tagged or reset via the admin endpoint).
    """
    cfg = skill_config.get_skill(skill_id)
    if cfg is None:
        return  # skill already gone — nothing to do

    if cfg.access_control.type == "public":
        return  # public skills were never tagged; nothing to undo

    doc = get_document("skills", skill_id)
    if doc is None:
        return

    ac = doc.get("accessControl") or {}
    existing_tags = list(ac.get("tags") or [])
    if tag_namespace in existing_tags:
        existing_tags.remove(tag_namespace)
        doc["accessControl"] = {"type": "tagged", "tags": existing_tags}
        set_document("skills", skill_id, doc)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("", status_code=201)
async def post_class(
    body: ClassCreate,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Create a class owned by the current teacher."""
    _assert_teacher(user)
    cls = Class.create_for_teacher(
        owner_uid=user.uid,
        name=body.name,
        description=body.description,
    )
    create_class(cls)
    _tag_span(cls.class_id, user.uid)
    log.info("classes_route: created class=%s teacher=%s", cls.class_id, user.uid)
    return _serialize(cls)


@router.get("")
async def list_classes(
    scope: str = Query(default="own"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List classes.

    - ``scope=own`` (default): classes owned by the caller — unchanged.
    - ``scope=all``: every class across all teachers — researcher-only
      (sprint 1.1.5 Research view). Non-researchers get 403 even via a
      URL-hack, never a silent fallback to own-scope.
    """
    _assert_teacher(user)
    if scope == "all":
        if not user.is_researcher:
            raise HTTPException(status_code=403, detail="researcher access required")
        span = trace.get_current_span()
        if span.is_recording():
            span.set_attribute("auth.researcher_bypass", True)
        classes = list_all_classes()
        return {"classes": [_serialize(c) for c in classes], "scope": "all"}
    classes = list_classes_for_owner(user.uid)
    return {"classes": [_serialize(c) for c in classes], "scope": "own"}


@router.get("/{class_id}")
async def get_one(
    class_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Get one class — owner, or any class for a researcher (sprint 1.1.5)."""
    _assert_teacher(user)
    cls = _load_readable(class_id, user)
    _tag_span(class_id, user.uid)
    return _serialize(cls)


@router.patch("/{class_id}")
async def patch_class(
    body: ClassUpdate,
    class_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Update name and/or description of a class."""
    _assert_teacher(user)
    _load_owned(class_id, user)
    update_class(class_id, name=body.name, description=body.description)
    _tag_span(class_id, user.uid)
    reloaded = get_class(class_id)
    if reloaded is None:  # paranoia — update_class shouldn't drop the doc
        raise HTTPException(status_code=500, detail="class disappeared during update")
    return _serialize(reloaded)


@router.delete("/{class_id}")
async def delete_class(
    class_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Soft-delete (idempotent)."""
    _assert_teacher(user)
    _load_owned(class_id, user)
    revoke_class(class_id)
    _tag_span(class_id, user.uid)
    log.info("classes_route: revoked class=%s teacher=%s", class_id, user.uid)
    return {"revoked": True, "classId": class_id}


@router.patch("/{class_id}/lessons")
async def patch_lessons(
    body: LessonsPatch,
    class_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Add and/or remove skills from a class.

    Idempotent on both add and remove. ALSO writes the class's tag
    namespace into each affected ``Skill.accessControl.tags`` so the
    existing tagged-access evaluator picks up the binding.
    """
    _assert_teacher(user)
    cls = _load_owned(class_id, user)

    if body.add:
        for skill_id in body.add:
            _add_namespace_to_skill_tags(skill_id, cls.tag_namespace)
        add_lessons(class_id, body.add)

    if body.remove:
        for skill_id in body.remove:
            _remove_namespace_from_skill_tags(skill_id, cls.tag_namespace)
        remove_lessons(class_id, body.remove)

    _tag_span(class_id, user.uid)
    reloaded = get_class(class_id)
    if reloaded is None:
        raise HTTPException(status_code=500, detail="class disappeared during lessons update")
    return _serialize(reloaded)


@router.post("/{class_id}/groups", status_code=201)
async def post_groups(
    body: GroupsMint,
    class_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Mint N group codes under this class. Returns the freshly-minted codes."""
    _assert_teacher(user)
    _load_owned(class_id, user)
    codes = mint_group_codes_under_class(class_id, count=body.count)
    _tag_span(class_id, user.uid)
    log.info(
        "classes_route: minted %d codes class=%s teacher=%s",
        len(codes),
        class_id,
        user.uid,
    )
    return {"codes": codes, "classId": class_id}


@router.delete("/{class_id}/groups/{code}")
async def delete_group(
    class_id: str = Path(...),
    code: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Revoke a single group code. Idempotent — calling on an already-
    revoked code is a no-op."""
    _assert_teacher(user)
    _load_owned(class_id, user)
    revoke_group_code(class_id, code)
    _tag_span(class_id, user.uid)
    log.info("classes_route: revoked code=%s class=%s teacher=%s", code, class_id, user.uid)
    return {"revoked": True, "code": code, "classId": class_id}


@router.post("/{class_id}/groups/{code}/reset-session", status_code=204)
async def reset_group_session(
    class_id: str = Path(...),
    code: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Archive the active session for a group code so the next join starts fresh.

    Idempotent — calling when no session exists is a no-op. Does NOT
    rotate or revoke the group code itself; students can still rejoin
    with the same code and will receive a blank session.
    """
    _assert_teacher(user)
    cls = _load_owned(class_id, user)
    if code not in cls.group_codes:
        raise HTTPException(status_code=404, detail="group code not found")
    archive_session_for_group(code)
    _tag_span(class_id, user.uid)
    log.info(
        "classes_route: reset session for code=%s class=%s teacher=%s",
        code,
        class_id,
        user.uid,
    )


class RecentSessionRow(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    session_id: str = Field(alias="sessionId")
    owner_uid: str = Field(alias="ownerUid")
    skill_id: str = Field(alias="skillId")
    group_code: str | None = Field(default=None, alias="groupCode")
    last_message_at: str = Field(alias="lastMessageAt")
    turn_count: int = Field(alias="turnCount")
    title: str | None = None


class RecentSessionsResponse(BaseModel):
    sessions: list[RecentSessionRow]


@router.get("/{class_id}/recent-sessions", response_model=RecentSessionsResponse)
async def list_class_recent_sessions(
    class_id: str = Path(...),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),  # noqa: B008
) -> RecentSessionsResponse:
    """List recent student sessions across all group codes in a class.

    Returns the newest sessions (by lastMessageAt) for any group code
    that belongs to this class. Owner — or a researcher reading any
    class (sprint 1.1.5).
    """
    _assert_teacher(user)
    cls = _load_readable(class_id, user)
    _tag_span(class_id, user.uid)

    from db.chat_sessions import list_sessions_for_group_codes

    sessions = list_sessions_for_group_codes(list(cls.group_codes), page_size=page_size)
    rows = [
        RecentSessionRow(
            sessionId=s.session_id,
            ownerUid=s.owner_uid,
            skillId=s.skill_id,
            groupCode=s.group_code,
            lastMessageAt=s.last_message_at.isoformat(),
            turnCount=s.turn_count,
            title=s.title,
        )
        for s in sessions
    ]
    return RecentSessionsResponse(sessions=rows)


__all__ = ["router"]
