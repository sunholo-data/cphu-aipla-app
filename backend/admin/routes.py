"""FastAPI router for /api/admin/* endpoints.

Admin routes are gated by `_assert_caller_is_service_account` (Google
ID token + SA email allowlist). Never expose these to end users — they
exist to support Cloud Build deploy hooks and ops runbooks.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from firebase_admin import auth as fb_auth
from pydantic import BaseModel

from admin import platform_seed
from admin.auth import _assert_caller_is_service_account
from auth.group_id_auth import DEFAULT_GROUP_CODE_TTL_DAYS, create_group, upsert_group
from skills.skill_config import list_skills

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/seed-platform-skills")
def seed_platform_skills(request: Request) -> dict[str, Any]:
    """Idempotently seed the default platform-owned skills.

    Hit once per deploy by the Cloud Build seed step. Returns a JSON
    SeedSummary so Cloud Build logs capture what happened.
    """
    _assert_caller_is_service_account(request)
    summary = platform_seed.seed()
    return summary.as_dict()


class ResetSkillAccessRequest(BaseModel):
    """Body for ``POST /api/admin/reset-skill-access``.

    Identifies a platform-owned skill by ``name`` (platform skills are
    uniquely keyed by name) and resets its accessControl to public.
    One-off cleanup verb for unwinding orphan class-namespace tags
    that the teacher PATCH /lessons path (or the early buggy demo
    seed) wrote onto a skill the template ships as public.
    """

    name: str


@router.post(
    "/reset-skill-access",
    responses={
        404: {"description": "Skill not found"},
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
    },
)
def reset_skill_access(body: ResetSkillAccessRequest, request: Request) -> dict[str, Any]:
    """Reset a platform-owned skill's accessControl to ``{type: public}``."""
    from db.firestore import get_document, set_document
    from skills.platform import PLATFORM_OWNER_UID
    from skills.skill_config import list_skills

    caller_email = _assert_caller_is_service_account(request)
    matches = [c for c in list_skills(owner_id=PLATFORM_OWNER_UID, limit=200) if c.name == body.name]
    if not matches:
        raise HTTPException(status_code=404, detail=f"Platform skill '{body.name}' not found")
    skill = matches[0]
    doc = get_document("skills", skill.skill_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Skill doc missing")
    before = doc.get("accessControl", {})
    doc["accessControl"] = {"type": "public"}
    set_document("skills", skill.skill_id, doc)
    logger.info(
        "admin.reset_skill_access: %s (%s) accessControl %r -> public by %s",
        body.name,
        skill.skill_id,
        before,
        caller_email,
    )
    return {
        "name": body.name,
        "skillId": skill.skill_id,
        "before": before,
        "after": {"type": "public"},
    }


class ResearcherClaimRequest(BaseModel):
    """Body for grant/revoke-researcher (sprint 1.1.5).

    ``uid`` is the Firebase Auth UID of the target user. The claim takes
    effect on that user's NEXT ID-token refresh (Firebase caches the
    current token until it expires, ~1h).
    """

    uid: str


def _set_claim(uid: str, key: str, value: Any, *, granted: bool) -> dict:
    """Merge (grant) or strip (revoke) ONE custom claim without
    clobbering the others (e.g. ``groupTags``, or a role held alongside
    an admin bit).

    set_custom_user_claims OVERWRITES the entire claim set, so we read
    the existing claims first and merge. Returns the resulting claim dict.

    Revoke strips the key only when it currently holds ``value`` — "only
    strip the claim we own". That is what keeps ``revoke-researcher``
    from deleting some future non-researcher role, and it generalises
    unchanged to the admin bit.
    """
    existing = fb_auth.get_user(uid).custom_claims or {}
    new_claims = dict(existing)
    if granted:
        new_claims[key] = value
    elif new_claims.get(key) == value:
        del new_claims[key]
    fb_auth.set_custom_user_claims(uid, new_claims or None)
    return new_claims


def _set_researcher_claim(uid: str, *, granted: bool) -> dict:
    """Grant/revoke ``role:researcher`` (sprint 1.1.5)."""
    return _set_claim(uid, "role", "researcher", granted=granted)


def _set_admin_claim(uid: str, *, granted: bool) -> dict:
    """Grant/revoke ``admin:true`` — the claim `firestore.rules::isAdmin`
    reads (P4.4).

    This is the platform-admin bit for DIRECT client-SDK Firestore access,
    and it is a different gate from the one protecting these endpoints:
    ``/api/admin/*`` is guarded by the service-account allowlist, so a
    person holding this claim cannot use it to reach this route. Granting
    it is deliberately a two-key operation.
    """
    return _set_claim(uid, "admin", True, granted=granted)


@router.post(
    "/grant-researcher",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
        404: {"description": "No Firebase user with that uid"},
    },
)
def grant_researcher(body: ResearcherClaimRequest, request: Request) -> dict[str, Any]:
    """Grant the ``role:researcher`` custom claim to a Firebase user.

    Admin-only (SA allowlist). The claim layers on top of teacher
    identity and grants cross-class READ access (see
    ``analytics.auth.assert_can_read_class``). Idempotent — granting an
    existing researcher re-asserts the claim and preserves other claims.
    """
    caller_email = _assert_caller_is_service_account(request)
    try:
        claims = _set_researcher_claim(body.uid, granted=True)
    except fb_auth.UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"No Firebase user with uid {body.uid}") from exc
    logger.info("admin.grant_researcher: uid=%s by %s", body.uid, caller_email)
    return {"uid": body.uid, "role": "researcher", "claims": claims}


