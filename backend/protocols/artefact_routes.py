"""Artefact catalogue endpoints (1.1.41).

Read-only list of the vetted MCP-App artefacts (simulations) a teacher can
attach to an activity (the "marketplace" backing store). The artefact-intrinsic
``tutorBlock`` is **never** returned — it is server-side only, used for prompt
composition (M2). Mirrors the persona catalogue endpoints (1.1.12).
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response

from artefacts.loader import library_artefacts, load_artefact, load_artefacts
from artefacts.screenshots import SHOTS, screenshot_png
from auth import User, get_current_user

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/artefacts", tags=["artefacts"])

# The homepage gallery: no sign-in. Only the library (what /mcp already serves to
# anyone), and only what a visitor needs to recognise a sim: never the tutorBlock,
# the commands, the assessment scale or who wrote it.
public_router = APIRouter(prefix="/api/public/sims", tags=["artefacts"])

_GALLERY_FIELDS = ("id", "displayName", "description", "topics", "levels", "language", "source")


@router.get("")
async def list_artefacts_route(
    status: str | None = Query(default=None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """List the artefact catalogue (public view — never the ``tutorBlock``).

    Optional ``status`` filter (e.g. ``live``) so the builder picker can show
    only pilot-visible artefacts.
    """
    items = load_artefacts(for_uid=user.uid)
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


@router.get("/{artefact_id}/screenshot/{shot}")
async def artefact_screenshot_route(
    artefact_id: str = Path(..., pattern=r"^[a-z0-9-]{1,64}$"),
    shot: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """A screenshot of a catalogued sim (``700`` at rest, ``driven`` after use):
    the picker's thumbnail. Any signed-in user, like the sim's own preview; 404
    when the sim or that shot does not exist."""
    if shot not in SHOTS:
        raise HTTPException(status_code=404, detail="no such screenshot")
    meta = await asyncio.to_thread(load_artefact, artefact_id)
    png = await asyncio.to_thread(screenshot_png, meta, shot) if meta else None
    if png is None:
        raise HTTPException(status_code=404, detail="no screenshot for this sim")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


def _gallery_entry(meta) -> dict:
    view = meta.public()
    return {k: view.get(k) for k in _GALLERY_FIELDS}


@public_router.get("")
async def list_public_sims_route() -> dict:
    """The sim library for the public homepage gallery (no auth)."""
    items = await asyncio.to_thread(library_artefacts)
    return {"sims": [_gallery_entry(m) for m in items]}


@public_router.get("/{artefact_id}/screenshot/{shot}")
async def public_sim_screenshot_route(
    artefact_id: str = Path(..., pattern=r"^[a-z0-9-]{1,64}$"),
    shot: str = Path(...),
) -> Response:
    """A library sim's screenshot, for anyone; 404 for a class-level teacher sim,
    exactly as for one that does not exist."""
    if shot not in SHOTS:
        raise HTTPException(status_code=404, detail="no such screenshot")
    library = await asyncio.to_thread(library_artefacts)
    meta = next((m for m in library if m.id == artefact_id), None)
    png = await asyncio.to_thread(screenshot_png, meta, shot) if meta else None
    if png is None:
        raise HTTPException(status_code=404, detail="no screenshot for this sim")
    return Response(content=png, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})
