"""A teacher's sim drafts from the sim-author skill (in-app-sim-authoring M4).

Teacher-only and owner-only: a draft that is not the caller's answers 404, never
403, so the routes cannot be used to probe for other teachers' drafts.

The draft HTML is **never rendered on the app origin.** Downloads go out as
attachments with ``nosniff`` and a ``sandbox`` CSP, so a browser that opened one
directly could not run it here. Running a draft is the sim-verify service's job
(and, later, the sandbox's, on its own origin, under ADR-013 as amended for
teacher sims).
"""

from __future__ import annotations

import asyncio
import base64
import re

from fastapi import APIRouter, Depends, HTTPException, Path
from fastapi.responses import Response

from auth import User, get_current_user
from auth.guards import assert_teacher
from db import sim_drafts

router = APIRouter(prefix="/api/sim-drafts", tags=["sim-drafts"])

_SHOTS = {"390", "700", "driven"}
_DOWNLOAD_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, no-store",
}


def _owner(user: User) -> str:
    assert_teacher(user)
    from auth.features import SIM_WORKSHOP, has_feature

    if not has_feature(user, SIM_WORKSHOP):
        raise HTTPException(status_code=403, detail={"error": "feature_not_enabled", "feature": SIM_WORKSHOP})
    return user.uid


def _version_or_404(draft_id: str, version: int, uid: str) -> dict:
    try:
        doc = sim_drafts.get_version(draft_id, version, uid)
    except ValueError:
        doc = None
    if doc is None:
        raise HTTPException(status_code=404, detail="draft version not found")
    return doc


@router.get("")
async def list_drafts_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """The caller's drafts, newest first: id, title, latest version and level."""
    uid = _owner(user)
    rows = await asyncio.to_thread(sim_drafts.list_drafts, uid)
    keep = ("title", "latestVersion", "latestLevel", "artefactId", "createdAt", "updatedAt")
    return {"drafts": [{"id": r["__id"], **{k: r.get(k) for k in keep}} for r in rows]}


@router.get("/{draft_id}")
async def get_draft_route(draft_id: str = Path(...), user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """One draft and a summary of each version (no HTML, no images)."""
    uid = _owner(user)
    try:
        draft = await asyncio.to_thread(sim_drafts.get_draft, draft_id, uid)
    except ValueError:
        draft = None
    if draft is None:
        raise HTTPException(status_code=404, detail="draft not found")
    versions = []
    for n in range(1, int(draft.get("latestVersion") or 0) + 1):
        v = await asyncio.to_thread(sim_drafts.get_version, draft_id, n, uid)
        if v:
            versions.append(
                {
                    "version": n,
                    "level": v.get("level"),
                    "reasons": v.get("reasons", []),
                    "createdAt": v.get("createdAt"),
                    "screenshots": sorted((v.get("screenshots") or {}).keys()),
                }
            )
    return {"id": draft_id, "title": draft.get("title"), "artefactId": draft.get("artefactId"), "versions": versions}


@router.get("/{draft_id}/versions/{version}/screenshot/{shot}")
async def screenshot_route(
    draft_id: str = Path(...),
    version: int = Path(..., ge=1),
    shot: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """A version's screenshot (PNG): ``390``, ``700`` or ``driven``."""
    uid = _owner(user)
    if shot not in _SHOTS:
        raise HTTPException(status_code=404, detail="no such screenshot")
    doc = await asyncio.to_thread(_version_or_404, draft_id, version, uid)
    b64 = (doc.get("screenshots") or {}).get(shot)
    if not b64:
        raise HTTPException(status_code=404, detail="no such screenshot")
    return Response(
        base64.b64decode(b64),
        media_type="image/png",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"},
    )


@router.get("/{draft_id}/versions/{version}/files/{name}")
async def download_route(
    draft_id: str = Path(...),
    version: int = Path(..., ge=1),
    name: str = Path(...),
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """Download a version's ``index.html`` or ``catalogue.yaml`` as an attachment."""
    uid = _owner(user)
    if name not in ("index.html", "catalogue.yaml"):
        raise HTTPException(status_code=404, detail="no such file")
    doc = await asyncio.to_thread(_version_or_404, draft_id, version, uid)
    body = doc.get("html" if name == "index.html" else "yaml") or ""
    stem = re.sub(r"[^a-z0-9-]", "", (doc.get("artefactId") or "sim").lower())[:64] or "sim"
    filename = f"{stem}-v{version}-index.html" if name == "index.html" else f"{stem}-v{version}.yaml"
    return Response(
        body.encode("utf-8"),
        media_type="application/octet-stream",
        headers={**_DOWNLOAD_HEADERS, "Content-Disposition": f'attachment; filename="{filename}"'},
    )
