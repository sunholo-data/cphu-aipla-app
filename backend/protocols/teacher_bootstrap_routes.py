"""Teacher onboarding bootstrap.

``POST /api/teacher/bootstrap`` — called once on teacher app load. Seeds a
brand-new teacher's demo (a 'Demo class' + join code + two example activities)
the first time they sign in. Idempotent: a no-op for any teacher who already
owns a class, so it's safe to call on every mount.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from auth import User, assert_teacher, get_current_user
from onboarding.demo_seed import seed_demo_for_teacher

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


@router.post("/bootstrap")
async def bootstrap(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """Seed the teacher's onboarding demo if they have no classes yet.

    Returns ``{"seeded": false}`` for an established teacher (nothing created),
    or ``{"seeded": true, ...}`` with the new class + activity ids + join code.
    """
    assert_teacher(user)
    result = seed_demo_for_teacher(user.uid)
    return {"seeded": result is not None, **(result or {})}
