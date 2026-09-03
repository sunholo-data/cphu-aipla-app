"""Delegated programme administration API (PROGADMIN-1 — 1.1.76).

The **second, narrower door** to the access register that ACCESS-1 (1.1.75)
created. The first door — ``/api/admin/access/*`` — is gated on the
service-account allowlist and is unbounded; on prod exactly one human can open
it. That is a bus factor of one on the gate deciding whether a class can teach.

This router is the other door:

    /api/admin/access/*      SA allowlist       unbounded   M, Cloud Build, ops
    /api/programme/access/*  Firebase teacher   BOUNDED     delegated admins
                             + researcher                   read only

**The two doors never share a guard.** This module must never call
``_assert_caller_is_service_account``, and ``admin/routes.py`` must never read
the ``programmeAdmin`` claim — so neither gate can be widened by accident while
someone is editing the other.

Two capabilities, deliberately distinct (see the design doc's "why not just
widen researcher"):

    role:researcher    cross-class READ of teaching data       -> read here
    programmeAdmin     may commit money on the programme's     -> write here
                       behalf

They are separate claim keys rather than two values of ``role`` because ``role``
is single-valued: making them alternatives would force JB to choose between
reading research data and admitting a teacher.

Denials are **404, not 403**, matching ``research_lens_routes.py``: an
administrative surface should not confirm its own existence to a caller who may
not use it.

NOTE ON AUTH: this imports the Firebase-ONLY ``get_current_user`` on purpose.
Every caller here is a Firebase teacher; an anonymous-group student JWT has no
business on this surface and the Firebase verifier rejecting it is the intended
outcome. ``scripts/check-auth-dispatcher.sh`` carries a matching ALLOWLIST entry
— without it, CI reds.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from auth.access_sync import (
    close_access_request,
    invalidate_spend_cache,
    revoke_sessions,
    sync_access_claim,
)
from auth.firebase_auth import User, get_current_user
from auth.guards import assert_programme_admin
from auth.programme_bounds import allowed_domains, is_domain_allowed, max_cap_usd, max_expiry

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/programme", tags=["programme-admin"])


def _assert_programme_reader(user: User) -> None:
    """Allow a researcher **or** a programme admin; 404 everyone else.

    Read is the union of the two claims because the read-only view and the
    write view are deliberately the SAME surface at different privilege levels
    — two surfaces would drift, and the read-only view's whole value is that
    the person looking at it can tell you what they see.
    """
    if not (getattr(user, "is_researcher", False) or getattr(user, "is_programme_admin", False)):
        raise HTTPException(status_code=404, detail="not found")


@router.get("/access/list")
async def programme_access_list(
    include_revoked: bool = False,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Everyone on the access register — who may spend, their cap, and who
    granted it.

    Reuses ``db.teacher_access.list_grants`` rather than reimplementing the
    register: one store, two doors.
    """
    from budget.firestore_enforcer import read_period_spend_usd
    from db.teacher_access import list_grants

    _assert_programme_reader(user)
    grants = list_grants(include_revoked=include_revoked)
    # The cap sits NEXT TO THE SPEND IT BOUNDS. A register showing caps without
    # usage makes you set numbers blind — which is how this register arrived at
    # "uncapped" on 2026-08-12 and revisited it an hour later.
    #
    # `None` (not 0.0) when the total cannot be read: "spent nothing" and
    # "Firestore did not answer" are different facts, and the reassuring one
    # must not be what a broken read produces.
    spend = {g.email: (read_period_spend_usd(g.uid) if g.uid else None) for g in grants}
    return {
        "count": len(grants),
        "canWrite": bool(getattr(user, "is_programme_admin", False)),
        "grants": [
            {
                "email": g.email,
                "tier": g.tier,
                "monthlyCapUsd": g.monthly_cap_usd,
                "grantedBy": g.granted_by,
                "grantedVia": g.granted_via,
                "grantedAt": g.granted_at,
                "expiresAt": g.expires_at,
                "active": g.is_active,
                "revoked": g.revoked,
                "uid": g.uid,
                "note": g.note,
                "spentThisPeriodUsd": spend.get(g.email),
            }
            for g in grants
        ],
    }