@router.post(
    "/revoke-researcher",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
        404: {"description": "No Firebase user with that uid"},
    },
)
def revoke_researcher(body: ResearcherClaimRequest, request: Request) -> dict[str, Any]:
    """Remove the ``role:researcher`` custom claim from a Firebase user.

    Admin-only. Idempotent — revoking a non-researcher is a no-op that
    preserves other claims. Takes effect on the user's next token refresh.
    """
    caller_email = _assert_caller_is_service_account(request)
    try:
        claims = _set_researcher_claim(body.uid, granted=False)
    except fb_auth.UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"No Firebase user with uid {body.uid}") from exc
    logger.info("admin.revoke_researcher: uid=%s by %s", body.uid, caller_email)
    return {"uid": body.uid, "role": None, "claims": claims}


class AdminClaimRequest(BaseModel):
    """Body for grant/revoke-admin (P4.4).

    ``uid`` is the Firebase Auth UID of the target user. The claim takes
    effect on that user's NEXT ID-token refresh (~1h), which matters more
    here than for the researcher claim: until the token refreshes,
    `firestore.rules` still sees the old claim set.
    """

    uid: str


@router.post(
    "/grant-admin",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
        404: {"description": "No Firebase user with that uid"},
    },
)
def grant_admin(body: AdminClaimRequest, request: Request) -> dict[str, Any]:
    """Grant the ``admin:true`` custom claim to a Firebase user.

    This is what `firestore.rules::isAdmin` reads. Before P4.4 that
    function compared against one hardcoded email address, so "who is an
    admin" was a source-code edit and a rules deploy, and exactly one
    person could ever be one.

    Idempotent — re-granting re-asserts the claim and preserves other
    claims (a user can be both researcher and admin).
    """
    caller_email = _assert_caller_is_service_account(request)
    try:
        claims = _set_admin_claim(body.uid, granted=True)
    except fb_auth.UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"No Firebase user with uid {body.uid}") from exc
    logger.info("admin.grant_admin: uid=%s by %s", body.uid, caller_email)
    return {"uid": body.uid, "admin": True, "claims": claims}


@router.post(
    "/revoke-admin",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
        404: {"description": "No Firebase user with that uid"},
    },
)
def revoke_admin(body: AdminClaimRequest, request: Request) -> dict[str, Any]:
    """Remove the ``admin:true`` custom claim from a Firebase user.

    Admin-only. Idempotent, and preserves other claims — revoking admin
    from a researcher leaves them a researcher. Takes effect on the
    user's next token refresh.
    """
    caller_email = _assert_caller_is_service_account(request)
    try:
        claims = _set_admin_claim(body.uid, granted=False)
    except fb_auth.UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"No Firebase user with uid {body.uid}") from exc
    logger.info("admin.revoke_admin: uid=%s by %s", body.uid, caller_email)
    return {"uid": body.uid, "admin": False, "claims": claims}


