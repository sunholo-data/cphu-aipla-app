"""REST API for ChatSessionIndex management.

Endpoints (all authenticated):
  GET    /api/documents/{docId}/sessions   list sessions for a document
  GET    /api/sessions/{sessionId}         get one session's metadata
  PATCH  /api/sessions/{sessionId}         rename / re-scope / archive (owner)
  DELETE /api/sessions/{sessionId}         soft-delete (owner)

No fork endpoint — deferred to v6.1 (no channel consumers yet).
No idempotency ledger — deferred to v6.1.

Non-owner reads return 403 rather than 404 for sessions (unlike skills
which use 404 to avoid leaking existence). Chat session IDs come from
Agent Engine and are not guessable from the outside.
"""

from __future__ import annotations

from datetime import UTC
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from adk.agui import APP_NAME
from adk.session import get_session_service
from auth import User, get_current_user
from db.chat_sessions import (
    SessionFilter,
    get_session_index,
    list_sessions_for_document,
    soft_delete_session,
    update_session_fields,
)
from db.models.access import AccessControl
from db.models.chat_session import ChatSessionIndex

router = APIRouter(prefix="/api", tags=["sessions"])


def get_messages_session_service():
    """Return the shared session service singleton for reading message history."""
    return get_session_service()


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    timestamp: float


class InteractionEvent(BaseModel):
    """A restored MCP-app interaction (1.1.34).

    Surfaced from the ADK ``state_delta`` events the iframe-context push
    already persists, so a resumed transcript can re-render the student's
    sim interactions ("Sendte spørgsmål med …") in place — not just the
    tutor's reaction. ``label`` is the human-readable card text (the client
    label, stored at push time, else a generic fallback)."""

    label: str
    timestamp: float
    server_id: str | None = None
    tool_name: str | None = None


class GetSessionMessagesResponse(BaseModel):
    messages: list[ChatMessage]
    session_id: str
    # 1.1.34: MCP-app interactions interleaved into the transcript on restore.
    # Default empty so existing clients (and text-only sessions) are unaffected.
    interactions: list[InteractionEvent] = []
    interactions_truncated: bool = False


class ChatSessionSummary(BaseModel):
    session_id: str
    document_ids: list[str]
    skill_id: str
    owner_uid: str
    access_control: dict[str, Any]
    title: str | None
    turn_count: int
    first_message_at: str
    last_message_at: str
    archived_at: str | None
    is_owner: bool
    can_fork: bool


class ListSessionsResponse(BaseModel):
    sessions: list[ChatSessionSummary]
    next_cursor: str | None


class GetSessionResponse(BaseModel):
    session: ChatSessionSummary


class PatchSessionRequest(BaseModel):
    title: str | None = None
    access_control: dict[str, Any] | None = None
    archived: bool | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _to_summary(idx: ChatSessionIndex, viewer_uid: str) -> ChatSessionSummary:
    return ChatSessionSummary(
        session_id=idx.session_id,
        document_ids=list(idx.document_ids),
        skill_id=idx.skill_id,
        owner_uid=idx.owner_uid,
        access_control=idx.access_control.model_dump(exclude_none=True),
        title=idx.title,
        turn_count=idx.turn_count,
        first_message_at=idx.first_message_at.isoformat(),
        last_message_at=idx.last_message_at.isoformat(),
        archived_at=idx.archived_at.isoformat() if idx.archived_at else None,
        is_owner=(idx.owner_uid == viewer_uid),
        can_fork=(idx.archived_at is None),
    )


def _events_to_messages(events: list) -> list[ChatMessage]:
    """Extract user/assistant text messages from ADK session events.

    Skips events with no content (tool calls, system events, empty turns).
    Joins multi-part content parts with a space.
    """
    messages: list[ChatMessage] = []
    for e in events:
        if not e.content or not e.content.parts:
            continue
        text = " ".join(p.text for p in e.content.parts if p.text).strip()
        if not text:
            continue
        role: Literal["user", "assistant"] = "user" if e.author == "user" else "assistant"
        messages.append(ChatMessage(role=role, content=text, timestamp=e.timestamp))
    return messages


# 1.1.34 — MCP-app interaction restore. The iframe-context push writes each
# sim interaction as an ADK state_delta event keyed under
# ``mcp_app_context.{server}.{tool}`` (see iframe_context_routes); ADK retains
# those events for the session lifetime. We surface them here so the resumed
# transcript can re-render the human-tool-use cards. Mirrored literal (not an
# import) to avoid coupling the read path to the write module.
_MCP_CONTEXT_PREFIX = "mcp_app_context."
_MAX_INTERACTIONS = 200
_GENERIC_INTERACTION_LABEL = "Interaktion med simuleringen"


