"""Persona catalogue endpoints (1.1.12).

Read-only list of the YAML-defined personas a teacher can pick. A persona
bundles a name + title + avatar + interaction_style + voice; the activity
builder uses it to set the tied configs.

**TUTOR-2 M3 adds the custom (Firestore) layer** — the "v1.2 follow-up" this
docstring promised. A teacher gives a tutor a face and a voice by authoring a
persona; the avatar is CHOSEN from the set the project ships, never uploaded,
so there is no user-generated student-facing imagery and no moderation policy
to write.
"""

from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

from adk.interaction_style import list_interaction_styles
from auth import User, get_current_user
from auth.guards import assert_teacher
from db.custom_personas import (
    delete_custom_persona,
    get_custom_persona,
    list_custom_personas,
    make_persona_id,
    save_custom_persona,
    set_persona_visibility,
)
from db.models import SkillVoiceConfig
from db.models.activity_config import InteractionStyle
from db.models.persona import Persona
from personas.loader import DEFAULT_PERSONA_ID, allowed_avatars, load_persona, load_personas
from protocols.authorship import author_emails_for, authorship_fields

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/personas", tags=["personas"])


def _serialize(p: Persona) -> dict:
    return p.model_dump(by_alias=True, mode="json")


@router.get("")
async def list_personas_route(
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List the available personas (YAML catalogue).

    ``defaultId`` is the global fallback persona id (``DEFAULT_PERSONA_ID``) so
    the picker can badge it as the default instead of synthesising a separate
    "Default" entry — a class with no explicit persona inherits this one.

    ``interactionStyles`` carries the actual instruction each teaching style
    enforces (the injected preamble, or the baked-in default for socratic), so
    the picker can show a teacher *exactly* what a persona's style does to the
    tutor — the single source of truth, not a duplicated paraphrase.
    """
    return {
        "personas": [_serialize(p) for p in load_personas()],
        "defaultId": DEFAULT_PERSONA_ID or None,
        "interactionStyles": list_interaction_styles(),
    }


@router.get("/{persona_id}")
async def get_persona_route(
    persona_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Fetch one persona by id; 404 if absent."""
    p = load_persona(persona_id)
    if p is None:
        raise HTTPException(status_code=404, detail="persona not found")
    return _serialize(p)


# ── custom personas (TUTOR-2 M3) ─────────────────────────────────────────────


class CustomPersonaBody(BaseModel):
    """A persona as the client sends it.

    ``authorUid`` and ``visibility`` are deliberately absent: the first comes
    from the verified token, and the second changes only through its own
    endpoint — an edit that could change who sees a thing is an edit that shares
    it by accident.
    """

    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    title: str | None = Field(default=None, max_length=120)
    avatar: str = Field(default="", max_length=400)
    language: str = Field(default="da", max_length=16)
    interaction_style: InteractionStyle = Field(default="socratic", alias="interactionStyle")
    voice: SkillVoiceConfig | None = None
    voice_prompt: str | None = Field(default=None, alias="voicePrompt", max_length=600)
    bio: str | None = Field(default=None, max_length=500)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class PersonaVisibilityBody(BaseModel):
    visibility: Literal["private", "shared"]

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


def _may_edit(p: Persona, user: User) -> bool:
    """Owner, or a researcher — and never a YAML persona, which has no row."""
    if p.source != "firestore":
        return False
    return bool(user.is_researcher or (p.author_uid and p.author_uid == user.uid))


def _custom_row(p: Persona, user: User, emails: dict[str, str] | None = None) -> dict:
    """A custom persona as THIS viewer may see it (1.1.150): ``canEdit`` and
    ``isOwn`` side by side, because a researcher may edit every persona and the
    UI must not read that as "you made it"."""
    return {**_serialize(p), "canEdit": _may_edit(p, user), **authorship_fields(p.author_uid, user, emails)}


async def _one_row(p: Persona, user: User) -> dict:
    return _custom_row(p, user, await author_emails_for(user, [p.author_uid]))


def _role(user: User) -> str:
    return "researcher" if user.is_researcher else "teacher"


@router.get("/custom/list")
async def list_custom_personas_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """The custom personas this caller may see, with ``canEdit`` per row.

    ⚠️ Declared with two segments, so it cannot be swallowed by the
    ``/{persona_id}`` catch-all above — the trap ``frameworks_routes`` documents
    at length, where ``/crossview`` answered "404 not found" for a route that
    existed.
    """
    assert_teacher(user)
    if user.is_researcher:
        log.info("personas: unfiltered custom read by researcher uid=%s", user.uid)
    rows = list_custom_personas(user.uid, see_all=user.is_researcher)
    emails = await author_emails_for(user, (p.author_uid for p in rows))
    return {
        "personas": [_custom_row(p, user, emails) for p in rows],
        # The set a picker may offer. Sent with the list so the client never
        # has to hold its own copy of what is allowed.
        "avatars": sorted(allowed_avatars()),
    }


@router.post("/custom")
async def create_custom_persona_route(
    body: CustomPersonaBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Author a persona. Any teacher may."""
    assert_teacher(user)
    persona_id = body.id or make_persona_id(body.name)
    if get_custom_persona(persona_id) is not None:
        raise HTTPException(status_code=409, detail=f"a persona named {body.name!r} already exists")
    persona = Persona.model_validate(
        {**body.model_dump(by_alias=True, exclude={"id"}), "id": persona_id, "source": "firestore"}
    )
    try:
        saved = save_custom_persona(
            persona,
            author_uid=user.uid,
            allowed_avatars=set(allowed_avatars()),
            author_role=_role(user),
            created_via="ui",
        )
    except ValueError as exc:
        # The avatar is chosen from a shipped set, and the STORE enforces it —
        # a UI-only rule is one fetch away from being bypassed.
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await _one_row(saved, user)


@router.put("/custom/{persona_id}")
async def update_custom_persona_route(
    body: CustomPersonaBody,
    persona_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_teacher(user)
    existing = get_custom_persona(persona_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="persona not found")
    if not _may_edit(existing, user):
        raise HTTPException(status_code=403, detail="this persona belongs to someone else")
    persona = Persona.model_validate(
        {**body.model_dump(by_alias=True, exclude={"id"}), "id": persona_id, "source": "firestore"}
    )
    try:
        saved = save_custom_persona(
            persona,
            author_uid=user.uid,
            allowed_avatars=set(allowed_avatars()),
            author_role=_role(user),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await _one_row(saved, user)


@router.put("/custom/{persona_id}/visibility")
async def set_custom_persona_visibility_route(
    body: PersonaVisibilityBody,
    persona_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    assert_teacher(user)
    existing = get_custom_persona(persona_id)
    if existing is None or not _may_edit(existing, user):
        raise HTTPException(status_code=404, detail="persona not found")
    saved = set_persona_visibility(persona_id, body.visibility)
    return await _one_row(saved, user) if saved else {}


@router.delete("/custom/{persona_id}", status_code=204)
async def delete_custom_persona_route(
    persona_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    assert_teacher(user)
    existing = get_custom_persona(persona_id)
    if existing is None or not _may_edit(existing, user):
        raise HTTPException(status_code=404, detail="persona not found")
    delete_custom_persona(persona_id)
    log.info("personas: custom %s deleted by %s", persona_id, user.uid)
