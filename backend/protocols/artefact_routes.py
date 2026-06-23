"""Artefact catalogue endpoints (1.1.41).

Read-only list of the vetted MCP-App artefacts (simulations) a teacher can
attach to an activity (the "marketplace" backing store). The artefact-intrinsic
``tutorBlock`` is **never** returned — it is server-side only, used for prompt
composition (M2). Mirrors the persona catalogue endpoints (1.1.12).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from artefacts.loader import load_artefact, load_artefacts
from auth import User, get_current_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/artefacts", tags=["artefacts"])


@router.get("")
async def list_artefacts_route(
    status: str | None = Query(default=None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List the artefact catalogue (public view — never the ``tutorBlock``).

    Optional ``status`` filter (e.g. ``live``) so the builder picker can show
    only pilot-visible artefacts.
    """
    items = load_artefacts()
    if status:
        items = [a for a in items if a.status == status]
    return {"artefacts": [a.public() for a in items]}


@router.get("/{artefact_id}")
async def get_artefact_route(
    artefact_id: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Fetch one artefact's public view by id; 404 if absent."""
    a = load_artefact(artefact_id)
    if a is None:
        raise HTTPException(status_code=404, detail="artefact not found")
    return a.public()
