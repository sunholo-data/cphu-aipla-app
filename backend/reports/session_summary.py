"""Session-summary aggregator — turns an ADK session into a teacher report.

Phase 2 (1.G-Ph2) scope: reads directly from ADK session events + the
``ChatSessionIndex`` Firestore row. Post-1.2 a BigQuery-backed
implementation will replace ``summarize_session`` while preserving the
``SessionSummary`` Pydantic shape so the reports route doesn't change.

Group → session resolution: anonymous-group sessions have
``owner_uid = "anon-{group_code}-{random_hex}"`` (see
``auth/group_id_auth.py``). ``find_latest_session_for_group`` walks
``ChatSessionIndex`` rows whose ``ownerUid`` starts with that prefix
and returns the most recently active one.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from adk.agui import APP_NAME
from adk.session import get_session_service
from db.chat_sessions import get_session_index
from db.firestore import query_documents
from db.models.chat_session import ChatSessionIndex

log = logging.getLogger(__name__)


class SessionTurn(BaseModel):
    """A single user/assistant message in the report's conversation log."""

    timestamp: str  # ISO 8601
    role: Literal["student", "tutor"]
    content: str

    model_config = ConfigDict(populate_by_name=True)


class SessionSummary(BaseModel):
    """Aggregated report for one session. Matches the frontend's report shape."""

    session_id: str = Field(alias="sessionId")
    group_code: str | None = Field(alias="groupCode")
    activity_id: str = Field(alias="activityId")
    started_at: datetime = Field(alias="startedAt")
    ended_at: datetime | None = Field(default=None, alias="endedAt")
    duration_seconds: int = Field(alias="durationSeconds")
    message_count: int = Field(alias="messageCount")
    sim_run_count: int = Field(alias="simRunCount")
    conversation: list[SessionTurn]

    model_config = ConfigDict(populate_by_name=True)


def _group_code_from_owner_uid(owner_uid: str) -> str | None:
    """Reverse the ``anon-{group_code}-{random_hex}`` shape.

    Returns None for non-anonymous owners (Firebase / Google-auth
    teachers, workshop-user in LOCAL_MODE) since they don't represent a
    student group.
    """
    if not owner_uid.startswith("anon-"):
        return None
    body = owner_uid[len("anon-") :]
    # Drop the trailing -<hex> chunk. group_codes themselves contain
    # hyphens (e.g. "bold-kazoo-87"), so we take everything except the
    # last hyphen-segment.
    parts = body.rsplit("-", 1)
    if len(parts) != 2:
        return None
    return parts[0]


def _count_sim_runs(state: dict[str, Any]) -> int:
    """Count distinct sim runs from the final session state.

    Heuristic: an artefact iframe emits state writes under
    ``mcp_app_context.<server>.<tool>``. The number of distinct
    server/tool pairs is a reasonable proxy for "things the student
    actively manipulated in the workbench". Off by edge cases (a
    re-render of the same tool counts once) but good enough for the
    Wed 3 June demo. Replace with a proper event-tap in 1.2.
    """
    keys = [k for k in state if k.startswith("mcp_app_context.")]
    return len(set(keys))


async def summarize_session(session_id: str) -> SessionSummary | None:
    """Return a ``SessionSummary`` for ``session_id`` or ``None`` if missing.

    Reads the index row for metadata + the ADK session for events +
    state. The two reads happen against different stores
    (Firestore index row, ADK session service for events); both can
    legitimately return empty (the session was just created but hasn't
    seen a turn yet) — we degrade gracefully in that case.
    """
    idx = get_session_index(session_id)
    if idx is None:
        return None

    service = get_session_service()
    session = await service.get_session(app_name=APP_NAME, user_id=idx.owner_uid, session_id=session_id)

    conversation: list[SessionTurn] = []
    if session is not None and session.events:
        for event in session.events:
            if not event.content or not event.content.parts:
                continue
            text = " ".join(p.text for p in event.content.parts if p.text).strip()
            if not text:
                continue
            role: Literal["student", "tutor"] = "student" if event.author == "user" else "tutor"
            conversation.append(
                SessionTurn(
                    timestamp=datetime.fromtimestamp(event.timestamp).isoformat(),
                    role=role,
                    content=text,
                )
            )

    duration = max(
        0,
        int((idx.last_message_at - idx.first_message_at).total_seconds()),
    )
    sim_runs = _count_sim_runs(dict(session.state)) if session is not None and session.state else 0

    return SessionSummary(
        sessionId=idx.session_id,
        groupCode=_group_code_from_owner_uid(idx.owner_uid),
        activityId=idx.skill_id,
        startedAt=idx.first_message_at,
        endedAt=idx.archived_at,
        durationSeconds=duration,
        messageCount=len(conversation),
        simRunCount=sim_runs,
        conversation=conversation,
    )


def find_latest_session_for_group(group_code: str) -> ChatSessionIndex | None:
    """Return the most-recently-active session for an anonymous group.

    ``ownerUid`` follows the ``anon-{group_code}-{random_hex}`` shape;
    Firestore supports prefix matching with the ``[>=, <]`` range
    pattern. We then sort in Python by ``lastMessageAt`` so the query
    doesn't need a composite index.
    """
    lo = f"anon-{group_code}-"
    hi = lo + "￿"  # high-codepoint sentinel
    rows = query_documents(
        "chat_sessions",
        filters=[("ownerUid", ">=", lo), ("ownerUid", "<", hi)],
        limit=100,
    )
    if not rows:
        return None

    indexed: list[ChatSessionIndex] = []
    for row in rows:
        try:
            indexed.append(ChatSessionIndex(**row))
        except Exception:
            log.warning("find_latest_session_for_group: skipping malformed row")
    if not indexed:
        return None
    indexed.sort(key=lambda i: i.last_message_at, reverse=True)
    return indexed[0]


__all__ = [
    "SessionSummary",
    "SessionTurn",
    "find_latest_session_for_group",
    "summarize_session",
]
