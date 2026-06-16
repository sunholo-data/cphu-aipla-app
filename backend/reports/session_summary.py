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


class WorkbenchEvent(BaseModel):
    """One iframe → host interaction (slider moved, value revealed, etc.).

    Sourced from the ``aipla_workbench_event`` BQ table populated by
    ``emit_workbench_event`` in the iframe-context endpoint.
    """

    timestamp: str  # ISO 8601
    server: str  # e.g. "boldkast", "kinebot", "led-planck"
    tool: str  # e.g. "state", "show_value"
    field: str  # what changed (or tool name if no specific field)
    value: str  # stringified value; complex payloads land as JSON

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
    workbench_events: list[WorkbenchEvent] = Field(default_factory=list, alias="workbenchEvents")
    narrative: str | None = Field(default=None)
    """1.1.4 — AI narrative summary (structured markdown). Attached by
    ``reports.narrative.resolve_narrative`` at the route layer; None until
    generated (or when there is no conversation to summarise)."""
    voice_transcript: str | None = Field(default=None, alias="voiceTranscript")
    """1.1.36 — the group's spoken-discussion transcript (RAQ-1 audio recording),
    fed to the narrative alongside the chat. None when there's no recording."""

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


def _voice_transcript_for_group(group_code: str) -> str:
    """The group's spoken-discussion transcript (RAQ-1 audio recording), joined in
    seq order — fed to the narrative alongside the chat (1.1.36). Mirrors
    ``recording_routes._transcript_for_group``; kept local to avoid importing the
    recording router here. Best-effort: returns "" on any error."""
    try:
        docs = query_documents("recordings", filters=[("groupId", "==", group_code)])
    except Exception as exc:
        log.warning("voice transcript lookup failed for group=%s: %s", group_code, exc)
        return ""
    segments = [
        (int(d.get("seq", 0)), str(d.get("createdAt", "")), (d.get("transcript") or "").strip())
        for d in docs
        if (d.get("transcript") or "").strip()
    ]
    segments.sort(key=lambda s: (s[0], s[1]))
    return " ".join(t for _, _, t in segments)


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
        # Prefer the index's stored group_code — the new deterministic uid
        # strips hyphens (anon-woolykettle61) and can't be reversed to the
        # hyphenated code; the uid parse is a legacy fallback only.
        groupCode=idx.group_code or _group_code_from_owner_uid(idx.owner_uid),
        activityId=idx.skill_id,
        startedAt=idx.first_message_at,
        endedAt=idx.archived_at,
        durationSeconds=duration,
        messageCount=len(conversation),
        simRunCount=sim_runs,
        conversation=conversation,
    )


async def summarize_session_bq(session_id: str) -> SessionSummary | None:
    """BigQuery-backed ``summarize_session`` (post-1.2 durable source).

    Reads the raw sink tables (``aipla_chat_turn`` / ``aipla_workbench_event``)
    via ``jsonPayload`` — robust whether or not the flattened views exist.
    Returns ``None`` when there are no BQ rows for the session (in-flight
    session, sink ingestion lag) OR on any BQ error (missing table, no creds),
    which is the signal for the caller to fall back to ``summarize_session``.

    Preserves the exact ``SessionSummary`` shape so the reports route is
    source-agnostic. ``sim_run_count`` is an exact COUNT of workbench events
    (replacing the old ``mcp_app_context.*`` key heuristic).
    """
    from db.bigquery import CHAT_TURN_TABLE, WORKBENCH_EVENT_TABLE, run_query, table_ref

    try:
        turn_rows = run_query(
            "SELECT timestamp AS ts, jsonPayload.group_id AS group_id, "
            "jsonPayload.skill_id AS skill_id, jsonPayload.role AS role, "
            "jsonPayload.content AS content, CAST(jsonPayload.turn_index AS INT64) AS turn_index "
            f"FROM {table_ref(CHAT_TURN_TABLE)} "
            "WHERE jsonPayload.session_id = @session_id "
            "ORDER BY turn_index",
            params={"session_id": session_id},
        )
    except Exception as exc:
        log.warning("summarize_session_bq: chat-turn query failed (%s) — caller will fall back", exc)
        return None

    if not turn_rows:
        return None

    conversation: list[SessionTurn] = []
    for row in turn_rows:
        role: Literal["student", "tutor"] = "student" if row["role"] == "student" else "tutor"
        conversation.append(
            SessionTurn(
                timestamp=row["ts"].isoformat(),
                role=role,
                content=row["content"] or "",
            )
        )

    workbench_events: list[WorkbenchEvent] = []
    try:
        wb_rows = run_query(
            "SELECT timestamp AS ts, jsonPayload.server AS server, jsonPayload.tool AS tool, "
            "jsonPayload.field AS field, jsonPayload.value AS value "
            f"FROM {table_ref(WORKBENCH_EVENT_TABLE)} "
            "WHERE jsonPayload.session_id = @session_id "
            "ORDER BY timestamp",
            params={"session_id": session_id},
        )
        for row in wb_rows:
            workbench_events.append(
                WorkbenchEvent(
                    timestamp=row["ts"].isoformat(),
                    server=row["server"] or "",
                    tool=row["tool"] or "",
                    field=row["field"] or "",
                    value=row["value"] or "",
                )
            )
    except Exception as exc:
        log.warning("summarize_session_bq: workbench query failed (%s) — events=[]", exc)
    sim_runs = len(workbench_events)

    timestamps = [row["ts"] for row in turn_rows if row["ts"] is not None]
    started = min(timestamps)
    ended = max(timestamps)
    duration = max(0, int((ended - started).total_seconds()))

    return SessionSummary(
        sessionId=session_id,
        groupCode=turn_rows[0]["group_id"],
        activityId=turn_rows[0]["skill_id"],
        startedAt=started,
        endedAt=ended,
        durationSeconds=duration,
        messageCount=len(conversation),
        simRunCount=sim_runs,
        conversation=conversation,
        workbenchEvents=workbench_events,
    )