@router.get("/access/requests")
async def programme_access_requests(
    status: str = "pending",
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The queue of people asking to join the programme.

    There is no email notification anywhere in this flow — the queue does not
    tell anyone it has something in it. Making it visible to the researchers
    who actually know these teachers is half the point of this milestone.
    """
    from db.access_requests import list_access_requests

    _assert_programme_reader(user)
    wanted = None if status == "all" else status
    requests = list_access_requests(status=wanted)  # type: ignore[arg-type]
    return {
        "count": len(requests),
        "canWrite": bool(getattr(user, "is_programme_admin", False)),
        "requests": [
            {
                "uid": r.uid,
                "email": r.email,
                "name": r.name,
                "institution": r.institution,
                "message": r.message,
                "status": r.status,
                "requestedAt": r.requested_at,
            }
            for r in requests
        ],
    }


# ─── The bounded write half (M2) ─────────────────────────────────────────────
#
# Everything below requires `programmeAdmin`. A researcher reading this surface
# gets a 404 here, exactly as a stranger does — READ and WRITE are different
# questions and this router answers them with different guards.
#
# Every bound is re-checked HERE, server-side. The client's cap input is a
# convenience, nothing more.


class ProgrammeGrantBody(BaseModel):
    """Admit one named person, or re-set their cap.

    ``grant_access`` is already idempotent and preserves the audit trail, so
    "change the cap" is the same call as "grant" — the panel needs a field, not
    a mechanism. Admitting a teacher happens once; adjusting their cap happens
    continuously, and that is the operation this surface exists to make cheap.
    """

    email: str = Field(min_length=3, max_length=320)
    tier: str = "pilot"
    monthly_cap_usd: float | None = Field(default=None, alias="monthlyCapUsd")
    expires_at: str | None = Field(default=None, alias="expiresAt")
    note: str = Field(default="", max_length=2000)

    model_config = ConfigDict(populate_by_name=True)


class ProgrammeRevokeBody(BaseModel):
    email: str = Field(min_length=3, max_length=320)

    model_config = ConfigDict(populate_by_name=True)


def _check_delegated_bounds(email: str, tier: str, cap: float, expires_at: str | None) -> None:
    """Refuse anything outside the delegated envelope, with the bound NAMED.

    403 here rather than 404: the caller is a legitimate programme admin who
    has asked for something they may not have. Hiding the ceiling from the
    person expected to work within it would just produce a support ticket.
    """
    from db.teacher_access import UNCAPPED

    if tier not in ("pilot", "visitor"):
        raise HTTPException(status_code=403, detail=f"A programme admin may grant 'pilot' or 'visitor', not {tier!r}.")

    # Removing the limit entirely stays a service-account decision. `0` is a
    # ZERO cap (spend suspended) and is a legitimate SA state, but it disables
    # the per-teacher gate outright, so it is not delegated either.
    if cap == UNCAPPED or cap <= 0:
        raise HTTPException(
            status_code=403,
            detail=(
                "A programme admin must set a positive cap. Removing the limit, or suspending "
                "spend with a zero cap, is a service-account decision."
            ),
        )

    ceiling = max_cap_usd()
    if cap > ceiling:
        raise HTTPException(
            status_code=403,
            detail=f"${cap:.2f}/month exceeds the delegated ceiling of ${ceiling:.2f}. Ask for a service-account grant.",
        )

    if not is_domain_allowed(email):
        allowed = ", ".join(sorted(allowed_domains()))
        raise HTTPException(
            status_code=403,
            detail=f"Delegated grants are restricted to: {allowed}.",
        )

    # Delegation cannot outlive the engagement: forgetting to clean up should
    # make access LAPSE, not persist.
    ceiling_expiry = max_expiry()
    if expires_at and expires_at > ceiling_expiry:
        raise HTTPException(
            status_code=403,
            detail=f"A delegated grant may not run past {ceiling_expiry}.",
        )


@router.post("/access/grant")
async def programme_access_grant(
    body: ProgrammeGrantBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Admit a teacher, or re-set their cap — bounded in amount and audience.

    Runs the SAME post-write effects as the service-account door
    (``auth.access_sync``): claim push, uid stamp, cache invalidation, request
    closure. A grant that skips any of them is a grant that does not take
    effect, and the failure mode is the quiet one — the register looks correct
    while the cap never binds.
    """
    from db.teacher_access import (
        DEFAULT_MONTHLY_CAP_USD,
        GRANTED_VIA_PROGRAMME_ADMIN,
        grant_access,
    )
    from db.teacher_access import normalise_email as _norm

    assert_programme_admin(user)

    email = _norm(body.email)
    cap = body.monthly_cap_usd if body.monthly_cap_usd is not None else DEFAULT_MONTHLY_CAP_USD
    expires_at = body.expires_at or max_expiry()
    _check_delegated_bounds(email, body.tier, cap, expires_at)

    try:
        grant = grant_access(
            email,
            tier=body.tier,  # type: ignore[arg-type]
            monthly_cap_usd=cap,
            granted_by=user.email or user.uid,
            granted_via=GRANTED_VIA_PROGRAMME_ADMIN,
            expires_at=expires_at,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    uid = sync_access_claim(email, grant.tier)
    invalidate_spend_cache()
    if uid:
        close_access_request(uid, decided_by=user.email or user.uid)

    log.info(
        "programme.access_grant email=%s tier=%s cap=%.2f by=%s uid=%s",
        grant.email,
        grant.tier,
        grant.monthly_cap_usd,
        user.email or user.uid,
        uid or "-",
    )
    return {
        "email": grant.email,
        "tier": grant.tier,
        "monthlyCapUsd": grant.monthly_cap_usd,
        "expiresAt": grant.expires_at,
        "grantedVia": grant.granted_via,
        "claimSyncedUid": uid,
        "note": grant.note,
    }


@router.post("/access/revoke")
async def programme_access_revoke(
    body: ProgrammeRevokeBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Revoke spend authority, and drop outstanding sessions immediately.

    Revoke IS delegated while raising a cap is not, and the asymmetry is
    deliberate: revoking reduces spend and an accidental revoke is one command
    to undo, whereas an over-generous cap is money already gone by the time
    anyone notices.
    """
    from db.teacher_access import normalise_email as _norm
    from db.teacher_access import revoke_access

    assert_programme_admin(user)

    email = _norm(body.email)
    if not revoke_access(email, revoked_by=user.email or user.uid):
        raise HTTPException(status_code=404, detail=f"{email} is not on the access register")

    uid = sync_access_claim(email, "visitor")
    if uid:
        revoke_sessions(uid)
    invalidate_spend_cache()
    log.info("programme.access_revoke email=%s by=%s uid=%s", email, user.email or user.uid, uid or "-")
    return {"email": email, "tier": "visitor", "revoked": True, "claimSyncedUid": uid}


# ─── Programme-wide daily budget (M3) ────────────────────────────────────────
#
# Settable by a programme admin; VISIBLE to a researcher — same split as the
# register, same reasoning. See `db.programme_budget` for why this is USD rather
# than tokens, and why its ceiling is env-configured rather than read live from
# the Vertex quota.


class ProgrammeBudgetBody(BaseModel):
    """Set or clear the programme-wide daily budget.

    ``dailyBudgetUsd: null`` clears it — back to unset, which is the honest
    default while ``class_spend`` still lacks a month of pilot data.
    """

    daily_budget_usd: float | None = Field(default=None, alias="dailyBudgetUsd")
    action: str = "warn"

    model_config = ConfigDict(populate_by_name=True)


@router.get("/budget")
async def programme_budget_get(
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """The configured programme-wide daily budget, plus today's spend."""
    from budget.firestore_enforcer import PROGRAMME_METER_KEY, _day_key, read_identity_total_usd
    from db.programme_budget import get_programme_budget, max_daily_budget_usd

    _assert_programme_reader(user)
    budget = get_programme_budget()
    return {
        "dailyBudgetUsd": budget.daily_budget_usd if budget else None,
        "action": budget.action if budget else "warn",
        "updatedBy": budget.updated_by if budget else "",
        "updatedAt": budget.updated_at if budget else "",
        "spentTodayUsd": read_identity_total_usd(PROGRAMME_METER_KEY, _day_key()),
        "ceilingUsd": max_daily_budget_usd(),
        "canWrite": bool(getattr(user, "is_programme_admin", False)),
    }


@router.put("/budget")
async def programme_budget_put(
    body: ProgrammeBudgetBody,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Set or clear the programme-wide daily budget.

    Bounded by the ceiling it sits under: a value above that would read as
    raising the ceiling while doing nothing, which is the worst kind of control.
    """
    from db.programme_budget import clear_programme_budget, set_programme_budget

    assert_programme_admin(user)
    actor = user.email or user.uid

    if body.daily_budget_usd is None:
        clear_programme_budget(updated_by=actor)
        return {"dailyBudgetUsd": None, "action": "warn", "updatedBy": actor}

    try:
        budget = set_programme_budget(daily_budget_usd=body.daily_budget_usd, action=body.action, updated_by=actor)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return {
        "dailyBudgetUsd": budget.daily_budget_usd,
        "action": budget.action,
        "updatedBy": budget.updated_by,
        "updatedAt": budget.updated_at,
    }
