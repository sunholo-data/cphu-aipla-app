"""The class's lessons, after the fact (1.1.139 M1).

Three routes under ``/api/insights/classes/{class_id}/lessons``:

- ``GET  …/lessons`` — the class's lessons, an ``(activity, date)`` each, newest first
- ``GET  …/lessons/{activity_id}?date=`` — one lesson: concepts, approach, next
  time, groups. ``?synthesis=cached`` never makes a model call (the class page's
  "Latest lesson" card); the default may make ONE, cached (``insights.lessons``)
- ``POST …/lessons/{activity_id}/summarise?date=`` — the teacher's explicit
  "summarise the remaining groups": capped, concurrency-limited

Owner or researcher read (``assert_can_read_class``), the same byte-identical
404 for missing and not-yours. A separate module from ``insights_routes`` so the
lesson surface can change without touching the KPI routes.

All synchronous BigQuery / Firestore work runs through
``CACHE.aget_or_compute`` or ``asyncio.to_thread`` (1.1.131).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from analytics.auth import PERMISSION_ERROR_MESSAGE, assert_can_read_class
from auth import User, get_current_user
from auth import assert_teacher as _assert_teacher
from insights import lessons
from insights.cache import CACHE, make_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights", tags=["insights"])

_EPOCH = datetime(2000, 1, 1, tzinfo=UTC)
_DATE_PATTERN = r"^\d{4}-\d{2}-\d{2}$"


def _key(user: User, surface: str):
    return make_key(teacher_uid=user.uid, surface=surface, since=_EPOCH, until=_EPOCH)


async def _authorise(user: User, class_id: str) -> None:
    _assert_teacher(user)
    try:
        await asyncio.to_thread(assert_can_read_class, user, class_id)
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc) or PERMISSION_ERROR_MESSAGE) from exc


@router.get("/classes/{class_id}/lessons")
async def class_lessons(
    class_id: str = Path(..., min_length=1),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The class's lessons, newest first."""
    await _authorise(user, class_id)
    result = await CACHE.aget_or_compute(_key(user, f"lessons:{class_id}"), lambda: lessons.list_lessons(class_id))
    log.info("insights_query route=lessons class_id=%s uid=%s n=%d", class_id, user.uid, len(result["lessons"]))
    return result


@router.get("/classes/{class_id}/lessons/{activity_id}")
async def class_lesson(
    class_id: str = Path(..., min_length=1),
    activity_id: str = Path(..., min_length=1),
    date: str = Query(..., pattern=_DATE_PATTERN),
    synthesis: str = Query("generate", pattern="^(generate|cached)$"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """One lesson. Teachers get prose for the approach; researchers also get
    the per-construct band distribution (1.1.65 R1, D3)."""
    await _authorise(user, class_id)
    researcher = bool(getattr(user, "is_researcher", False))
    surface = f"lesson:{class_id}:{activity_id}:{date}:{'r' if researcher else 't'}"
    detail = await CACHE.aget_or_compute(
        _key(user, surface),
        lambda: lessons.lesson_detail(class_id, activity_id, date, researcher=researcher),
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    synth = await lessons.resolve_synthesis(detail, generate=synthesis == "generate")
    log.info(
        "insights_query route=lesson class_id=%s activity=%s date=%s uid=%s synthesis=%s",
        class_id,
        activity_id,
        date,
        user.uid,
        synthesis,
    )
    return {**detail, "synthesis": synth}


@router.post("/classes/{class_id}/lessons/{activity_id}/summarise")
async def summarise_lesson(
    class_id: str = Path(..., min_length=1),
    activity_id: str = Path(..., min_length=1),
    date: str = Query(..., pattern=_DATE_PATTERN),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Summarise the lesson's not-yet-summarised sessions — at most
    ``lessons.SUMMARISE_MAX_PER_REQUEST`` model calls, two at a time. The
    caller re-reads the lesson afterwards; ``remaining`` says whether to offer
    the button again."""
    await _authorise(user, class_id)
    detail = await asyncio.to_thread(lessons.lesson_detail, class_id, activity_id, date)
    if detail is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    result = await lessons.summarise_sessions(detail["pendingSessionIds"])
    CACHE.invalidate_for_teacher(user.uid)
    log.info(
        "lesson_summarise class_id=%s activity=%s date=%s uid=%s requested=%d summarised=%d",
        class_id,
        activity_id,
        date,
        user.uid,
        result["requested"],
        result["summarised"],
    )
    return result
