"""ChatSessionIndex — lightweight Firestore index row for chat sessions.

Events and state live in ADK VertexAiSessionService (Agent Engine).
This model is the queryable metadata mirror: list, filter, share, and
rename without touching Agent Engine's O(n) list_sessions scan.

Access enforcement reuses the shared `AccessControl` + `can_access()`
pipeline from resource-access-control (1A.1b). Default at session start:
inherit the parent document's accessControl (copy verbatim).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from db.models.access import AccessControl


class ChatSessionIndex(BaseModel):
    """Firestore document at `chat_sessions/{sessionId}`.

    `owner_id` property satisfies the `_HasAccess` protocol used by
    `auth.access_context.can_access()`.

    ``document_ids`` is the full list of documents that have ever been
    attached to this session — added by ``make_document_loader`` via
    ``ArrayUnion`` whenever the user opens a new tab. The
    ``list_sessions_for_document`` query uses ``array_contains`` so a
    session shows up under each of its docs' history panels.
    """

    session_id: str = Field(alias="sessionId")
    document_ids: list[str] = Field(default_factory=list, alias="documentIds")
    skill_id: str = Field(alias="skillId")
    owner_uid: str = Field(alias="ownerUid")
    access_control: AccessControl = Field(alias="accessControl")
    title: str | None = None
    turn_count: int = Field(default=0, alias="turnCount")
    first_message_at: datetime = Field(alias="firstMessageAt")
    last_message_at: datetime = Field(alias="lastMessageAt")
    archived: bool = Field(default=False)
    """Soft-archive flag. Set to True when the session is closed for
    further interaction (e.g. group code expired, teacher reset).
    Companion to ``archived_at``: ``archived=True`` implies
    ``archived_at`` is set; both should be flipped together. Sprint
    QUICK-WINS-V11 introduced this field so the school-year TTL
    transition (~300 days) can soft-archive sessions without losing
    their BigQuery rows or chat history."""
    archived_at: datetime | None = Field(default=None, alias="archivedAt")
    shared_with_teacher: bool = Field(default=False, alias="sharedWithTeacher")
    group_code: str | None = Field(default=None, alias="groupCode")
    proactive_turn_count: int = Field(default=0, alias="proactiveTurnCount")
    """Count of proactive tutor turns fired this session, across both
    Phase A (auto-greet) and Phase B (sim-reactive). Compared against
    ``SkillConfig.proactive_max_per_session`` by the
    ``/proactive-event-check`` gate to enforce the per-session cap.
    Sprint PROACTIVE-SIM-REACTIVE introduced this field."""
    last_proactive_turn_at: datetime | None = Field(default=None, alias="lastProactiveTurnAt")
    """Wall-clock timestamp of the most recent proactive turn (greet or
    sim-reactive). Compared against the 90-second session-wide cooldown
    by the ``/proactive-event-check`` gate. None for sessions that have
    not yet had a proactive turn (the default state). Sprint
    PROACTIVE-SIM-REACTIVE introduced this field."""
    last_student_message_at: datetime | None = Field(default=None, alias="lastStudentMessageAt")
    """Wall-clock timestamp of the most recent STUDENT-authored chat
    message (i.e. event whose role is user / author is the human, NOT
    the agent). Distinct from ``last_message_at`` which is updated on
    every turn including tutor responses (greet, reactive, normal
    answers). The ``/proactive-event-check`` gate uses THIS field for
    the heartbeat threshold so an auto-greet streaming right before the
    student presses Afspil does NOT count as "student recently active"
    and block the proactive reactive turn. None when the student has
    not yet typed anything in this session — gate treats that as
    vacuously passing. Sprint PROACTIVE-SIM-REACTIVE M8-fix #2 added
    this field."""
    summary_text: str | None = Field(default=None, alias="summaryText")
    """1.1.4 — cached AI narrative summary for the teacher session report.
    Generated on-demand when a teacher opens the report; regenerated when
    ``summary_based_on_turn_count`` lags the live turn count."""
    summary_generated_at: datetime | None = Field(default=None, alias="summaryGeneratedAt")
    """When ``summary_text`` was last generated (audit + staleness)."""
    summary_based_on_turn_count: int | None = Field(default=None, alias="summaryBasedOnTurnCount")
    """The message count the cached summary was generated from. The summary
    is regenerated when the live count exceeds this."""
    summary_based_on_voice_chars: int | None = Field(default=None, alias="summaryBasedOnVoiceChars")
    """1.1.36 — the voice-transcript length the cached summary was built from.
    Regenerated when chat turns OR voice chars grow (and past the debounce)."""

    model_config = ConfigDict(populate_by_name=True)

    @property
    def owner_id(self) -> str:
        """Satisfies the `_HasAccess` protocol (owner_id field)."""
        return self.owner_uid


__all__ = ["ChatSessionIndex"]
