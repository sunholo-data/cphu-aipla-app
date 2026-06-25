"""Session bootstrap endpoint — closes the 2026-05-21 iframe-context 404 race.

The problem (live evidence in `.dev-logs/backend.log` on 2026-05-21):
when a student opens a chat page, the frontend mints a session id client-side
and may push iframe-context (workspace clicks) BEFORE sending any chat
message. The ChatSessionIndex doc is created lazily in
``make_session_tracker.before_agent_callback`` — i.e. only after the first
agent turn runs — so every pre-first-turn iframe-context POST hits
``_require_session`` and gets a 404.

The fix: a tiny POST endpoint the frontend calls when ``useSkillAgent``
first sees a session id. Creates the index doc if missing, no-op if it
already exists. Existing ``before_agent_callback`` creation stays as a
backstop for the rare case where this endpoint isn't reached (e.g.
network blip before chat first turn). Belt and braces.

Auth (same gates as the iframe-context route):
  1. Firebase JWT required (``get_current_user``)
  2. Skill must exist (404 → 403 mapping: skill missing means a stale
     client; treat as access denied not 404 so attackers can't enumerate
     skill ids)
  3. Caller must be able to access the skill (the existing 5-type policy
     via ``AccessContext.can_access``). v0.1's anon-group users have a
     synthetic uid that matches the public/group access policies; this
     check is just hygiene.

Response: 204 (created or already-exists — idempotent). The frontend
fires-and-forgets; failures are non-fatal because the backstop catches
them at first-turn time.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from adk.agui import APP_NAME
from adk.session import get_session_service
from auth import User, get_current_user
from db.chat_sessions import create_session_index, get_session_index
from db.group_sessions import set_active_session_for_group
from skills import skill_config

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["session-bootstrap"])


class BootstrapRequest(BaseModel):
    """Body shape for ``POST /api/sessions/{id}/bootstrap``."""

    skill_id: str = Field(alias="skillId", min_length=1, max_length=128)
    # ALS-1: the activity this session belongs to, so the group's active-session
    # mapping is scoped per (group, activity) — each activity keeps its own thread.
    activity_id: str | None = Field(default=None, alias="activityId", max_length=128)

    model_config = {"populate_by_name": True, "extra": "forbid"}


@router.post("/{session_id}/bootstrap", status_code=204)
async def post_session_bootstrap(
    session_id: str,
    body: BootstrapRequest,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Pre-create the ChatSessionIndex for a session that hasn't seen its
    first agent turn yet. Idempotent — returns 204 whether or not the
    document already existed.

    See module docstring for why this exists.
    """
    # Skip the lookup entirely if it's already there. Saves a write.
    existing = get_session_index(session_id)
    if existing is not None:
        log.debug(
            "session_bootstrap: already exists uid=%s session=%s skill=%s",
            user.uid,
            session_id,
            existing.skill_id,
        )
        return None

    # Gate: skill must exist + caller must be able to access it.
    skill = skill_config.get_skill(body.skill_id)
    if skill is None:
        log.info(
            "session_bootstrap: skill not found uid=%s skill_id=%s",
            user.uid,
            body.skill_id,
        )
        raise HTTPException(status_code=403, detail="Access denied")

    ctx = request.state.access
    if not ctx.can_access(skill):
        log.info(
            "session_bootstrap: skill access denied uid=%s skill_id=%s",
            user.uid,
            body.skill_id,
        )
        raise HTTPException(status_code=403, detail="Access denied")

    # Create with the caller as owner. accessControl inherits from the
    # skill so workspace surfaces can read iframe-context off the same
    # gates. firstMessageAt / lastMessageAt are set to now by the helper;
    # turnCount stays 0 until before_agent_callback bumps it.
    create_session_index(
        session_id=session_id,
        skill_id=body.skill_id,
        owner_uid=user.uid,
        access_control=skill.access_control,
        document_ids=[],
    )

    # Register this session as the active one for the group (1.F). The
    # join endpoint reads it back on the next join and returns it as
    # resumedSessionId. Only written for anonymous-group users — Firebase
    # users have their own session persistence via ChatSessionIndex queries.
    if user.auth_mode == "anonymous_group_id" and user.group_id:
        set_active_session_for_group(user.group_id, session_id, activity_id=body.activity_id)

    # ALSO pre-create the ADK session under the canonical APP_NAME triple.
    # Without this, iframe-context POSTs that arrive before the agent's
    # first run still 404 on `session_service.get_session(...)` — the
    # Firestore index doc exists, but ADK has nothing to write state into.
    # Caught by scripts/smoke-workspace-context.sh on 2026-05-21.
    # InMemorySessionService.create_session is async; VertexAi's too.
    session_service = get_session_service()
    try:
        await session_service.create_session(
            app_name=APP_NAME,
            user_id=user.uid,
            session_id=session_id,
        )
    except Exception as exc:
        # Idempotency: if the ADK session already exists this can raise.
        # We tolerate that — both backends treat duplicate creates as
        # benign in our usage pattern. Log so regressions surface.
        log.info(
            "session_bootstrap: ADK create_session non-fatal exc uid=%s session=%s exc=%s",
            user.uid,
            session_id,
            exc,
        )

    log.info(
        "session_bootstrap: created uid=%s session=%s skill=%s",
        user.uid,
        session_id,
        body.skill_id,
    )
    return None


__all__ = ["router"]
