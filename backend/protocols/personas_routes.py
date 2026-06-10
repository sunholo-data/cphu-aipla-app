"""Persona catalogue endpoints (1.1.12).

Read-only list of the YAML-defined personas a teacher can pick. A persona
bundles a name + title + avatar + interaction_style + voice; the activity
builder uses it to set the tied configs. Custom (Firestore) personas are a
v1.2 follow-up.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path

from auth import User, get_current_user
from db.models.persona import Persona
from personas.loader import load_persona, load_personas

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/personas", tags=["personas"])


def _serialize(p: Persona) -> dict:
    return p.model_dump(by_alias=True, mode="json")


@router.get("")
async def list_personas_route(
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List the available personas (YAML catalogue)."""
    return {"personas": [_serialize(p) for p in load_personas()]}


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
