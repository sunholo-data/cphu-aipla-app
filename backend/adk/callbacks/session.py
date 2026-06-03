"""Session-index callbacks: creation on first turn + counter maintenance.

* ``make_session_tracker``       — before_agent_callback that creates the
  ChatSessionIndex row the first time a session fires.
* ``make_after_agent_response``  — after_agent_callback that increments
  turn counters, flushes to Firestore, generates a session title, and
  emits chat-turn log entries to the BigQuery pipeline.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from db.chat_sessions import add_session_documents, get_session_index
from db.models.access import AccessControl

logger = logging.getLogger(__name__)

_STATE_INITIALIZED = "app:chat_session_initialized"
_STATE_TURN_COUNT = "app:chat_session_turn_count"

# Flush counter updates every N turns to reduce Firestore write amplification.
_TURN_FLUSH_INTERVAL = 5


_PROACTIVE_GREET_SENTINEL = "[session_start]"
_EVENT_REACTIVE_PATTERN = re.compile(r"^\[event_reactive:[a-z][a-z0-9_]*\]$")


def _is_proactive_sentinel(text: str) -> bool:
    """Mirror of frontend/src/lib/proactiveSentinels.ts. Sprint
    PROACTIVE-SIM-REACTIVE: synthetic system-marker user events that
    trigger proactive turns must NOT count as real student activity for
    the heartbeat-threshold gate. Keep these literals in sync with
    backend/protocols/proactive_routes.py (PROACTIVE_GREET_TRIGGER +
    event_reactive sentinel format).
    """
    stripped = text.strip()
    if stripped == _PROACTIVE_GREET_SENTINEL:
        return True
    return bool(_EVENT_REACTIVE_PATTERN.match(stripped))


def _emit_new_turns(
    session: Any,
    session_id: str,
    owner_uid: str,
    skill_id: str,
    callback_context: Any,
    group_id: str | None = None,
) -> None:
    """Emit chat-turn log entries for THIS invocation's events (SEQUENCE 1.2).

    Filters ``session.events`` by the current ``invocation_id`` so we capture
    exactly the user message + agent response(s) appended during this agent
    run. This is robust to ADK's ``EventsCompactionConfig`` (compaction every
    5-10 events summarises old events into a compacted event, which shifts
    indices and silently invalidates a forward index cursor — the cause of
    the first-turn-capture gap observed on deployed dev 2026-05-29).

    ``group_id`` is the real display group code (``user.group_id``); we prefer
    it because the synthetic uid strips hyphens. Skips non-student (no group
    code) owners. Never raises — telemetry must not break the turn.
    """
    try:
        from observability.chat_log import emit_chat_turn, group_code_from_owner_uid

        group_code = group_id or group_code_from_owner_uid(owner_uid)
        if not group_code:
            return  # teacher / workshop session — not student research data

        events = list(getattr(session, "events", None) or [])
        if not events:
            return

        current_inv = getattr(callback_context, "invocation_id", None)
        if not current_inv:
            current_inv = getattr(events[-1], "invocation_id", None)
        if not current_inv:
            return

        for idx, event in enumerate(events):
            if getattr(event, "invocation_id", None) != current_inv:
                continue
            content_obj = getattr(event, "content", None)
            parts = getattr(content_obj, "parts", None) if content_obj else None
            if not parts:
                continue
            text = " ".join(p.text for p in parts if getattr(p, "text", None)).strip()
            if not text:
                continue
            role = "student" if getattr(event, "author", None) == "user" else "tutor"

            token_in = token_out = None
            try:
                usage = getattr(event, "usage_metadata", None)
                if usage is not None:
                    token_in = getattr(usage, "prompt_token_count", None)
                    token_out = getattr(usage, "candidates_token_count", None)
            except Exception:
                pass

            emit_chat_turn(
                group_id=group_code,
                session_id=session_id,
                skill_id=skill_id,
                turn_index=idx,
                role=role,
                content=text,
                token_in=token_in,
                token_out=token_out,
            )
    except Exception as exc:
        logger.warning("chat-log emit failed (suppressed): %s", exc)


def make_session_tracker(owner_uid: str, skill_id: str, group_id: str | None = None) -> Any:
    """Return a ``before_agent_callback`` that creates the ChatSessionIndex once.

    ADK has no dedicated "session created" hook; ``before_agent_callback``
    fires at the start of every turn. We use the
    ``app:chat_session_initialized`` state flag to run creation only once
    per session.

    ``owner_uid``, ``skill_id``, and ``group_id`` are captured in closures from the
    authenticated request + the skill being invoked so we don't re-read
    them on every turn. The skill_id closure is what makes
    ``list_sessions_for_skill`` work — earlier the tracker pulled
    skill_id from session state, but nothing set it there, so every row
    landed in Firestore as ``skillId: "unknown"`` and the per-skill
    sidebar always came back empty. ``group_id`` populates ``groupCode``
    so ``list_sessions_for_group_codes`` (teacher dashboard) finds student sessions.
    """

    def _tracker(callback_context: Any) -> None:
        state = getattr(callback_context, "state", None)
        if state is None:
            return
        if state.get(_STATE_INITIALIZED):
            return

        session = getattr(callback_context, "session", None)
        session_id = getattr(session, "id", None) if session else None
        if not session_id:
            return

        # B1 idempotency: process_skill_request writes the index row synchronously
        # at the top of the SSE stream. If that write already landed, don't
        # re-create — that would clobber title / turnCount / documentIds updates.
        try:
            existing = get_session_index(session_id)
        except Exception as exc:
            logger.warning("idempotency check failed for %s, attempting create: %s", session_id, exc)
            existing = None
        if existing is not None:
            state[_STATE_INITIALIZED] = True
            state[_STATE_TURN_COUNT] = 0
            return

        document_ids: list[str] = list(state.get("document_ids") or [])
        anchor_doc_id: str | None = document_ids[0] if document_ids else None

        access_control = _derive_access_control(anchor_doc_id)

        try:
            from db.chat_sessions import create_session_index

            create_session_index(
                session_id=session_id,
                skill_id=skill_id,
                owner_uid=owner_uid,
                access_control=access_control,
                document_ids=document_ids,
                group_code=group_id,
            )
            state[_STATE_INITIALIZED] = True
            state[_STATE_TURN_COUNT] = 0
            logger.info("chat_sessions/%s index created (owner=%s)", session_id, owner_uid)
        except Exception as exc:
            logger.warning("failed to create session index for %s: %s", session_id, exc)

    return _tracker


def _derive_access_control(document_id: str | None) -> AccessControl:
    """Derive the initial access control for a new session.

    If the session is attached to a document, copy the document's
    accessControl. Otherwise default to private.
    """
    if not document_id:
        return AccessControl(type="private")
    try:
        from db.firestore import get_document

        doc = get_document("parsed_documents", document_id)
        if doc and "accessControl" in doc:
            ac_data = doc["accessControl"]
            if isinstance(ac_data, dict):
                return AccessControl.model_validate(ac_data)
    except Exception as exc:
        logger.warning("could not fetch document %s for access_control: %s", document_id, exc)
    return AccessControl(type="private")


def _try_generate_title(session: Any) -> str | None:
    """Attempt to generate a title from session events. Returns None on any failure."""
    events = list(getattr(session, "events", None) or [])
    try:
        from db.title_generator import generate_title_fast

        return generate_title_fast(events[:8])
    except Exception as exc:
        logger.warning("title generation raised: %s", exc)
        return None


def _flush_session_index(session_id: str, turn_count: int, title: str | None) -> None:
    """Write counter update (and optionally title) to Firestore."""
    try:
        from db.chat_sessions import update_session_fields

        update: dict[str, Any] = {
            "turnCount": turn_count,
            "lastMessageAt": datetime.now(UTC).isoformat(),
        }
        if title is not None:
            update["title"] = title
        update_session_fields(session_id, update)
    except Exception as exc:
        logger.warning("failed to update session index for %s: %s", session_id, exc)


def make_after_agent_response(
    owner_uid: str | None = None, skill_id: str | None = None, group_id: str | None = None
) -> Any:
    """Return an ``after_agent_callback`` that maintains the ChatSessionIndex.

    After each turn:
    - Emits new chat turns to the BigQuery chat-log pipeline (1.2) when
      ``owner_uid`` + ``skill_id`` are provided.
    - Increments the in-memory turn counter stored in session state.
    - Flushes ``turnCount`` + ``lastMessageAt`` to Firestore every
      ``_TURN_FLUSH_INTERVAL`` turns.
    - Triggers title generation after exactly turn 2 (first full exchange).

    ``owner_uid`` / ``skill_id`` default to None so existing callers/tests
    that invoke ``make_after_agent_response()`` keep working (chat-logging is
    simply skipped without them).
    """

    def _after_response(callback_context: Any) -> None:
        state = getattr(callback_context, "state", None)
        if state is None:
            return

        session = getattr(callback_context, "session", None)
        session_id = getattr(session, "id", None) if session else None

        if owner_uid and skill_id and session_id and session is not None:
            _emit_new_turns(session, session_id, owner_uid, skill_id, callback_context, group_id)

        if not state.get(_STATE_INITIALIZED):
            return
        if not session_id:
            return

        # Sprint PROACTIVE-SIM-REACTIVE M8-fix #2 / #3: classify the
        # current invocation's user-role event and update the right
        # ChatSessionIndex fields.
        #
        # - Real (non-sentinel) student message → bump lastStudentMessageAt.
        #   The /proactive-event-check gate reads this for the heartbeat
        #   threshold; auto-greet's [session_start] sentinel does NOT
        #   count as student activity (M8-fix #2).
        # - Sim-reactive sentinel [event_reactive:<kind>] → bump
        #   proactiveTurnCount AND stamp lastProactiveTurnAt (the 90s
        #   session-wide cooldown timestamp). The /greet endpoint stamps
        #   the count only (no timestamp) so the FIRST sim-reactive turn
        #   doesn't trip the cooldown — see /greet for matching comment
        #   (M8-fix #3).
        # - Auto-greet sentinel [session_start] → no-op here; the
        #   /greet endpoint already bumped the count.
        #
        # Best-effort: any failure logs but doesn't break the turn.
        if session is not None:
            try:
                current_inv = getattr(callback_context, "invocation_id", None)
                events = list(getattr(session, "events", None) or [])
                if not current_inv and events:
                    current_inv = getattr(events[-1], "invocation_id", None)
                user_text = ""
                for event in events:
                    if current_inv and getattr(event, "invocation_id", None) != current_inv:
                        continue
                    if getattr(event, "author", None) != "user":
                        continue
                    content = getattr(event, "content", None)
                    parts = getattr(content, "parts", None) if content else None
                    if not parts:
                        continue
                    user_text = " ".join(p.text for p in parts if getattr(p, "text", None)).strip()
                    break

                if user_text:
                    if _EVENT_REACTIVE_PATTERN.match(user_text):
                        from db.chat_sessions import increment_proactive_turn_count

                        increment_proactive_turn_count(session_id)
                    elif user_text != _PROACTIVE_GREET_SENTINEL:
                        from db.chat_sessions import update_session_fields

                        update_session_fields(
                            session_id,
                            {"lastStudentMessageAt": datetime.now(UTC).isoformat()},
                        )
            except Exception as exc:
                logger.warning(
                    "failed to update session timestamps for %s: %s",
                    session_id,
                    exc,
                )

        turn_count: int = int(state.get(_STATE_TURN_COUNT) or 0) + 1
        state[_STATE_TURN_COUNT] = turn_count

        # B3: retry title generation on a later flush turn if turn 2 produced
        # None (thin context). ``state["titleSet"]`` is set to True only on a
        # successful generation, so retries stop once the session has a title.
        needs_title_gen = turn_count == 2 or (turn_count >= 4 and not state.get("titleSet"))
        flush_counters = turn_count == 1 or (turn_count % _TURN_FLUSH_INTERVAL == 0) or needs_title_gen
        if not flush_counters:
            return

        title = _try_generate_title(session) if needs_title_gen else None
        if title is not None:
            state["titleSet"] = True
        _flush_session_index(session_id, turn_count, title)

        # B2: keep ``documentIds`` in sync with the docs the user has open.
        # ``make_document_loader`` adds ids to state mid-conversation; without
        # this ArrayUnion sync, ``list_sessions_for_document`` would never see
        # those docs.
        try:
            add_session_documents(session_id, list(state.get("document_ids") or []))
        except Exception as exc:
            logger.warning("failed to sync documentIds for %s: %s", session_id, exc)

    return _after_response
