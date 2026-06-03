"""Session restore endpoint (sprint 1.F M3, extended QUICK-WINS-V11 M6).

POST /api/sessions/{id}/restore

Called by the frontend immediately after a re-join (when the group-join
response carries a non-null resumedSessionId).  Returns:

  messages        — last 50 text turns, oldest-first
  olderTurnsSummary — null in v1; reserved for a future one-shot summary
  workbenchState  — the ADK session state dict (mcp_app_context.* keys)
                    which StaticArtefactFrame uses to send aipla:restore
                    to the artefact

Auth: same can_access() check as GET /api/sessions/{id}/messages.

Two archival paths:

  * ``archived_at`` set but ``archived`` False — legacy teacher-reset
    path; returns 404 so the frontend silently falls back to a clean
    session. Preserved for back-compat with sessions archived before
    QUICK-WINS-V11.
  * ``archived`` True — explicit archive (group code expired or
    teacher revocation). Returns 410 Gone so the frontend can show a
    distinct "this code has expired" message rather than starting a
    fresh blank session.

When a restore is attempted against a session whose bound group code
has *just* expired (TTL elapsed), the route flips the index to
``archived=True`` as a side effect of the expiry detection — see
``_archive_expired_session`` below. Auth code stays pure; archival is
a side effect of the restore attempt, not of token verification.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from adk.agui import APP_NAME
from adk.session import get_session_service
from auth import User, get_current_user
from auth.group_id_auth import GroupExpired, _check_group_active, get_group
from db.chat_sessions import get_session_index, update_session_fields

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


def _archive_expired_session(session_id: str, idx) -> datetime:  # type: ignore[no-untyped-def]
    """Flip the ChatSessionIndex row to ``archived=True`` + ``archived_at=now``.

    Called from the restore-route exception handler when the bound
    group code's TTL has elapsed. Idempotent: if ``idx.archived`` is
    already True, return the existing ``archived_at`` without a second
    Firestore write — keeps the second-restore path cheap and avoids
    racing two writers on the same expired session.

    Returns the archive timestamp the caller should serialize back to
    the client (either pre-existing or newly minted).
    """
    if idx.archived:
        existing = idx.archived_at or datetime.now(UTC)
        return existing
    now = datetime.now(UTC)
    update_session_fields(
        session_id,
        {
            "archived": True,
            "archivedAt": now.isoformat(),
        },
    )
    log.info("session_restore: archived expired session=%s", session_id)
    return now


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
      - the session was legacy-archived without the ``archived`` flag
        (teacher-reset path, pre QUICK-WINS-V11)

    Returns 410 Gone when:
      - the session was already archived via ``archived=True`` (idempotent;
        no second Firestore write)
      - the session's bound group code's TTL elapsed; this call flips the
        session to ``archived=True`` as a side effect

    Returns 403 when the caller cannot access the session (wrong group or
    insufficient permission).
    """
    idx = get_session_index(session_id)
    if idx is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Explicit-archive path (QUICK-WINS-V11+): 410 with the archive ts.
    # Idempotent — already-archived sessions don't re-write.
    if idx.archived:
        archived_at = idx.archived_at or datetime.now(UTC)
        raise HTTPException(
            status_code=410,
            detail={
                "detail": "session archived",
                "archived_at": archived_at.isoformat(),
            },
        )

    # Legacy teacher-reset path: ``archived_at`` set without the new flag.
    # Preserved for back-compat — frontend treats 404 as "start clean".
    if idx.archived_at is not None:
        raise HTTPException(status_code=404, detail="Session has been reset")

    # Group-code TTL check. Only applies to anonymous-group sessions
    # (those with a non-null ``group_code``). Firebase/Google-auth
    # sessions skip this entirely.
    if idx.group_code:
        record = get_group(idx.group_code)
        if record is not None:
            try:
                _check_group_active(record)
            except GroupExpired:
                archived_at = _archive_expired_session(session_id, idx)
                raise HTTPException(
                    status_code=410,
                    detail={
                        "detail": "session archived",
                        "archived_at": archived_at.isoformat(),
                    },
                ) from None

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