def _interaction_label(state_value: dict) -> str:
    """Human-readable card text for a restored interaction.

    Prefers the client-computed label stored at push time (``_label``); falls
    back to the ``structuredContent.changed`` hint, then a generic Danish
    label. Capped to match the write-side label cap."""
    label = state_value.get("_label")
    if isinstance(label, str) and label.strip():
        return label.strip()[:200]
    sc = state_value.get("structuredContent")
    if isinstance(sc, dict):
        changed = sc.get("changed")
        if isinstance(changed, list) and changed:
            return f"Interaktion: {', '.join(str(c) for c in changed)}"[:200]
        if isinstance(changed, str) and changed.strip():
            return f"Interaktion: {changed.strip()}"[:200]
    return _GENERIC_INTERACTION_LABEL


def _events_to_interactions(events: list) -> tuple[list[InteractionEvent], bool]:
    """Extract MCP-app interaction events from ADK session events.

    Selects events carrying a ``state_delta`` dict with an ``mcp_app_context.*``
    key (the iframe-context push). Coalesces runs of consecutive identical
    ``(label, server, tool)`` (a slider "settle" emits several), then caps to
    the most-recent ``_MAX_INTERACTIONS`` — returning ``truncated=True`` when
    older ones were dropped (no silent cap). Tolerant of non-interaction events
    (text turns, tool calls) — the caller passes the SAME event list to both
    this and ``_events_to_messages``."""
    raw: list[InteractionEvent] = []
    for e in events:
        actions = getattr(e, "actions", None)
        state_delta = getattr(actions, "state_delta", None) if actions is not None else None
        if not isinstance(state_delta, dict) or not state_delta:
            continue
        for key, value in state_delta.items():
            if not isinstance(key, str) or not key.startswith(_MCP_CONTEXT_PREFIX):
                continue
            if not isinstance(value, dict):
                continue
            server_id, _, tool_name = key[len(_MCP_CONTEXT_PREFIX) :].partition(".")
            ts = getattr(e, "timestamp", None)
            if ts is None:
                ts = value.get("_pushedAt", 0.0)
            raw.append(
                InteractionEvent(
                    label=_interaction_label(value),
                    timestamp=float(ts),
                    server_id=server_id or None,
                    tool_name=tool_name or None,
                )
            )

    raw.sort(key=lambda i: i.timestamp)

    coalesced: list[InteractionEvent] = []
    for it in raw:
        prev = coalesced[-1] if coalesced else None
        if (
            prev is not None
            and prev.label == it.label
            and prev.server_id == it.server_id
            and prev.tool_name == it.tool_name
        ):
            continue
        coalesced.append(it)

    truncated = len(coalesced) > _MAX_INTERACTIONS
    if truncated:
        coalesced = coalesced[-_MAX_INTERACTIONS:]
    return coalesced, truncated


def _require_session(session_id: str) -> ChatSessionIndex:
    idx = get_session_index(session_id)
    if idx is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return idx


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/documents/{doc_id}/sessions", response_model=ListSessionsResponse)
async def list_document_sessions(
    doc_id: str,
    request: Request,
    filter: Annotated[SessionFilter, Query()] = "all",
    cursor: str | None = Query(default=None),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),  # noqa: B008
) -> ListSessionsResponse:
    """List non-archived sessions for a document, filtered by viewer access.

    - filter=mine: only sessions owned by the caller
    - filter=team: sessions the caller can see via tag intersection (not own)
    - filter=all:  union (default)

    Returns 200 with an empty list when the viewer has no accessible sessions
    (never 403 — the document itself may be accessible without any sessions).

    Note: there is no separate document-level access check here. ParsedDocument
    has no AccessControl block, so the gate is entirely at the session level:
    list_sessions_for_document filters results to sessions the caller can access.
    A caller supplying a foreign doc_id gets an empty list, not a 403.
    """
    ctx = request.state.access
    sessions, next_cursor = list_sessions_for_document(doc_id, ctx, filter=filter, page_size=page_size, cursor=cursor)
    return ListSessionsResponse(
        sessions=[_to_summary(s, ctx.uid) for s in sessions],
        next_cursor=next_cursor,
    )