class PrunePlatformSkillsRequest(BaseModel):
    """Body for ``POST /api/admin/prune-platform-skills``.

    Defaults to dry-run (``dry_run=True``) so the first call lists what
    would be deleted without actually deleting. Pass ``dry_run=false``
    to commit the deletion.
    """

    dry_run: bool = True


@router.post(
    "/prune-platform-skills",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
    },
)
def prune_platform_skills(body: PrunePlatformSkillsRequest, request: Request) -> dict[str, Any]:
    """Delete platform-owned Firestore skills whose template no longer
    exists on disk.

    Dry-run by default — returns the would-delete list without writing.
    Pass ``{"dry_run": false}`` to commit. Idempotent. Not auto-run by
    the deploy seeder; this is the explicit cleanup verb. Use after
    culling generic templates (the 2026-05-26 1.B follow-up removed
    7 inherited templates whose Firestore docs needed pruning).
    """
    caller_email = _assert_caller_is_service_account(request)
    result = platform_seed.prune(dry_run=body.dry_run)
    logger.info(
        "admin.prune_platform_skills: dry_run=%s pruned=%d kept=%d by %s",
        body.dry_run,
        len(result.get("pruned", [])),
        len(result.get("kept", [])),
        caller_email,
    )
    return result


class MintDemoGroupRequest(BaseModel):
    """AIPLA admin path for minting an anonymous-group code without a
    Firebase teacher session, used to wire up the Jutland v0.1 + ongoing
    demos before UCPH SSO ships in 1.6.

    Two modes:
      * ``code`` omitted → mints a fresh random code each call. Used by
        ad-hoc "give me a code now" ops requests.
      * ``code`` provided → idempotent upsert. If the code exists, the
        TTL is extended to ``now + ttl_days * 86400`` and other fields
        are preserved. If missing, the code is created. Used by the
        cloudbuild deploy step that guarantees a known set of demo
        codes (``aipla-demo-1`` / ``aipla-demo-2`` / ...) is always
        live for the next school year (~300 days).
    """

    skill_name: str = "problem-set-hints"
    title: str = "jutland-demo-v01"
    ttl_days: int = DEFAULT_GROUP_CODE_TTL_DAYS
    max_concurrent_sessions: int = 100
    # 2026-05-25 — explicit code = idempotent upsert path.
    code: str | None = None


