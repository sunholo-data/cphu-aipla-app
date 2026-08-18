"""Teacher onboarding bootstrap.

``POST /api/teacher/bootstrap`` — called once on teacher app load. It does two
jobs, and the second one is the reason this route matters more than it looks:

1. **Seeds the onboarding demo** (a 'Demo class' + example activities, and — for
   invited teachers only — a student join code) the first time they sign in.
   Idempotent: a no-op for any teacher who already owns a class.

2. **Reconciles the access tier** (ACCESS-1 M1). Firestore ``teacher_access`` is
   the source of truth for who may spend; a Firebase custom claim is the copy
   the auth hot path actually reads. This route is where the two are compared
   and the claim is corrected. It already ran on every app load and already
   triggered a client reload on ``seeded: true``, which is exactly the
   token-refresh hook a newly-set claim needs — so no new plumbing.

   The staleness this leaves is one-directional and deliberate: a GRANT lands
   within one app load, and a REVOKE does not wait for one because
   ``admin/routes.py`` also calls ``revoke_refresh_tokens``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from firebase_admin import auth as fb_auth
from pydantic import BaseModel, Field

from auth import User, assert_teacher, get_current_user
from auth.access_tiers import DEFAULT_ACCESS_TIER
from db.teacher_access import resolve_tier, stamp_uid
from onboarding.demo_seed import seed_demo_for_teacher

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


def _reconcile_access_tier(user: User) -> tuple[str, bool]:
    """Compare the register to the claim; fix the claim on drift.

    Returns ``(effective_tier, tier_changed)``. ``tier_changed`` tells the
    frontend to force-refresh its ID token — without that the client keeps
    presenting the old claim until Firebase rotates it (up to an hour).

    Fails SOFT: if the register cannot be read we keep whatever the token
    already claims rather than raising. Downgrading a real teacher to visitor
    because Firestore blipped would break their lesson; the spend gate is still
    in front of every paid call either way, and Ring 0's quota is still under
    that. Read failures are logged at WARNING so this is visible rather than
    silent.
    """
    if not user.email:
        # No email on the token (should not happen for a Firebase identity, but
        # the register is keyed by email so there is nothing to look up).
        return user.access_tier or DEFAULT_ACCESS_TIER, False

    try:
        effective = resolve_tier(user.email)
    except Exception:
        log.warning("bootstrap: teacher_access read failed for uid=%s; keeping claimed tier", user.uid)
        return user.access_tier or DEFAULT_ACCESS_TIER, False

    # BEFORE the early return, not after it. This used to sit at the bottom of
    # the function, so it only ran when the tier actually CHANGED — and a teacher
    # granted while already signed in gets their claim pushed by the admin route,
    # so their tier never drifts and their uid was never recorded. The money
    # gates join on that uid. No-ops once set.
    try:
        stamp_uid(user.email, user.uid)
    except Exception:
        log.warning("bootstrap: could not stamp uid on the register for uid=%s", user.uid)

    if effective == user.access_tier:
        return effective, False

    try:
        # Merge, don't replace: set_custom_user_claims overwrites the whole
        # claims blob, so dropping `role` here would silently un-researcher
        # every researcher on their next app load (1.1.5).
        existing = (fb_auth.get_user(user.uid).custom_claims or {}).copy()
        existing["accessTier"] = effective
        fb_auth.set_custom_user_claims(user.uid, existing)
    except Exception:
        log.warning("bootstrap: could not set accessTier claim for uid=%s", user.uid, exc_info=True)
        return user.access_tier or DEFAULT_ACCESS_TIER, False

    log.info(
        "bootstrap: accessTier reconciled uid=%s %s -> %s",
        user.uid,
        user.access_tier or "(none)",
        effective,
    )
    return effective, True


@router.post("/bootstrap")
async def bootstrap(user: User = Depends(get_current_user)) -> dict:  # noqa: B008
    """Reconcile the caller's access tier, then seed their demo if they're new.

    Returns ``{"seeded": false, "accessTier": "...", "tierChanged": false}`` for
    an established teacher, or ``{"seeded": true, ...}`` with the new class +
    activity ids (+ join code, for pilot teachers only) for a new one.

    ``tierChanged: true`` means the client must force-refresh its ID token
    before the new tier takes effect on any other route.
    """
    assert_teacher(user)

    # Tier first: the seed's behaviour depends on it (a visitor's demo class is
    # created without a student join code), so reconciling afterwards would seed
    # a freshly-granted teacher with no code and no second chance — the seeder
    # short-circuits on "already owns a class".
    effective_tier, tier_changed = _reconcile_access_tier(user)

    result = seed_demo_for_teacher(user.uid, access_tier=effective_tier)
    return {
        "seeded": result is not None,
        "accessTier": effective_tier,
        "tierChanged": tier_changed,
        **(result or {}),
    }


# ─── Access requests (ACCESS-1 M4) ────────────────────────────────────────────


class AccessRequestBody(BaseModel):
    """What a visitor tells us when they ask to join the programme."""

    name: str = Field(default="", max_length=200)
    institution: str = Field(default="", max_length=200)
    message: str = Field(default="", max_length=2000)

    model_config = {"extra": "forbid"}


@router.post("/access-request")
async def access_request(
    body: AccessRequestBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict:
    """Record a visitor's request to join the programme.

    Authenticated — they are signed in already, so this adds no unauthenticated
    write surface. Keyed by uid so re-submitting updates rather than piling up.

    Deliberately returns the SAME response whether or not the caller is already
    on the register: telling an anonymous submitter "you're already approved" or
    "you're not" would make this an enumeration oracle for the register.
    """
    assert_teacher(user)

    from db.access_requests import upsert_access_request

    try:
        upsert_access_request(
            uid=user.uid,
            email=user.email,
            name=body.name,
            institution=body.institution,
            message=body.message,
        )
    except Exception:
        log.warning("access_request: could not record request for uid=%s", user.uid, exc_info=True)
        # Still report success: the person did their part, and a storage blip is
        # ours to fix. They have no other route to retry that would help.

    log.info("access_request: recorded uid=%s institution=%r", user.uid, body.institution[:60])
    return {"received": True}
