"""FastAPI router for /api/admin/* endpoints.

Admin routes are gated by `_assert_caller_is_service_account` (Google
ID token + SA email allowlist). Never expose these to end users — they
exist to support Cloud Build deploy hooks and ops runbooks.
"""

from __future__ import annotations

import logging
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


def _set_researcher_claim(uid: str, *, granted: bool) -> dict:
    """Merge (grant) or strip (revoke) the ``role:researcher`` custom
    claim WITHOUT clobbering other claims (e.g. ``groupTags``).

    set_custom_user_claims OVERWRITES the entire claim set, so we read
    the existing claims first and merge. Returns the resulting claim dict.
    """
    existing = fb_auth.get_user(uid).custom_claims or {}
    new_claims = dict(existing)
    if granted:
        new_claims["role"] = "researcher"
    elif new_claims.get("role") == "researcher":
        # Only strip the key we own; leave any future non-researcher role.
        del new_claims["role"]
    fb_auth.set_custom_user_claims(uid, new_claims or None)
    return new_claims


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
