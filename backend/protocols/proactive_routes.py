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
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from auth import User, get_current_user
from db.chat_sessions import get_session_index
from skills.skill_config import get_skill
from skills.skill_processor import SkillNotFoundError, process_skill_request

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["proactive-tutor"])

# Non-natural-language sentinel used as the synthetic user message that
# triggers the proactive greet turn. Must be non-empty (ag_ui_adk filters
# falsy `content` — see endpoint comment for the call-site reference).
# Kept short to minimise tokens; bracketed so the model recognises it as
# a system marker rather than student input.
PROACTIVE_GREET_TRIGGER = "[session_start]"


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

    text = "".join(assistant_parts).strip()
    log.info(
        "greet fired uid=%s session=%s skill=%s chars=%d",
        user.uid,
        session_id,
        body.skill_id,
        len(text),
    )

    return _serialize(
        GreetResponse(
            skipped=False,
            text=text,
            sessionId=session_id,
        )
    )
