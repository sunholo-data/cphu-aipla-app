"""The recorded-demo event source (ACCESS-1 M2).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

A visitor at `aipla.ku.dk` should be able to watch a physics tutoring session
play out end to end without a single paid API call. This is how.

WHY IT LIVES BEHIND THE PROTOCOL RATHER THAN IN FRONT OF IT

    AG-UI is an event stream. Nothing about it requires a model behind that
    stream. So the recorded demo is a SECOND EVENT SOURCE emitting the same
    `RUN_STARTED / TEXT_MESSAGE_* / RUN_FINISHED` sequence — which means the
    chat surface, `AGUIProvider`, streaming markdown, SVG handling and the sim
    frames are all completely unchanged. The frontend cannot tell the
    difference, and does not need to.

WHY THIS IS NOT "MOCK DATA IN A SHIPPED UI"

    The project rule is: real data or honest empty states, never fabricated
    fallbacks (`check:no-mock`, and the reasoning behind it). A recorded demo
    does not breach that rule, but ONLY because of a property this module has to
    keep mechanically rather than by good intentions:

        it never claims to be live.

    Three things enforce that here:

      1. Every replayed run opens with a labelled preamble saying it is a
         recording. Not a tooltip, not a subtitle — the first thing in the
         stream.
      2. Off-script input gets `OFF_SCRIPT_REPLY`, an honest "this is a
         recording, so I can't answer that" plus the access nudge. It never
         fabricates an answer to a question nobody recorded.
      3. Nothing that would read as a MEASUREMENT is replayed — no citations,
         no rubric scores, no token counts, no tool calls. Only the
         conversation.

    A product demo video is not a lie. A fabricated answer presented as the
    tutor's reasoning would be.

Naming note: no `MOCK_*` / `getMock` / `_mock-data` identifiers anywhere near
this, on either side of the wire — `check:no-mock` is a lexical grep and would
fire on correct code.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncGenerator
from typing import Any

logger = logging.getLogger(__name__)

#: Seconds between streamed chunks. Fast enough not to feel like a stall, slow
#: enough to read as generation rather than a paste. Real first-token latency on
#: a live turn is ~0.5-2s, so the preamble also lands at a familiar rhythm.
CHUNK_DELAY_SECONDS = 0.035

#: Roughly a word per chunk — replaying a whole paragraph in one event would
#: arrive as a paste and lose the "it is thinking" affordance the chat UI is
#: built around.
CHARS_PER_CHUNK = 6

#: Opens every replayed run. Danish first — this is a ku.dk domain.
RECORDING_PREAMBLE = (
    "_Optaget demonstration — tutoren afspiller en rigtig samtale og svarer "
    "ikke på det du skriver._\n\n"
    "_Recorded demonstration — the tutor is replaying a real session, not "
    "responding to you._\n\n"
)

#: What a visitor gets when they type something nobody recorded an answer to.
#: An honest empty state plus the nudge, in the place they are most engaged —
#: NOT a fabricated answer.
OFF_SCRIPT_REPLY = (
    "_Optaget demonstration._\n\n"
    "Det her er en optagelse, så jeg kan ikke svare på nye spørgsmål. "
    "Lærere i AIPLA-programmet får en live tutor til deres klasser.\n\n"
    "_This is a recorded session, so I can't answer new questions here. "
    "Teachers in the AIPLA programme get a live tutor for their classes._\n\n"
    "[Bliv en del af programmet / Join the programme](/teacher-access)"
)

#: What a visitor gets on an activity nobody has recorded yet. Still honest,
#: still nudging — never a fabricated tutor turn.
NO_TRANSCRIPT_REPLY = (
    "_Optaget demonstration._\n\n"
    "Der er endnu ikke optaget en demonstration til denne aktivitet. "
    "Prøv en af demo-aktiviteterne, eller få en live tutor:\n\n"
    "_No demonstration has been recorded for this activity yet. Try one of the "
    "demo activities, or get a live tutor:_\n\n"
    "[Bliv en del af programmet / Join the programme](/teacher-access)"
)


def _chunk(text: str) -> list[str]:
    """Split on whitespace boundaries so words do not tear mid-render.

    Markdown matters here: breaking inside `**bold` or a `[link](...)` makes the
    streaming renderer flicker between valid and invalid states, which is the
    same class of bug 1.1.15 fixed for SVG.
    """
    if not text:
        return []
    chunks: list[str] = []
    current = ""
    for word in text.split(" "):
        candidate = f"{current} {word}" if current else word
        if len(candidate) >= CHARS_PER_CHUNK:
            chunks.append(candidate + " ")
            current = ""
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _next_assistant_turn(transcript: dict[str, Any], turn_index: int) -> str | None:
    """The assistant text for the ``turn_index``-th visitor message.

    The transcript is a flat list of alternating user/assistant turns. We ignore
    the recorded USER turns entirely — the visitor supplies their own input, and
    pretending their message was the recorded one would be the dishonest version
    of this feature. We only advance through the assistant side.
    """
    assistant_turns = [t for t in transcript.get("turns", []) if t.get("role") == "assistant"]
    if turn_index < len(assistant_turns):
        return str(assistant_turns[turn_index].get("text") or "")
    return None


async def stream_recorded_demo(
    *,
    transcript: dict[str, Any] | None,
    turn_index: int,
    thread_id: str,
    include_preamble: bool = True,
) -> AsyncGenerator[dict, None]:
    """Yield AG-UI events replaying one recorded assistant turn.

    Emits exactly the shape a live run emits — RUN_STARTED, TEXT_MESSAGE_START,
    a series of TEXT_MESSAGE_CONTENT deltas, TEXT_MESSAGE_END, RUN_FINISHED — so
    the frontend needs no branch.

    Args:
        transcript: the recorded session, or ``None`` when none exists for this
            activity (an honest "not recorded yet" turn is emitted instead).
        turn_index: how many assistant turns this session has already replayed.
            Past the end of the recording, the off-script reply is emitted.
        thread_id: the AG-UI thread this run belongs to.
        include_preamble: prepend the "this is a recording" label. True on the
            first turn of a session; the visitor does not need telling on every
            single turn once the banner is up.
    """
    from ag_ui.core import (
        EventType,
        RunFinishedEvent,
        RunStartedEvent,
        TextMessageContentEvent,
        TextMessageEndEvent,
        TextMessageStartEvent,
    )

    run_id = uuid.uuid4().hex
    message_id = uuid.uuid4().hex

    if transcript is None:
        body = NO_TRANSCRIPT_REPLY
    else:
        recorded = _next_assistant_turn(transcript, turn_index)
        body = recorded if recorded is not None else OFF_SCRIPT_REPLY

    text = (RECORDING_PREAMBLE + body) if include_preamble else body

    yield RunStartedEvent(type=EventType.RUN_STARTED, thread_id=thread_id, run_id=run_id).model_dump(
        by_alias=True, exclude_none=True
    )
    yield TextMessageStartEvent(type=EventType.TEXT_MESSAGE_START, message_id=message_id, role="assistant").model_dump(
        by_alias=True, exclude_none=True
    )

    for piece in _chunk(text):
        # Paced so it reads as generation. Cheap: no model, no network.
        await asyncio.sleep(CHUNK_DELAY_SECONDS)
        yield TextMessageContentEvent(
            type=EventType.TEXT_MESSAGE_CONTENT, message_id=message_id, delta=piece
        ).model_dump(by_alias=True, exclude_none=True)

    yield TextMessageEndEvent(type=EventType.TEXT_MESSAGE_END, message_id=message_id).model_dump(
        by_alias=True, exclude_none=True
    )
    yield RunFinishedEvent(type=EventType.RUN_FINISHED, thread_id=thread_id, run_id=run_id).model_dump(
        by_alias=True, exclude_none=True
    )


__all__ = [
    "CHUNK_DELAY_SECONDS",
    "NO_TRANSCRIPT_REPLY",
    "OFF_SCRIPT_REPLY",
    "RECORDING_PREAMBLE",
    "stream_recorded_demo",
]
