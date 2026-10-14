"""Teacher-published sims: publish, the page students get, the shared library
(in-app-sim-authoring M6).

- ``POST /api/sim-drafts/{draft}/versions/{n}/publish``: the teacher's recorded
  approval publishes that exact version to their own classes.
- ``GET /api/teacher-sims/{id}/{version}/index.html``: the frozen page. Any
  signed-in caller (a student in a class running it, or a teacher previewing):
  a published page carries no secret, the tutor block never leaves the server,
  and the leak gate ran before publishing. Served as text that a browser will
  not render on the app origin; the frame writes it into the sandbox.
- ``GET /api/teacher-sims/mine``, ``POST …/{id}/library-request``,
  ``POST …/{id}/withdraw``: the owner's side.
- ``GET /api/teacher-sims/review``, ``POST …/{id}/library-decision``: a
  researcher's recorded sign-off for the shared library.
"""

from __future__ import annotations

import asyncio
import re

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from fastapi.responses import Response

from auth import User, get_current_user
from auth.guards import assert_researcher, assert_teacher
from db import sim_drafts, teacher_sims

router = APIRouter(tags=["teacher-sims"])

_PAGE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, max-age=300",
}
_ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")


def _workshop_user(user: User) -> str:
    assert_teacher(user)
    from auth.features import SIM_WORKSHOP, has_feature

    if not has_feature(user, SIM_WORKSHOP):
        raise HTTPException(status_code=403, detail={"error": "feature_not_enabled", "feature": SIM_WORKSHOP})
    return user.uid


def _who(user: User) -> str:
    return getattr(user, "email", "") or user.uid


def _summary(row: dict) -> dict:
    meta = row.get("meta") or {}
    return {
        "id": row.get("__id") or meta.get("id"),
        "displayName": meta.get("displayName"),
        "version": row.get("version"),
        "scope": row.get("scope"),
        "status": row.get("status"),
        "draftId": row.get("draftId"),
        "draftVersion": row.get("draftVersion"),
        "approvedBy": row.get("approvedBy"),
        "approvedAt": row.get("approvedAt"),
        "libraryRequested": bool(row.get("libraryRequested")),
        "librarySignoff": row.get("librarySignoff"),
        "libraryDeclined": row.get("libraryDeclined"),
        "ownerUid": row.get("ownerUid"),
    }


@router.post("/api/sim-drafts/{draft_id}/versions/{version}/publish")
async def publish_route(
    draft_id: str = Path(...),
    version: int = Path(..., ge=1),
    body: dict = Body(default_factory=dict),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Publish one checked version to the caller's own classes.

    Body: ``{"approve": true}``, the teacher's statement that they tried this
    version and approve it for their students. It is recorded with the version.
    """
    uid = _workshop_user(user)
    if body.get("approve") is not True:
        raise HTTPException(status_code=400, detail="publishing needs your approval: send approve=true")
    try:
        doc = await asyncio.to_thread(sim_drafts.get_version, draft_id, version, uid)
    except ValueError:
        doc = None
    if doc is None:
        raise HTTPException(status_code=404, detail="draft version not found")

    from artefacts.loader import builtin_artefacts
    from sim_authoring.publish import NotPublishable, prepare

    try:
        prepared = await asyncio.to_thread(prepare, doc, builtin_ids={a.id for a in builtin_artefacts()})
    except NotPublishable as exc:
        raise HTTPException(status_code=422, detail={"error": "not_publishable", "reasons": exc.reasons}) from exc
    try:
        n = await asyncio.to_thread(
            teacher_sims.publish,
            sim_id=prepared.sim_id,
            owner_uid=uid,
            approved_by=_who(user),
            meta=prepared.meta,
            html=prepared.html,
            yaml_text=doc.get("yaml") or "",
            draft_id=draft_id,
            draft_version=version,
            gates=prepared.gates,
            screenshots={k: v for k, v in (doc.get("screenshots") or {}).items() if k in ("700", "driven")},
        )
    except teacher_sims.PublishRefused as exc:
        raise HTTPException(status_code=409, detail={"error": "id_taken", "reasons": [str(exc)]}) from exc
    sim = await asyncio.to_thread(teacher_sims.get_sim, prepared.sim_id)
    return {"published": _summary(sim or {"__id": prepared.sim_id, "version": n})}


@router.get("/api/teacher-sims/mine")
async def mine_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    uid = _workshop_user(user)
    rows = await asyncio.to_thread(teacher_sims.list_for_owner, uid)
    return {"sims": [_summary(r) for r in rows]}


@router.get("/api/teacher-sims/review")
async def review_route(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """For researchers: sims waiting for a library sign-off."""
    assert_researcher(user)
    rows = await asyncio.to_thread(teacher_sims.list_library_requests)
    return {"requests": [{**_summary(r), "request": r.get("libraryRequest")} for r in rows]}


@router.get("/api/teacher-sims/{sim_id}/{version}/index.html")
async def page_route(
    sim_id: str = Path(...),
    version: str = Path(..., pattern=r"^v[0-9]{1,4}$"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> Response:
    """The frozen page of a live published sim, for the sandbox frame."""
    if not _ID_RE.match(sim_id):
        raise HTTPException(status_code=404, detail="sim not found")
    html = await asyncio.to_thread(teacher_sims.get_version_html, sim_id, int(version[1:]))
    if html is None:
        raise HTTPException(status_code=404, detail="sim not found")
    return Response(html.encode("utf-8"), media_type="text/plain; charset=utf-8", headers=_PAGE_HEADERS)


def _or_404(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="sim not found") from exc


@router.post("/api/teacher-sims/{sim_id}/library-request")
async def library_request_route(
    sim_id: str = Path(...),
    body: dict = Body(default_factory=dict),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """The owner asks for the shared library; a researcher reviews it."""
    uid = _workshop_user(user)
    row = await asyncio.to_thread(_or_404, teacher_sims.request_library, sim_id, uid, str(body.get("note") or ""))
    return {"sim": _summary({"__id": sim_id, **row})}


@router.post("/api/teacher-sims/{sim_id}/library-decision")
async def library_decision_route(
    sim_id: str = Path(...),
    body: dict = Body(default_factory=dict),  # noqa: B008
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """A researcher's recorded sign-off: ``{"approve": true|false, "note": "…"}``."""
    assert_researcher(user)
    if not isinstance(body.get("approve"), bool):
        raise HTTPException(status_code=400, detail="send approve=true or approve=false")
    row = await asyncio.to_thread(
        _or_404, teacher_sims.decide_library, sim_id, _who(user), body["approve"], str(body.get("note") or "")
    )
    return {"sim": _summary({"__id": sim_id, **row})}


@router.post("/api/teacher-sims/{sim_id}/withdraw")
async def withdraw_route(sim_id: str = Path(...), user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """Take a sim out of the catalogue: its owner, or a researcher for any sim.
    Activities using it keep running, without the sim."""
    is_researcher = bool(getattr(user, "is_researcher", False))
    if is_researcher:
        owner = None
    else:
        owner = _workshop_user(user)
    row = await asyncio.to_thread(_or_404, teacher_sims.withdraw, sim_id, _who(user), owner_uid=owner)
    return {"sim": _summary({"__id": sim_id, **row})}
