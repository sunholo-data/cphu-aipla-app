"""The test that lets us publicise aipla.ku.dk (ACCESS-1 M2).

Design: docs/design/aipla/v1.1.0-feedback/public-access-tiers-and-spend-control.md

Everything else in ACCESS-1 asserts a mechanism. This file asserts the OUTCOME:

    a visitor's whole chat session makes no paid API call.

It works by construction rather than by inspection — every model constructor and
the direct `genai` client are replaced with things that raise, so a paid call
fails the test by exploding rather than by being noticed. That covers BOTH spend
paths: the ADK agent loop AND the ten direct-`generate_content` sites that the
ADK callback never sees.
"""

from __future__ import annotations

import pytest

from auth import User, build_access_context
from auth.access_tiers import TIER_VISITOR
from skills import replay_source, skill_processor
from skills.replay_source import (
    NO_TRANSCRIPT_REPLY,
    OFF_SCRIPT_REPLY,
    RECORDING_PREAMBLE,
    stream_recorded_demo,
)


class PaidCallAttempted(AssertionError):
    """Raised the instant anything tries to reach a billable model."""


@pytest.fixture(autouse=True)
def no_paid_calls(monkeypatch):
    """Make every route to a paid model explode.

    If this fixture ever needs a new entry, that means a new spend path was
    added — which is exactly the moment to notice.
    """

    def explode(*_args, **_kwargs):
        raise PaidCallAttempted("a visitor turn tried to reach a paid model")

    # The ADK agent path.
    import adk.agent as agent_mod

    monkeypatch.setattr(agent_mod, "resolve_model", explode, raising=False)
    monkeypatch.setattr(agent_mod, "create_agent_with_thinking", explode, raising=False)
    monkeypatch.setattr(skill_processor, "create_agent_with_thinking", explode, raising=False)
    monkeypatch.setattr(skill_processor, "build_agui_adk_agent", explode, raising=False)
    monkeypatch.setattr(skill_processor, "stream_agui_events", explode, raising=False)

    # The direct-genai path (compaction summariser, PDF extraction, titles,
    # rubric judge, report narrative, ...). One client class, ten callers.
    import google.genai as genai

    monkeypatch.setattr(genai, "Client", explode, raising=False)


@pytest.fixture(autouse=True)
def fresh_replay_progress():
    skill_processor.reset_replay_progress()
    yield
    skill_processor.reset_replay_progress()


def _visitor() -> User:
    return User(uid="visitor-1", email="curious@example.com", is_teacher=True, access_tier=TIER_VISITOR)


async def _collect(gen) -> list[dict]:
    return [event async for event in gen]


def _text_of(events: list[dict]) -> str:
    return "".join(e.get("delta", "") for e in events if e.get("type") == "TEXT_MESSAGE_CONTENT")


# --- The headline assertion --------------------------------------------------


@pytest.mark.asyncio
async def test_a_visitors_chat_turn_makes_no_paid_call(monkeypatch):
    """The whole feature in one test."""
    monkeypatch.setattr(
        "onboarding.demo_transcripts.get_transcript",
        lambda _aid: {"turns": [{"role": "assistant", "text": "Hvad arbejder du med?"}]},
    )
    visitor = _visitor()

    events = await _collect(
        skill_processor.process_skill_request(
            skill_id="any-skill",
            user=visitor,
            access=build_access_context(visitor),
            session_id="sess-1",
            message="Hej, kan du hjælpe med kastebevægelse?",
            activity_id="demo-welcome",
            allow_recorded_demo=True,
        )
    )

    assert events, "a visitor must get a conversation, not silence"
    assert "Hvad arbejder du med?" in _text_of(events)


@pytest.mark.asyncio
async def test_a_whole_visitor_session_makes_no_paid_call(monkeypatch):
    """Several turns, including one past the end of the recording."""
    monkeypatch.setattr(
        "onboarding.demo_transcripts.get_transcript",
        lambda _aid: {
            "turns": [
                {"role": "assistant", "text": "Første svar."},
                {"role": "assistant", "text": "Andet svar."},
            ]
        },
    )
    visitor = _visitor()

    replies = []
    for message in ["hej", "og så?", "men hvad med gnidning?"]:
        events = await _collect(
            skill_processor.process_skill_request(
                skill_id="any-skill",
                user=visitor,
                access=build_access_context(visitor),
                session_id="sess-multi",
                message=message,
                activity_id="demo-welcome",
                allow_recorded_demo=True,
            )
        )
        replies.append(_text_of(events))

    assert "Første svar." in replies[0]
    assert "Andet svar." in replies[1]
    # Past the end of the recording — an honest card, not a fabricated answer.
    assert "recorded session" in replies[2]


# --- The honesty properties, which are acceptance criteria not polish --------