@router.post(
    "/mint-demo-group",
    responses={
        404: {"description": "Skill not found — has the platform-seed step run?"},
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
    },
)
def mint_demo_group(body: MintDemoGroupRequest, request: Request) -> dict[str, Any]:
    """Mint a fresh anonymous-group code for the demo.

    Called by ops after a fresh deploy to seed a known group code into
    the in-memory `_state.groups` of the always-on Cloud Run container
    (Cloud Run pinned to min-instances=1 / max-instances=1 to keep
    state alive across requests).

    AIPLA v0.1 only — replace with proper teacher-session-backed group
    creation in v1.0.0-pilot per ADR-001 teacher-auth half. Each call
    mints a NEW code; ops captures it and shares with the demo team.

    Returns: {"code": "...", "expires_at": ..., "skill_id": "..."}
    """
    caller_email = _assert_caller_is_service_account(request)

    # Find the skill by name. list_skills() has no name filter, so
    # we filter in Python — fine here since the marketplace is small
    # (~10 skills in v0.1) and this is a once-per-deploy admin call.
    matches = [s for s in list_skills(limit=200) if s.name == body.skill_name]
    if not matches:
        raise HTTPException(
            status_code=404,
            detail=f"Skill '{body.skill_name}' not found — has the seed step run?",
        )
    skill = matches[0]

    if body.code:
        # Idempotent path — caller asked for a specific code. Extends
        # TTL on existing; creates fresh otherwise.
        record, created = upsert_group(
            code=body.code,
            title=body.title,
            skill_ids=[skill.skill_id],
            creator_uid=f"admin:{caller_email}",
            ttl_days=body.ttl_days,
            max_concurrent_sessions=body.max_concurrent_sessions,
        )
        logger.info(
            "admin.mint_demo_group: %s group=%s skill=%s ttl_days=%d by %s",
            "created" if created else "extended",
            record.group_id,
            body.skill_name,
            body.ttl_days,
            caller_email,
        )
        return {
            "code": record.group_id,
            "expires_at": record.expires_at,
            "skill_id": skill.skill_id,
            "title": record.title,
            "created": created,
        }

    record = create_group(
        title=body.title,
        skill_ids=[skill.skill_id],
        creator_uid=f"admin:{caller_email}",
        ttl_days=body.ttl_days,
        max_concurrent_sessions=body.max_concurrent_sessions,
    )
    logger.info(
        "admin.mint_demo_group: minted group_id=%s for skill=%s by %s",
        record.group_id,
        body.skill_name,
        caller_email,
    )
    return {
        "code": record.group_id,
        "expires_at": record.expires_at,
        "skill_id": skill.skill_id,
        "title": record.title,
        "created": True,
    }


# ─── Access register (ACCESS-1 M1) ───────────────────────────────────────────
#
# The register that decides who may spend money. SA-allowlisted like every other
# route in this module — there is deliberately no in-product admin UI, because
# the only route from visitor to pilot should be a human granting it.


class AccessGrantRequest(BaseModel):
    """Invite one named person. Email, not uid: the whole point is to authorise
    someone BEFORE they have ever signed in."""

    email: str
    tier: str = "pilot"
    monthly_cap_usd: float | None = None
    expires_at: str | None = None
    note: str = ""


class AccessRevokeRequest(BaseModel):
    email: str


def _sync_access_claim(email: str, tier: str) -> str | None:
    """Push the register's answer into the Firebase custom claim, if we can.

    Returns the uid whose claim was updated, or ``None`` when the person has
    never signed in (no Firebase user yet). That is the normal case for a fresh
    invite and is NOT an error: ``POST /api/teacher/bootstrap`` reconciles the
    claim on their first app load.

    Merges rather than replaces — ``set_custom_user_claims`` overwrites the whole
    blob, so a naive write here would silently un-researcher a researcher.
    """
    try:
        fb_user = fb_auth.get_user_by_email(email)
    except fb_auth.UserNotFoundError:
        return None
    except Exception:
        logger.warning("admin.access: could not look up %s in Firebase", email, exc_info=True)
        return None

    claims = dict(fb_user.custom_claims or {})
    claims["accessTier"] = tier
    fb_auth.set_custom_user_claims(fb_user.uid, claims)

    # Stamp the uid onto the register HERE, where we have just resolved it. The
    # spend gates join register-to-caller by uid, and this is the one moment an
    # email and a uid are both in hand. Leaving it to the bootstrap route's
    # tier-drift branch meant it never ran for anyone granted while already
    # signed in — see `db.teacher_access.grant_for_uid`.
    try:
        from db.teacher_access import stamp_uid

        stamp_uid(email, fb_user.uid)
    except Exception:
        logger.warning("admin.access: could not stamp uid for %s", email, exc_info=True)

    return fb_user.uid