async def resolve_session_summary(session_id: str) -> SessionSummary | None:
    """Return a session summary, BigQuery-first with a session-state fallback.

    Durable BQ data (chat-log pipeline) is preferred for ended sessions;
    when it's absent (in-flight session or sink lag) we fall back to reading
    the live ADK session state. Either way the response shape is identical.
    """
    summary = await summarize_session_bq(session_id)
    if summary is None:
        summary = await summarize_session(session_id)
    # 1.1.36 — attach the group's spoken-discussion transcript so the narrative
    # summarises chat + audio. Best-effort; never blocks the report.
    if summary is not None and summary.group_code:
        summary.voice_transcript = _voice_transcript_for_group(summary.group_code) or None
    return summary


def find_latest_session_id_for_group_bq(group_code: str) -> str | None:
    """The group's most-recently-active session id, resolved from the chat-turn
    log in BigQuery (every turn carries ``group_id``).

    Preferred over the Firestore ``chat_sessions`` index for anonymous groups:
    the index is sparse — many sessions chat (and land in BQ) without ever
    getting an index row, and a bare join creates an index row with ZERO turns
    that then wins "latest" by timestamp, yielding an empty "no conversation"
    report. Picking the session with the newest *turn* excludes turn-less bare
    joins by construction. Returns None on no rows / BQ error, so the caller
    falls back to the index-based finder.
    """
    from db.bigquery import CHAT_TURN_TABLE, run_query, table_ref

    try:
        rows = run_query(
            "SELECT jsonPayload.session_id AS session_id, MAX(timestamp) AS last_ts "
            f"FROM {table_ref(CHAT_TURN_TABLE)} "
            "WHERE jsonPayload.group_id = @group_code "
            "GROUP BY session_id ORDER BY last_ts DESC LIMIT 1",
            params={"group_code": group_code},
        )
    except Exception as exc:
        log.warning("find_latest_session_id_for_group_bq: query failed (%s) — caller will fall back", exc)
        return None
    if not rows:
        return None
    return rows[0]["session_id"]


def find_latest_session_for_group(group_code: str) -> ChatSessionIndex | None:
    """Return the most-recently-active session for an anonymous group.

    ``ownerUid`` follows the ``anon-{cleaned}-{random_hex}`` shape, where
    ``cleaned`` is the group code with hyphens stripped
    (``_synthesize_uid`` does ``group_id.replace("-", "")``). We must clean
    the incoming code the same way or the prefix never matches a hyphenated
    code like ``aipla-demo-1`` (whose uid is ``anon-aiplademo1-…``).
    Firestore supports prefix matching with the ``[>=, <]`` range pattern;
    we sort in Python by ``lastMessageAt`` so the query needs no composite index.
    """
    # Match BOTH the current deterministic uid (anon-{cleaned}, no suffix) AND
    # legacy suffixed uids (anon-{cleaned}-{hex}). Querying only the legacy
    # prefix missed every session under the new exact uid → empty reports.
    from auth.group_id_auth import anon_owner_uid_match

    exact, lo, hi = anon_owner_uid_match(group_code)
    rows = list(
        query_documents(
            "chat_sessions",
            filters=[("ownerUid", "==", exact)],
            limit=100,
        )
    ) + list(
        query_documents(
            "chat_sessions",
            filters=[("ownerUid", ">=", lo), ("ownerUid", "<", hi)],
            limit=100,
        )
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
    "WorkbenchEvent",
    "find_latest_session_for_group",
    "find_latest_session_id_for_group_bq",
    "resolve_session_summary",
    "summarize_session",
    "summarize_session_bq",
]
