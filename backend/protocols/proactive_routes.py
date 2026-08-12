"""Proactive-tutor endpoints — Phase A: auto-greet on join.

Phase A of the proactive-tutor design (see
``docs/design/aipla/v1.0.0-pilot/proactive-tutor.md``). When a student
opens a chat surface for a skill that opts in via
``SkillConfig.proactive_greet=True``, the frontend POSTs here. We
synchronously invoke the agent with a synthetic empty user message —
the agent's instruction has the ``## Opening`` template appended at
agent-build time via ``adk.proactive_greet.inject_opening_guidance`` —
collect the assistant's text from the AG-UI event stream, and return
it in the response body. The frontend renders the returned text as
the first tutor message.

Idempotency: a second call on a session with ``turn_count > 0`` returns
``200 {"skipped": true, "reason": "session has prior turns"}`` without
firing a turn. The greet endpoint is safe to call from React in any
mode (StrictMode double-invocation, page reload during streaming) —
the worst case is one extra Firestore read.

Skill opt-out: when the skill's ``proactive_greet`` flag is false, the
endpoint returns ``200 {"skipped": true, "reason": "skill opted out"}``
without instantiating the agent. No tokens consumed.

Phase B (idle heartbeat) will add a sibling ``POST /heartbeat-nudge``
endpoint in this file once JB signs off on default timing + copy.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from adk.proactive_telemetry import tag_proactive_span_from_content
from auth import User, get_current_user
from db.chat_sessions import (
    get_session_index,
    increment_proactive_turn_count_no_stamp,
)
from skills.skill_config import get_skill
from skills.skill_processor import (
    SkillNotFoundError,
    SpendNotAuthorisedError,
    TurnLockedError,
    process_skill_request,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["proactive-tutor"])

# Non-natural-language sentinel used as the synthetic user message that
# triggers the proactive greet turn. Must be non-empty (ag_ui_adk filters
# falsy `content` — see endpoint comment for the call-site reference).
# Kept short to minimise tokens; bracketed so the model recognises it as
# a system marker rather than student input.
PROACTIVE_GREET_TRIGGER = "[session_start]"

# Sprint PROACTIVE-SIM-REACTIVE M5: server-side allowlist of meaningful
# workbench event kinds that may trigger a proactive sim-reactive turn.
# Excluded by design: slider_drag (exploration, not commitment), reset
# (undo, not progress), debounced_state_sync (noise from the
# workbench-state-debounce Phase 2 pipeline). Hardcoded for v1.1 per the
# design doc's recommendation — promote to per-skill config only if a
# skill needs different rules. See
# docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md.
MEANINGFUL_EVENT_KINDS: frozenset[str] = frozenset(
    {
        "sim_run",
        "step_advance",
        "measurement_commit",
    }
)

# Session-wide cooldown between two SIM-REACTIVE proactive turns
# (greet does not stamp this timestamp per M8-fix #3, so the first
# sim-reactive after the greet isn't blocked). Shortened from 90s to
# 30s on 2026-06-03 — 90s felt too restrictive for a student running
# multiple sim variations in quick succession ("press Afspil three
# times with different angles in a minute" was the observed pattern).
# Debounce is now light-touch; cap is the brief-aligned "respond to
# every serious student interaction".
PROACTIVE_COOLDOWN_SECONDS: float = 30.0

# Sentinel format: ``[event_reactive:<kind>]`` where <kind> is one of
# MEANINGFUL_EVENT_KINDS. The frontend posts this as the user-role
# content of the synthetic AG-UI run; the model is instructed to treat
# it as a system marker, not student input. See proactive_reactive.py
# for the matching agent-prompt block.
_EVENT_KIND_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


class GreetRequest(BaseModel):
    """Body shape for ``POST /api/sessions/{id}/greet``."""

    skill_id: str = Field(alias="skillId", min_length=1, max_length=128)

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class GreetResponse(BaseModel):
    """Response shape — either a skipped reason or the generated greet text."""

    skipped: bool
    reason: str | None = None
    text: str | None = None
    session_id: str | None = Field(default=None, alias="sessionId")

    model_config = ConfigDict(populate_by_name=True)


def _serialize(resp: GreetResponse) -> dict[str, Any]:
    return resp.model_dump(by_alias=True, exclude_none=True)


@router.post("/{session_id}/greet")
async def post_session_greet(
    session_id: str,
    body: GreetRequest,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Fire one proactive tutor turn at session start.

    Returns the assistant text in the response body so the frontend can
    render it directly as the first chat message — no SSE stream
    coordination needed for the one-shot opening turn.
    """
    # 1. Idempotency — if the session already has turns, no greet.
    existing = get_session_index(session_id)
    if existing is not None and existing.turn_count > 0:
        log.info(
            "greet skipped (existing session) uid=%s session=%s turn_count=%d",
            user.uid,
            session_id,
            existing.turn_count,
        )
        return _serialize(
            GreetResponse(
                skipped=True,
                reason="session has prior turns",
                sessionId=session_id,
            )
        )

    # 2. Skill must exist + opt in.
    skill = get_skill(body.skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")
    if not skill.proactive_greet:
        return _serialize(
            GreetResponse(
                skipped=True,
                reason="skill opted out",
                sessionId=session_id,
            )
        )
    if not (skill.opening_template or "").strip():
        # The wrapper would still no-op at runtime, but spending the
        # tokens for an unguided "first turn" is worse than the static
        # banner — bail.
        return _serialize(
            GreetResponse(
                skipped=True,
                reason="skill has no opening template",
                sessionId=session_id,
            )
        )

    # 3. Drive the agent. We send a short non-natural-language sentinel
    #    rather than an empty string because ag_ui_adk's
    #    `_convert_latest_message` filters out user messages whose
    #    `content` is falsy (`""` included) — see
    #    site-packages/ag_ui_adk/adk_agent.py:1098. With an empty
    #    content the model is never invoked and we get back zero text.
    #    The OPENING GUIDANCE block in the agent's instruction (see
    #    adk/proactive_greet.py) tells the model the student has not
    #    yet sent a message and that this sentinel is system-supplied,
    #    so the first turn is shaped by that guidance rather than by
    #    any student input. The sentinel persists in the session as a
    #    user-role message; the frontend never renders it (only the
    #    response `text` is shown as the first tutor bubble).
    access = request.state.access
    assistant_parts: list[str] = []
    # Sprint PROACTIVE-SIM-REACTIVE M7: tag the OTel span explicitly
    # before driving the agent. Belt-and-braces — the agent's
    # before-agent callback also tags via callback_context.user_content,
    # but driving the agent server-side from this endpoint means the
    # request span we want to tag is *this* request, not the inner
    # invocation. Both call sites converge on the same tag.
    tag_proactive_span_from_content(PROACTIVE_GREET_TRIGGER)
    try:
        async for event in process_skill_request(
            skill_id=body.skill_id,
            user=user,
            access=access,
            session_id=session_id,
            message=PROACTIVE_GREET_TRIGGER,
        ):
            event_type = event.get("type") if isinstance(event, dict) else None
            if event_type == "TEXT_MESSAGE_CONTENT":
                delta = event.get("delta") or event.get("content") or ""
                if delta:
                    assistant_parts.append(delta)
    except SkillNotFoundError as exc:
        # process_skill_request applies the same access-aware skill check;
        # surface as 404 to match the chat-stream behaviour.
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TurnLockedError:
        # 1.1.53 M0 — a member of this group already has a turn in flight. Don't
        # race a proactive greet onto the shared session; just skip it (a greet
        # is a welcome, not a response — dropping it when the group is already
        # talking to the tutor is correct, not a failure).
        log.info("greet skipped: group turn in flight session=%s", session_id)
        return _serialize(GreetResponse(skipped=True, text="", sessionId=session_id))
    except SpendNotAuthorisedError as exc:
        # ACCESS-1 M1 — a proactive greet is the one turn the student did not
        # ask for, so an unauthorised one is SKIPPED silently rather than
        # surfaced as a 402. Raising here would open a visitor's session with an
        # error card before they have typed anything, which is a worse first
        # impression than simply not greeting.
        log.info("greet skipped: spend not authorised (tier=%s) session=%s", exc.tier, session_id)
        return _serialize(GreetResponse(skipped=True, text="", sessionId=session_id))

    text = "".join(assistant_parts).strip()
    log.info(
        "greet fired uid=%s session=%s skill=%s chars=%d",
        user.uid,
        session_id,
        body.skill_id,
        len(text),
    )

    # Sprint PROACTIVE-SIM-REACTIVE: greet counts toward proactiveTurnCount
    # (analytics signal) but does NOT stamp lastProactiveTurnAt — M8-fix
    # #3 (2026-06-03) — so the very first sim-reactive turn after the
    # greet doesn't trip the 90s session-wide cooldown gate. Greet is
    # structurally different from a reactive turn (welcome, not response
    # to student action) and shouldn't occupy the cooldown slot. The
    # cooldown timestamp is stamped only by genuine sim-reactive turns
    # (via the after_agent callback on [event_reactive:*] runs).
    if text:
        try:
            increment_proactive_turn_count_no_stamp(session_id)
        except Exception as exc:
            # Best-effort stamp. A failure here would silently mis-count
            # the cap; logging surfaces it without failing the greet
            # (which already succeeded from the student's perspective).
            log.warning(
                "greet: failed to increment proactive counter session=%s err=%s",
                session_id,
                exc,
            )

    return _serialize(
        GreetResponse(
            skipped=False,
            text=text,
            sessionId=session_id,
        )
    )


# ---------------------------------------------------------------------------
# Sprint PROACTIVE-SIM-REACTIVE M5 — proactive event-check (Phase B gate)
# ---------------------------------------------------------------------------


class ProactiveEventCheckRequest(BaseModel):
    """Body shape for ``POST /api/sessions/{id}/proactive-event-check``.

    ``eventKind`` is the workbench-event kind that just committed (e.g.
    ``sim_run``, ``step_advance``). ``eventPayload`` is the artefact's
    optional event payload — accepted and ignored by the v1.1 endpoint;
    forward-compat slot so future versions can use it without a schema
    change.
    """

    skill_id: str = Field(alias="skillId", min_length=1, max_length=128)
    event_kind: str = Field(alias="eventKind", min_length=1, max_length=64)
    event_payload: dict[str, Any] | None = Field(default=None, alias="eventPayload")

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class ProactiveEventCheckResponse(BaseModel):
    """Response shape — either a skipped reason or a trigger sentinel.

    When ``shouldFire`` is True, ``trigger`` carries the sentinel string
    the frontend should post to ``/api/chat/{skill_id}`` as the user
    message content of a new AG-UI run. The agent's instruction (built
    via ``adk.proactive_reactive.inject_reactive_guidance``) is what
    actually shapes the proactive turn — this endpoint only decides
    *whether* one should happen, never invokes the agent itself.
    """

    should_fire: bool = Field(alias="shouldFire")
    reason: str | None = None
    trigger: str | None = None
    session_id: str | None = Field(default=None, alias="sessionId")

    model_config = ConfigDict(populate_by_name=True)


def _check_response(
    *,
    should_fire: bool,
    session_id: str,
    reason: str | None = None,
    trigger: str | None = None,
) -> dict[str, Any]:
    """Build the JSON response body for the gate endpoint."""
    resp = ProactiveEventCheckResponse(
        shouldFire=should_fire,
        reason=reason,
        trigger=trigger,
        sessionId=session_id,
    )
    return resp.model_dump(by_alias=True, exclude_none=True)


@router.post("/{session_id}/proactive-event-check")
async def post_proactive_event_check(
    session_id: str,
    body: ProactiveEventCheckRequest,
    request: Request,
    user: User = Depends(get_current_user),  # noqa: B008
) -> dict[str, Any]:
    """Gate-decision endpoint for sim-reactive proactive turns (Phase B).

    Returns ``{shouldFire: true, trigger: "[event_reactive:<kind>]"}``
    when all six gates pass; otherwise ``{shouldFire: false, reason:
    "..."}`` with the gate name. Never invokes the agent — the frontend
    POSTs the trigger sentinel to ``/api/chat/{skill_id}`` to actually
    fire the AG-UI run, so the proactive turn rides the established
    streaming protocol like any user-driven turn. Architecture per
    docs/design/aipla/v1.1.0-feedback/proactive-sim-reactive-tutor.md.
    """
    # Gate 1: skill exists.
    skill = get_skill(body.skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")

    # Gate 2: skill opted in to sim-reactive turns.
    if not skill.proactive_event_reactive:
        return _check_response(
            should_fire=False,
            session_id=session_id,
            reason="skill opted out",
        )

    # Gate 3: event kind in the server-side meaningful-event allowlist.
    if body.event_kind not in MEANINGFUL_EVENT_KINDS:
        return _check_response(
            should_fire=False,
            session_id=session_id,
            reason="event kind not meaningful",
        )

    # Gate 4: session exists. If not, the frontend is calling this for a
    # session that hasn't been touched yet — bail rather than guessing.
    existing = get_session_index(session_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="session not found")

    now = datetime.now(UTC)

    # Gate 5: student silence threshold. Uses last_student_message_at
    # specifically (NOT last_message_at) so tutor turns — auto-greet,
    # streamed responses, prior proactive turns — don't count as
    # "student is talking, don't interrupt". Vacuously passes when None
    # (student hasn't typed yet this session) so a student pressing
    # Afspil right after the auto-greet streams in DOES get a reactive
    # turn. M8-fix #2 (2026-06-03) — previously read last_message_at
    # and the greet's stamp blocked every same-window Afspil press.
    if existing.last_student_message_at is not None:
        seconds_since_student = (now - existing.last_student_message_at).total_seconds()
        if seconds_since_student < skill.proactive_heartbeat_seconds:
            return _check_response(
                should_fire=False,
                session_id=session_id,
                reason="student recently active",
            )

    # Gate 6: session-wide cooldown between any two proactive turns.
    # None last_proactive_turn_at means no proactive turn yet — gate
    # vacuously passes.
    if existing.last_proactive_turn_at is not None:
        seconds_since_proactive = (now - existing.last_proactive_turn_at).total_seconds()
        if seconds_since_proactive < PROACTIVE_COOLDOWN_SECONDS:
            return _check_response(
                should_fire=False,
                session_id=session_id,
                reason="cooldown active",
            )

    # Gate 7: optional per-session cap on proactive turns (greet + reactive).
    # None means no cap — the 90s session-wide cooldown above is then the
    # only throttle. A skill can opt into a hard cap by setting an explicit
    # positive int in its SKILL.md frontmatter; non-positive values are
    # treated the same as None (defensive against `proactiveMaxPerSession: 0`
    # confusing semantics). Retracted from the original "max 2" design
    # constraint 2026-06-03 once JB confirmed no numeric cap was agreed.
    cap = skill.proactive_max_per_session
    if cap is not None and cap > 0 and existing.proactive_turn_count >= cap:
        return _check_response(
            should_fire=False,
            session_id=session_id,
            reason="cap reached",
        )

    # All gates passed — emit the trigger sentinel. The frontend wraps
    # this in a synthetic AG-UI RunAgentInput with role=user content; the
    # agent's REACTIVE GUIDANCE block (proactive_reactive.py) instructs
    # the model to treat it as a system marker, not echo it. We
    # intentionally validate event_kind shape here too — a bad shape
    # would still pass gate 3 if it happened to match an allowlist entry,
    # but we belt-and-brace against URL-injection-style content slipping
    # through into the sentinel string.
    if not _EVENT_KIND_PATTERN.match(body.event_kind):
        # Should be unreachable because allowlist entries match the
        # pattern. Defensive: refuse to mint a malformed sentinel.
        raise HTTPException(status_code=422, detail="event_kind has invalid shape")

    trigger = f"[event_reactive:{body.event_kind}]"
    log.info(
        "proactive_event_check shouldFire uid=%s session=%s skill=%s kind=%s",
        user.uid,
        session_id,
        body.skill_id,
        body.event_kind,
    )
    return _check_response(
        should_fire=True,
        session_id=session_id,
        trigger=trigger,
    )
