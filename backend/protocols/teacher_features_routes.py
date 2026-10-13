"""GET /api/teacher/features — which per-teacher features the caller has (2026-10-13).

The UI shows a feature the caller lacks greyed out with a way to ask for it, so
it needs the answer, not just a 403 from the feature's own routes.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from auth import User, get_current_user
from auth.guards import assert_teacher

router = APIRouter(prefix="/api/teacher", tags=["teacher-features"])


@router.get("/features")
async def my_features(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """``{"features": {"simWorkshop": bool, …}, "researcher": bool}`` for the caller."""
    import asyncio

    from auth.features import feature_map

    assert_teacher(user)
    return {
        "features": await asyncio.to_thread(feature_map, user),
        "researcher": bool(getattr(user, "is_researcher", False)),
    }
