"""The one-page activity sheet, for teachers and for a student group (1.1.165).

Design: ``docs/design/aipla/v2.1.0-extension/activity-sheet.md``.

``format=md`` returns the sheets as Markdown for the app to show and print, and
never calls AILANG Parse. ``format=docx`` returns one Word file with a page per
group. A failed conversion is a 503, so the page can offer Print instead.
"""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel

from adk.teacher_focus import _activity_to_config, resolve_active_config
from analytics.auth import assert_can_read_class
from artefacts.loader import load_artefact
from auth import User, get_current_user
from auth import assert_teacher as _assert_teacher
from db.activities import get_activity
from db.classes import get_class
from db.models.activity_config import ActivityConfig
from handouts.activity_sheet import SheetUnavailable, build_sheets, to_docx

log = logging.getLogger(__name__)

router = APIRouter(tags=["activity-sheet"])

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SheetFormat = Literal["md", "docx"]


class SheetOut(BaseModel):
    code: str | None
    markdown: str


class ActivitySheetResponse(BaseModel):
    title: str
    language: str
    sheets: list[SheetOut]


def _sim_title(cfg: ActivityConfig) -> str | None:
    if not cfg.artefact_id:
        return None
    meta = load_artefact(cfg.artefact_id)
    return meta.display_name if meta is not None else None


def _filename(cfg: ActivityConfig) -> str:
    """ASCII filename: Danish letters transliterated, the rest collapsed to ``-``."""
    stem = (cfg.title or "").lower().replace("æ", "ae").replace("ø", "o").replace("å", "a")
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")[:40].strip("-") or "activity"
    prefix = "aktivitetsark" if cfg.language == "da" else "activity-sheet"
    return f"{prefix}-{stem}.docx"


async def _respond(cfg: ActivityConfig, *, codes: list[str], origin: str | None, fmt: SheetFormat):
    sim_title = _sim_title(cfg)
    if fmt == "md":
        sheets = build_sheets(cfg, codes=codes, origin=origin, sim_title=sim_title)
        return ActivitySheetResponse(
            title=cfg.title,
            language=cfg.language,
            sheets=[SheetOut(code=s.code, markdown=s.markdown) for s in sheets],
        )
    try:
        data = await asyncio.to_thread(to_docx, cfg, codes=codes, origin=origin, sim_title=sim_title)
    except SheetUnavailable as exc:
        log.warning("activity sheet: Word unavailable for %s (%s)", cfg.activity_id, exc)
        raise HTTPException(status_code=503, detail="The Word file could not be made right now.") from exc
    log.info("activity sheet: docx for %s, %d group(s)", cfg.activity_id, len(codes))
    return Response(
        content=data,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{_filename(cfg)}"'},
    )


@router.get("/api/classes/{class_id}/activities/{activity_id}/sheet", response_model=None)
async def get_class_activity_sheet(
    class_id: str = Path(...),
    activity_id: str = Path(...),
    format: SheetFormat = Query("md"),  # noqa: B008 — the public query name is "format"
    origin: str | None = Query(None, max_length=200),
    code: str | None = Query(None, max_length=64),
    user: User = Depends(get_current_user),  # noqa: B008
):
    """A sheet per live group of the class, for the teacher to print.

    Owner or researcher, like the class page. The activity must be in the class,
    and need not be the teacher's own: a shared-library activity assigned to
    their class prints like any other. ``code`` narrows to one live code.
    """
    _assert_teacher(user)
    try:
        assert_can_read_class(user, class_id)
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="class not found") from exc
    cls = get_class(class_id)
    if cls is None:
        raise HTTPException(status_code=404, detail="class not found")
    if activity_id not in cls.activity_ids:
        raise HTTPException(status_code=409, detail="This activity is not in that class.")
    activity = get_activity(activity_id)
    if activity is None:
        raise HTTPException(status_code=404, detail="activity not found")
    codes = cls.active_group_codes
    if code is not None:
        if code not in codes:
            raise HTTPException(status_code=404, detail="group not found")
        codes = [code]
    cfg = _activity_to_config(activity, class_id=cls.class_id)
    return await _respond(cfg, codes=codes, origin=origin, fmt=format)


@router.get("/api/activity-configs/active/{activity_id}/sheet", response_model=None)
async def get_my_activity_sheet(
    activity_id: str = Path(...),
    format: SheetFormat = Query("md"),  # noqa: B008 — the public query name is "format"
    origin: str | None = Query(None, max_length=200),
    user: User = Depends(get_current_user),  # noqa: B008
):
    """The student group's own sheet: its own code, nobody else's.

    Resolved exactly like ``GET /api/activity-configs/active/{id}``, so it shows
    nothing that route does not already serve to the same group.
    """
    code = getattr(user, "group_id", "") or ""
    if not code:
        raise HTTPException(status_code=403, detail="a student group is required")
    cfg = resolve_active_config(activity_id, group_tags=user.group_tags)
    if cfg is None:
        raise HTTPException(status_code=404, detail="activity not found")
    return await _respond(cfg, codes=[code], origin=origin, fmt=format)
