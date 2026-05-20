"""FastAPI router for /api/admin/* endpoints.

Admin routes are gated by `_assert_caller_is_service_account` (Google
ID token + SA email allowlist). Never expose these to end users — they
exist to support Cloud Build deploy hooks and ops runbooks.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from admin import platform_seed
from admin.auth import _assert_caller_is_service_account
from auth.group_id_auth import create_group
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


class MintDemoGroupRequest(BaseModel):
    """AIPLA v0.1 — admin path for minting an anonymous-group code without
    a Firebase teacher session, used to wire up the Jutland demo before
    UCPH SSO ships in 1.6.

    The created group's code is stable across hits (same skill_name +
    title returns the same group if one still exists), so callers can
    rerun this safely.
    """

    skill_name: str = "problem-set-hints"
    title: str = "jutland-demo-v01"
    ttl_days: int = 30
    max_concurrent_sessions: int = 100


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
    }
