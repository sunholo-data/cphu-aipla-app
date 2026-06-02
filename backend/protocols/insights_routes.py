"""REST endpoints for the teacher insights dashboard (sprint
ANALYTICS-CHAT-AND-INSIGHTS, M7).

Five teacher-gated GET routes under ``/api/insights/*``:

- ``GET /api/insights/summary`` — KPI strip for every owned class
- ``GET /api/insights/classes/{class_id}/kpis`` — per-class card grid
- ``GET /api/insights/classes/{class_id}/groups`` — per-group bar data
- ``GET /api/insights/classes/{class_id}/activities`` — per-activity bar data
- ``GET /api/insights/compare`` — cross-class comparison table

Each route returns ``_debug.queries`` so the frontend's "Show data"
disclosure can render the executed SQL + params. Every per-class route
goes through :func:`analytics.auth.assert_caller_owns` first — a
cross-tenant access attempt returns the same byte-identical 404
``class not accessible`` as a missing class (HARD GATE preserved).

The 60s LRU cache in :mod:`insights.cache` sits between the route and
the aggregate helpers; navigation within a single teacher session
returns instantly on cache hit.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query

from analytics.auth import PERMISSION_ERROR_MESSAGE
from auth import User, get_current_user
from insights import aggregates
from insights.cache import CACHE, make_key

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/insights", tags=["insights"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_SINCE_PRESETS: dict[str, timedelta] = {
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    # "all" is special-cased below — we use a 5-year window as the
    # practical "all-time" since BQ scans want a bound.
    "all": timedelta(days=365 * 5),
}


def _assert_teacher(user: User) -> None:
    """Mirror ``classes_routes._assert_teacher``."""
    if not user.is_teacher:
        raise HTTPException(status_code=403, detail="teacher access required")


def _resolve_window(since: str, until: str | None) -> tuple[datetime, datetime]:
    """Translate the ``?since=7d|30d|all`` preset + optional ``?until``
    ISO timestamp into a concrete window. Rejects unknown presets so
    callers don't silently get an empty result from a typo."""
    preset = _SINCE_PRESETS.get(since)
    if preset is None:
        raise HTTPException(status_code=400, detail=f"invalid since preset {since!r}")
    until_dt = _parse_iso(until) if until else datetime.now(UTC)
    since_dt = until_dt - preset
    return since_dt, until_dt


def _parse_iso(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid until timestamp {value!r}") from exc


def _surface_key(surface: str, class_id: str | None = None) -> str:
    """Cache surface discriminator. ``class_id``-scoped where given so
    invalidation can target one class without nuking the teacher's
    whole cache."""
    return f"{surface}:{class_id}" if class_id else surface


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/summary")
async def summary(
    since: str = Query("7d"),
    until: str | None = Query(None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """KPI strip for every class the caller owns."""
    _assert_teacher(user)
    since_dt, until_dt = _resolve_window(since, until)
    key = make_key(
        teacher_uid=user.uid,
        surface=_surface_key("summary"),
        since=since_dt,
        until=until_dt,
    )
    return CACHE.get_or_compute(
        key,
        lambda: aggregates.teacher_summary(teacher_uid=user.uid, since=since_dt, until=until_dt),
    )


@router.get("/compare")
async def compare(
    since: str = Query("7d"),
    until: str | None = Query(None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Cross-class comparison table data."""
    _assert_teacher(user)
    since_dt, until_dt = _resolve_window(since, until)
    key = make_key(
        teacher_uid=user.uid,
        surface=_surface_key("compare"),
        since=since_dt,
        until=until_dt,
    )
    return CACHE.get_or_compute(
        key,
        lambda: aggregates.teacher_compare(teacher_uid=user.uid, since=since_dt, until=until_dt),
    )


def _per_class(
    *,
    surface: str,
    fn,
    user: User,
    class_id: str,
    since: str,
    until: str | None,
) -> dict[str, Any]:
    """Shared body for the three ``/classes/{id}/*`` routes. Auth +
    window resolution + cache lookup + HARD-GATE translation."""
    _assert_teacher(user)
    since_dt, until_dt = _resolve_window(since, until)
    key = make_key(
        teacher_uid=user.uid,
        surface=_surface_key(surface, class_id),
        since=since_dt,
        until=until_dt,
    )

    def _compute() -> dict[str, Any]:
        try:
            return fn(
                teacher_uid=user.uid,
                class_id=class_id,
                since=since_dt,
                until=until_dt,
            )
        except PermissionError as exc:
            # Byte-identical refusal: missing + not-owned both collapse
            # to the same 404 detail. Don't cache the refusal.
            raise HTTPException(
                status_code=404,
                detail=str(exc) or PERMISSION_ERROR_MESSAGE,
            ) from exc

    return CACHE.get_or_compute(key, _compute)


@router.get("/classes/{class_id}/kpis")
async def class_kpis(
    class_id: str = Path(..., min_length=1),
    since: str = Query("7d"),
    until: str | None = Query(None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Six-card KPI grid for one class."""
    return _per_class(
        surface="class_kpis",
        fn=aggregates.class_kpis,
        user=user,
        class_id=class_id,
        since=since,
        until=until,
    )


@router.get("/classes/{class_id}/groups")
async def class_groups(
    class_id: str = Path(..., min_length=1),
    since: str = Query("7d"),
    until: str | None = Query(None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Per-group bar data for one class."""
    return _per_class(
        surface="class_groups",
        fn=aggregates.class_groups,
        user=user,
        class_id=class_id,
        since=since,
        until=until,
    )


@router.get("/classes/{class_id}/activities")
async def class_activities(
    class_id: str = Path(..., min_length=1),
    since: str = Query("7d"),
    until: str | None = Query(None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Per-activity bar data for one class."""
    return _per_class(
        surface="class_activities",
        fn=aggregates.class_activities,
        user=user,
        class_id=class_id,
        since=since,
        until=until,
    )


@router.get("/classes/{class_id}/trend")
async def class_trend(
    class_id: str = Path(..., min_length=1),
    since: str = Query("7d"),
    until: str | None = Query(None),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Dense per-day messages-per-day series for the panel sparkline."""
    return _per_class(
        surface="class_trend",
        fn=aggregates.class_trend,
        user=user,
        class_id=class_id,
        since=since,
        until=until,
    )
