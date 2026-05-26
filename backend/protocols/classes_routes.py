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

from fastapi import APIRouter, Depends, HTTPException, Path
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict, Field

from auth import User, get_current_user
from db.classes import (
    add_lessons,
    create_class,
    get_class,
    list_classes_for_owner,
    mint_group_codes_under_class,
    remove_lessons,
    revoke_class,
    revoke_group_code,
    update_class,
)
from db.firestore import get_document, set_document
from db.models.class_ import Class

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

    Idempotent — calling twice produces no duplicates. Switches the
    skill's access_control to ``type="tagged"`` if it was something
    else (e.g. ``public``) — that's how we restrict a previously-public
    skill to a specific class. The reverse (a skill that's truly meant
    to stay public) shouldn't be added to a class's lessons in the
    first place.
    """
    doc = get_document("skills", skill_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"skill {skill_id} not found")

    ac = doc.get("accessControl") or {"type": "public"}
    existing_tags = list(ac.get("tags") or [])
    if tag_namespace not in existing_tags:
        existing_tags.append(tag_namespace)
    new_ac = {
        "type": "tagged",
        "tags": existing_tags,
    }
    # Preserve any domain / emails fields (Pydantic AccessControl serialises them
    # with exclude_none=True so missing keys stay missing).
    doc["accessControl"] = new_ac
    set_document("skills", skill_id, doc)


def _remove_namespace_from_skill_tags(skill_id: str, tag_namespace: str) -> None:
    """Drop the class's tag namespace from a Skill's ``accessControl.tags``.

    If the resulting tags list is empty, leaves ``type="tagged"`` with
    an empty tags list — the skill becomes effectively inaccessible
    until re-tagged. Operators wanting to revert a skill to ``public``
    do so explicitly via the skills route.
    """
    doc = get_document("skills", skill_id)
    if doc is None:
        return  # skill already gone — nothing to do

    ac = doc.get("accessControl") or {}
    existing_tags = list(ac.get("tags") or [])
    if tag_namespace in existing_tags:
        existing_tags.remove(tag_namespace)
        doc["accessControl"] = {
            "type": "tagged",
            "tags": existing_tags,
        }
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
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List classes owned by the current teacher."""
    _assert_teacher(user)
    classes = list_classes_for_owner(user.uid)
    return {"classes": [_serialize(c) for c in classes]}


@router.get("/{class_id}")
async def get_one(
    class_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Get one class — owner-only."""
    _assert_teacher(user)
    cls = _load_owned(class_id, user)
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


__all__ = ["router"]