@pytest.mark.asyncio
async def test_the_first_turn_says_it_is_a_recording():
    """Not a tooltip, not a subtitle — the first thing in the stream."""
    events = await _collect(
        stream_recorded_demo(
            transcript={"turns": [{"role": "assistant", "text": "Svar."}]},
            turn_index=0,
            thread_id="t1",
        )
    )
    text = _text_of(events)
    assert "Optaget demonstration" in text
    assert "Recorded demonstration" in text
    assert text.index("demonstration") < text.index("Svar.")


@pytest.mark.asyncio
async def test_off_script_input_is_never_answered_with_an_invention():
    """The property that makes canned content acceptable at all: a question
    nobody recorded gets an honest 'this is a recording', plus the nudge."""
    events = await _collect(
        stream_recorded_demo(
            transcript={"turns": [{"role": "assistant", "text": "Kun ét svar."}]},
            turn_index=5,  # well past the end
            thread_id="t1",
            include_preamble=False,
        )
    )
    text = _text_of(events)
    assert text.strip() == OFF_SCRIPT_REPLY.strip()
    assert "/teacher-access" in text, "the honest dead end must carry the nudge"


@pytest.mark.asyncio
async def test_an_activity_with_no_recording_degrades_honestly():
    events = await _collect(stream_recorded_demo(transcript=None, turn_index=0, thread_id="t1", include_preamble=False))
    text = _text_of(events)
    assert text.strip() == NO_TRANSCRIPT_REPLY.strip()
    assert "/teacher-access" in text


@pytest.mark.asyncio
async def test_nothing_that_reads_as_a_measurement_is_replayed():
    """No citations, no rubric scores, no tool calls. A replayed CONVERSATION is
    a demo; a replayed measurement would be a fabricated finding."""
    events = await _collect(
        stream_recorded_demo(
            transcript={"turns": [{"role": "assistant", "text": "Svar."}]},
            turn_index=0,
            thread_id="t1",
        )
    )
    emitted = {e.get("type") for e in events}
    assert not emitted & {
        "TOOL_CALL_START",
        "TOOL_CALL_ARGS",
        "TOOL_CALL_END",
        "STATE_SNAPSHOT",
        "STATE_DELTA",
    }


# --- Protocol shape: the frontend must not be able to tell ------------------


@pytest.mark.asyncio
async def test_the_replay_emits_the_same_event_sequence_as_a_live_run():
    """This is why the chat surface needs no branch — it is a second event
    SOURCE behind AG-UI, not a second transport."""
    events = await _collect(
        stream_recorded_demo(
            transcript={"turns": [{"role": "assistant", "text": "Et ret langt svar der deles op."}]},
            turn_index=0,
            thread_id="t1",
        )
    )
    types = [e.get("type") for e in events]
    assert types[0] == "RUN_STARTED"
    assert types[1] == "TEXT_MESSAGE_START"
    assert types[-2] == "TEXT_MESSAGE_END"
    assert types[-1] == "RUN_FINISHED"
    assert types.count("TEXT_MESSAGE_CONTENT") > 1, "must stream in deltas, not arrive as one paste"


@pytest.mark.asyncio
async def test_content_events_share_one_message_id():
    events = await _collect(
        stream_recorded_demo(
            transcript={"turns": [{"role": "assistant", "text": "Et svar med flere ord i."}]},
            turn_index=0,
            thread_id="t1",
        )
    )
    ids = {e.get("messageId") for e in events if e.get("type", "").startswith("TEXT_MESSAGE")}
    assert len(ids) == 1, "a torn message id would render as several chat bubbles"


def test_chunking_does_not_tear_words():
    """A break inside `**bold` or `[link](...)` makes the streaming renderer
    flicker between valid and invalid markdown — the same class of bug 1.1.15
    fixed for SVG."""
    text = "Prøv **Boldkast** og se [vejledningen](/guides) igennem."
    assert "".join(replay_source._chunk(text)).strip() == text.strip()


# --- Callers that cannot render a conversation still get the refusal --------


@pytest.mark.asyncio
async def test_non_chat_callers_still_get_the_402_error():
    """Proactive checks, MCP and channel invokers have nowhere to show a
    recording, so they keep the exception rather than silently emitting one."""
    visitor = _visitor()
    with pytest.raises(skill_processor.SpendNotAuthorisedError):
        await _collect(
            skill_processor.process_skill_request(
                skill_id="any-skill",
                user=visitor,
                access=build_access_context(visitor),
                session_id="sess-2",
                message="hello",
                # allow_recorded_demo defaults to False — opt IN, so a new
                # caller inherits the safe behaviour.
            )
        )


def test_preamble_is_exported_for_the_frontend_affordance():
    assert "Optaget demonstration" in RECORDING_PREAMBLE
