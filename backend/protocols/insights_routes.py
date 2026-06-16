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
    result = CACHE.get_or_compute(
        key,
        lambda: aggregates.teacher_summary(teacher_uid=user.uid, since=since_dt, until=until_dt),
    )
    # M10 observability — `dashboard_load` fires on the canonical
    # first request /teacher/classes makes; `insights_query` covers
    # every /api/insights/* route. Filter Cloud Logging via
    # `jsonPayload.message:"dashboard_load"` etc.
    log.info(
        "dashboard_load surface=summary teacher_uid=%s class_count=%d since=%s",
        user.uid,
        len(result.get("classes", [])),
        since,
    )
    log.info("insights_query route=summary teacher_uid=%s since=%s", user.uid, since)
    return result


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
    result = CACHE.get_or_compute(
        key,
        lambda: aggregates.teacher_compare(teacher_uid=user.uid, since=since_dt, until=until_dt),
    )
    log.info("insights_query route=compare teacher_uid=%s since=%s", user.uid, since)
    return result


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

    result = CACHE.get_or_compute(key, _compute)
    log.info(
        "insights_query route=%s class_id=%s teacher_uid=%s since=%s",
        surface,
        class_id,
        user.uid,
        since,
    )
    return result


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


@router.get("/cost")
async def cost_overview(
    period: str = Query("this_month"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Cross-class spend overview for the researcher cost view (sprint 1.1.9).

    Researcher-only: a non-researcher (even a teacher) gets 403, including
    a URL-hack. Returns EUR totals + per-cohort + per-model + per-class
    breakdowns across every class (researchers query cross-tenant by design —
    [1.1.5] researcher-role)."""
    from analytics import cost_queries

    _assert_teacher(user)
    if not user.is_researcher:
        raise HTTPException(status_code=403, detail="researcher access required")
    if period not in ("this_month", "last_month", "all_time"):
        raise HTTPException(status_code=400, detail=f"invalid period {period!r}")
    log.info("insights_query route=cost researcher_uid=%s period=%s", user.uid, period)
    return cost_queries.cohort_spend(period)  # type: ignore[arg-type]


@router.get("/cost/mine")
async def my_cost_overview(
    period: str = Query("this_month"),
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Teacher-scoped spend: EUR total + per-class across the CALLER's OWN
    classes (1.1.9 follow-up — the teacher-level total the class list shows).

    Any teacher; scoped to their own classes (NO researcher claim, unlike
    ``/cost`` which is cross-tenant). Sums one BQ query over the union of the
    caller's classes' group codes."""
    from analytics import cost_queries
    from db.classes import list_classes_for_owner

    _assert_teacher(user)
    if period not in ("this_month", "last_month", "all_time"):
        raise HTTPException(status_code=400, detail=f"invalid period {period!r}")
    classes = list_classes_for_owner(user.uid)
    mapping = {c.class_id: list(c.group_codes) for c in classes}
    log.info("insights_query route=cost/mine uid=%s classes=%d period=%s", user.uid, len(mapping), period)
    return cost_queries.classes_spend(mapping, period)  # type: ignore[arg-type]
