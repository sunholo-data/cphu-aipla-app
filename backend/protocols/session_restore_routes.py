"""Session restore endpoint (sprint 1.F M3).

POST /api/sessions/{id}/restore

Called by the frontend immediately after a re-join (when the group-join
response carries a non-null resumedSessionId).  Returns:

  messages        — last 50 text turns, oldest-first
  olderTurnsSummary — null in v1; reserved for a future one-shot summary
  workbenchState  — the ADK session state dict (mcp_app_context.* keys)
                    which StaticArtefactFrame uses to send aipla:restore
                    to the artefact

Auth: same can_access() check as GET /api/sessions/{id}/messages.
Archived sessions (teacher-reset) return 404 so the frontend falls back
to a clean session.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from adk.agui import APP_NAME
from adk.session import get_session_service
from auth import User, get_current_user
from db.chat_sessions import get_session_index

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["session-restore"])

_MESSAGE_CAP = 50


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class RestoredMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    timestamp: float


class SessionRestoreResponse(BaseModel):
    messages: list[RestoredMessage]
    olderTurnsSummary: str | None = None
    workbenchState: dict[str, Any]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _events_to_messages(events: list, cap: int = _MESSAGE_CAP) -> list[RestoredMessage]:
    """Extract the last *cap* user/assistant text turns, oldest-first."""
    messages: list[RestoredMessage] = []
    for e in events:
        if not e.content or not e.content.parts:
            continue
        text = " ".join(p.text for p in e.content.parts if p.text).strip()
        if not text:
            continue
        role: Literal["user", "assistant"] = "user" if e.author == "user" else "assistant"
        messages.append(RestoredMessage(role=role, content=text, timestamp=e.timestamp))
    return messages[-cap:]


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post("/{session_id}/restore", response_model=SessionRestoreResponse)
async def post_session_restore(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> SessionRestoreResponse:
    """Restore a prior session for a re-joining student.

    Returns the last 50 messages and the full workbench state (ADK session
    state dict) so the frontend can reconstruct both the chat history and
    the artefact's slider/parameter values.

    Returns 404 when:
      - the session index does not exist
      - the session has been archived (teacher reset)

    Returns 403 when the caller cannot access the session (wrong group or
    insufficient permission).
    """
    idx = get_session_index(session_id)
    if idx is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if idx.archived_at is not None:
        raise HTTPException(status_code=404, detail="Session has been reset")

    ctx = request.state.access
    if not ctx.can_access(idx):
        raise HTTPException(status_code=403, detail="Access denied")

    session_service = get_session_service()
    session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=idx.owner_uid,
        session_id=session_id,
    )

    if session is None:
        log.debug("session_restore: no ADK session yet for %s — returning empty", session_id)
        return SessionRestoreResponse(messages=[], workbenchState={})

    messages = _events_to_messages(session.events)
    workbench_state = dict(session.state) if session.state else {}

    log.info(
        "session_restore: uid=%s session=%s msgs=%d state_keys=%d",
        user.uid,
        session_id,
        len(messages),
        len(workbench_state),
    )
    return SessionRestoreResponse(
        messages=messages,
        workbenchState=workbench_state,
    )


__all__ = ["router"]