@router.get("/sessions/{session_id}", response_model=GetSessionResponse)
async def get_session(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> GetSessionResponse:
    """Return metadata for a single session.

    Returns 403 when the caller cannot access the session (session IDs are
    not guessable so 403 is safe here — no existence leak).
    """
    idx = _require_session(session_id)
    ctx = request.state.access
    if not ctx.can_access(idx):
        raise HTTPException(status_code=403, detail="Access denied")
    return GetSessionResponse(session=_to_summary(idx, ctx.uid))


@router.patch("/sessions/{session_id}", response_model=GetSessionResponse)
async def patch_session(
    session_id: str,
    body: PatchSessionRequest,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> GetSessionResponse:
    """Rename, re-scope, or archive a session. Owner-only."""
    idx = _require_session(session_id)
    ctx = request.state.access

    if not ctx.can_access(idx):
        raise HTTPException(status_code=403, detail="Access denied")
    if not ctx.is_owner(idx):
        raise HTTPException(status_code=403, detail="Only the session owner can modify it")

    fields: dict[str, Any] = {}
    if body.title is not None:
        fields["title"] = body.title
    if body.access_control is not None:
        try:
            AccessControl.model_validate(body.access_control)
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Invalid accessControl: {exc}") from exc
        fields["accessControl"] = body.access_control
    if body.archived is True and idx.archived_at is None:
        from datetime import datetime

        fields["archivedAt"] = datetime.now(UTC).isoformat()
    elif body.archived is False:
        fields["archivedAt"] = None

    if fields:
        update_session_fields(session_id, fields)

    updated = get_session_index(session_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Session not found after update")
    return GetSessionResponse(session=_to_summary(updated, ctx.uid))


@router.get("/sessions/{session_id}/messages", response_model=GetSessionMessagesResponse)
async def get_session_messages(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> GetSessionMessagesResponse:
    """Return the full message history for a session.

    Access policy (chat-history-deep-fixes-2 / 1.15 Bug E): aligned with the
    metadata read at ``GET /api/sessions/{id}`` — the caller must
    ``ctx.can_access(idx)``. A non-owner with valid access (public, domain,
    same-tag, or specific-allow) reads the events Vertex stored under the
    OWNER's user_id; the route always queries Vertex with ``idx.owner_uid``
    regardless of caller. Sharing means reading the owner's events, not
    attributing them to the reader. PATCH and DELETE remain owner-only.

    Returns 403 (not 404) consistently — session IDs are random UUIDs, not
    guessable, so 403 is safe and avoids an existence-leak edge case.
    """
    idx = _require_session(session_id)
    ctx = request.state.access
    if not ctx.can_access(idx):
        raise HTTPException(status_code=403, detail="Access denied")

    session_service = get_messages_session_service()
    session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=idx.owner_uid,
        session_id=session_id,
    )
    events = session.events if session is not None else []
    interactions, interactions_truncated = _events_to_interactions(events)
    return GetSessionMessagesResponse(
        messages=_events_to_messages(events),
        session_id=session_id,
        interactions=interactions,
        interactions_truncated=interactions_truncated,
    )


@router.get("/sessions/{session_id}/state")
async def get_session_state(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Return the raw ADK session state for SESSION_ID.

    Owner-only — session state can include sensitive fields (loaded
    document IDs, iframe-pushed model context, internal app:* keys),
    so this is NOT shared via the same can_access policy as
    /messages. The CLI's ``aiplatform sessions inspect`` uses this
    endpoint to debug iframe→agent context flow (sprint 1.25).

    Returns the state dict verbatim. Empty dict if the ADK session
    hasn't been created yet (which can happen for a freshly-indexed
    session that hasn't received its first message).
    """
    idx = _require_session(session_id)
    ctx = request.state.access
    if not ctx.is_owner(idx):
        raise HTTPException(
            status_code=403,
            detail="Only the session owner can inspect session state",
        )

    # ADK sessions are keyed by ("aitana_platform", user_id, session_id) —
    # build_agui_adk_agent passes the canonical APP_NAME, NOT the skill_id.
    # Mirror the fix already in iframe_context_routes.py / sessions_route
    # /messages — without this, the CLI's `sessions inspect --mcp-context`
    # always returned {} because the lookup missed every time.
    session_service = get_session_service()
    session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=idx.owner_uid,
        session_id=session_id,
    )
    if session is None:
        return {}
    return dict(session.state) if session.state else {}


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> None:
    """Soft-delete a session (sets archivedAt). Owner-only."""
    idx = _require_session(session_id)
    ctx = request.state.access

    if not ctx.can_access(idx):
        raise HTTPException(status_code=403, detail="Access denied")
    if not ctx.is_owner(idx):
        raise HTTPException(status_code=403, detail="Only the session owner can delete it")

    soft_delete_session(session_id)