@router.post(
    "/access/grant",
    responses={403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"}},
)
def access_grant(body: AccessGrantRequest, request: Request) -> dict[str, Any]:
    """Add (or re-add) an email to the access register.

    Idempotent, and doubles as un-revoke. The claim is pushed immediately when
    the person already has a Firebase account; otherwise their first app load
    picks it up.
    """
    from db.teacher_access import DEFAULT_MONTHLY_CAP_USD, grant_access
    from db.teacher_access import normalise_email as _norm

    caller_email = _assert_caller_is_service_account(request)
    try:
        grant = grant_access(
            body.email,
            tier=body.tier,  # type: ignore[arg-type]
            monthly_cap_usd=(body.monthly_cap_usd if body.monthly_cap_usd is not None else DEFAULT_MONTHLY_CAP_USD),
            granted_by=caller_email,
            expires_at=body.expires_at,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    uid = _sync_access_claim(_norm(body.email), grant.tier)
    _invalidate_spend_cache()
    # Close the loop: if this person asked, mark their request granted so the
    # queue drains as grants are issued rather than needing separate upkeep.
    if uid:
        try:
            from db.access_requests import mark_decided

            mark_decided(uid, status="granted", decided_by=caller_email)
        except Exception:
            logger.debug("admin.access_grant: could not close the access request", exc_info=True)
    logger.info("admin.access_grant: email=%s tier=%s by=%s uid=%s", grant.email, grant.tier, caller_email, uid or "-")
    return {
        "email": grant.email,
        "tier": grant.tier,
        "monthlyCapUsd": grant.monthly_cap_usd,
        "expiresAt": grant.expires_at,
        "claimSyncedUid": uid,
        "note": grant.note,
    }


@router.post(
    "/access/revoke",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
        404: {"description": "Email is not on the register"},
    },
)
def access_revoke(body: AccessRevokeRequest, request: Request) -> dict[str, Any]:
    """Revoke spend authority and drop outstanding sessions immediately.

    The custom claim can be up to an hour stale, so revoking the register row
    alone would leave a revoked teacher spending for the rest of the token's
    life. ``revoke_refresh_tokens`` closes that window: the next token refresh
    fails and the client must re-authenticate, picking up the visitor claim.
    """
    from db.teacher_access import normalise_email as _norm
    from db.teacher_access import revoke_access

    caller_email = _assert_caller_is_service_account(request)
    email = _norm(body.email)
    if not revoke_access(email, revoked_by=caller_email):
        raise HTTPException(status_code=404, detail=f"{email} is not on the access register")

    uid = _sync_access_claim(email, "visitor")
    if uid:
        try:
            fb_auth.revoke_refresh_tokens(uid)
        except Exception:
            logger.warning("admin.access_revoke: could not revoke refresh tokens for uid=%s", uid, exc_info=True)
    _invalidate_spend_cache()
    logger.info("admin.access_revoke: email=%s by=%s uid=%s", email, caller_email, uid or "-")
    return {"email": email, "tier": "visitor", "revoked": True, "claimSyncedUid": uid}


@router.get(
    "/access/list",
    responses={403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"}},
)
def access_list(request: Request, include_revoked: bool = False) -> dict[str, Any]:
    """Everyone on the register, newest grant first."""
    from db.teacher_access import list_grants

    _assert_caller_is_service_account(request)
    grants = list_grants(include_revoked=include_revoked)
    return {
        "count": len(grants),
        "grants": [
            {
                "email": g.email,
                "tier": g.tier,
                "monthlyCapUsd": g.monthly_cap_usd,
                "grantedBy": g.granted_by,
                "grantedAt": g.granted_at,
                "expiresAt": g.expires_at,
                "active": g.is_active,
                "revoked": g.revoked,
                "uid": g.uid,
                "note": g.note,
            }
            for g in grants
        ],
    }


class PasswordInviteRequest(BaseModel):
    """Body for ``POST /api/admin/access/password-invite``.

    For teachers whose institution has no Google identity (e.g. a Microsoft 365
    tenant), so "Sign in with Google" can never return their address.
    """

    email: str
    display_name: str | None = None
    continue_url: str | None = None


@router.post(
    "/access/password-invite",
    responses={
        403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"},
        404: {"description": "Email has no active grant on the access register"},
    },
)
def access_password_invite(body: PasswordInviteRequest, request: Request) -> dict[str, Any]:
    """Mint an email/password account and return a link for them to SET the password.

    The reason this exists: sign-in is Google, but some pilot schools run a
    Microsoft tenant, so Google can never return their institutional address.
    Email/password sign-in is enabled and the app has a form for it
    (``/teacher/sign-in``), but there is no signup, no forgot-password and no
    change-password UI anywhere — so without this there is no way for such a
    teacher to obtain a credential at all.

    **No password is ever returned, logged, or transmitted.** The account is
    created with a throwaway random secret that nobody ever learns, and the
    caller gets a Firebase-hosted reset link to forward; the teacher chooses
    their own password on Google's page. Handing out a password you then have to
    send over some channel is the thing this endpoint exists to avoid.

    Gated on the access register: minting a credential is only allowed for an
    address someone already invited, so a typo cannot conjure an account for an
    address nobody vetted. Grant first, then invite.

    Idempotent, and doubles as "they lost the link" — these links are
    short-lived, so re-run it when the teacher is actually ready rather than
    minting one in advance. On an account that already exists (including a
    Google-only one) no user is created; the link then lets them ADD a password
    to the identity they already have, which is why ``providers`` is reported
    back: it says what you are about to change.
    """
    from db.teacher_access import get_grant
    from db.teacher_access import normalise_email as _norm

    caller_email = _assert_caller_is_service_account(request)
    email = _norm(body.email)
    if not email:
        raise HTTPException(status_code=400, detail="email is required")

    grant = get_grant(email)
    if grant is None or not grant.is_active:
        raise HTTPException(
            status_code=404,
            detail=(
                f"{email} has no active grant on the access register. "
                f"Run `users grant-access {email}` first — a credential is only "
                "minted for an address that was already invited."
            ),
        )

    created = False
    try:
        fb_user = fb_auth.get_user_by_email(email)
    except fb_auth.UserNotFoundError:
        fb_user = fb_auth.create_user(
            email=email,
            # Never surfaced anywhere. The reset link is the only way in, so this
            # value is unguessable and then deliberately forgotten.
            password=secrets.token_urlsafe(32),
            display_name=body.display_name or None,
            email_verified=False,
        )
        created = True

    providers = sorted({p.provider_id for p in (fb_user.provider_data or [])})

    settings = None
    if body.continue_url:
        # Lands them back on the sign-in form after they set a password. The
        # domain must be in Firebase's authorizedDomains or this raises.
        settings = fb_auth.ActionCodeSettings(url=body.continue_url)
    try:
        link = fb_auth.generate_password_reset_link(email, action_code_settings=settings)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"could not generate a password reset link: {exc}") from exc

    # A freshly created uid has no claim yet, and bootstrap would only fix that
    # on first load — which is AFTER they need the tier to do anything useful.
    uid = _sync_access_claim(email, grant.tier)
    logger.info(
        "admin.access_password_invite: email=%s uid=%s created=%s providers=%s by=%s",
        email,
        fb_user.uid,
        created,
        ",".join(providers) or "-",
        caller_email,
    )
    return {
        "email": email,
        "uid": fb_user.uid,
        "created": created,
        "providers": providers,
        "tier": grant.tier,
        "claimSyncedUid": uid,
        "resetLink": link,
    }


def _invalidate_spend_cache() -> None:
    """Drop the in-process spend-authority memo after a register write.

    Only clears THIS container's cache — other Cloud Run instances keep theirs
    until the TTL expires (60s). That bound is the reason revoke also kills
    refresh tokens rather than relying on this.
    """
    try:
        from auth.spend_authority import clear_cache

        clear_cache()
    except Exception:
        logger.debug("admin.access: spend-authority cache clear failed", exc_info=True)


@router.get(
    "/access/requests",
    responses={403: {"description": "Caller is not in ADMIN_SEED_ALLOWED_SAS"}},
)
def access_requests(request: Request, status: str = "pending") -> dict[str, Any]:
    """The queue of people asking to join the programme (ACCESS-1 M4).

    ``status=all`` returns every state; otherwise pending/granted/declined.
    """
    from db.access_requests import list_access_requests

    _assert_caller_is_service_account(request)
    wanted = None if status == "all" else status
    requests = list_access_requests(status=wanted)  # type: ignore[arg-type]
    return {
        "count": len(requests),
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
