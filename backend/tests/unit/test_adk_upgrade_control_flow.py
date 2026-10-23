"""AIPLA acceptance of ADK 2 control-flow changes from upstream's upgrade plan."""

import asyncio

import pytest
from ag_ui.core import RunAgentInput, UserMessage
from ag_ui_adk import ADKAgent
from google.adk.agents import LlmAgent
from google.adk.errors.session_not_found_error import SessionNotFoundError
from google.adk.events import Event
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService, Session
from google.genai import types

from adk.agui import stream_agui_events
from adk.callbacks import handle_unknown_tool, make_permission_enforcer
from adk.mcp_observability import compose_before_tool_callbacks, make_mcp_before_tool_callback
from adk.resilient_llm import ResilientLlm, reset_provider_health

pytestmark = pytest.mark.adk_contract


async def test_generated_bad_tool_call_recovers_without_executing_a_tool_twice(monkeypatch):
    calls, mutations, notices = [], [], []

    async def no_sleep(_seconds):
        pass

    monkeypatch.setattr("adk.resilient_llm._async_sleep", no_sleep)

    def record_trial() -> dict:
        """Record the trial once."""
        mutations.append(1)
        return {"ok": True}

    class Model(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            calls.append(1)
            if len(calls) == 1:
                yield LlmResponse(error_code="MALFORMED_FUNCTION_CALL")
                return
            part = (
                types.Part(function_call=types.FunctionCall(name="record_trial", args={}))
                if len(calls) == 2
                else types.Part(text="Trial recorded.")
            )
            yield LlmResponse(content=types.Content(role="model", parts=[part]))

    sessions = InMemorySessionService()
    session = await sessions.create_session(app_name="test", user_id="u")
    model = ResilientLlm(chain=[Model(model="stub")], event_sink=lambda *a: notices.append(a))
    runner = Runner(
        agent=LlmAgent(name="tutor", model=model, tools=[record_trial]), app_name="test", session_service=sessions
    )
    events = [
        e
        async for e in runner.run_async(
            user_id="u",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text="Record the trial")]),
        )
    ]
    assert not any(e.error_code for e in events)
    assert len(calls) == 3 and mutations == [1]
    assert len(notices) == 1 and notices[0][0] == "MODEL_RETRY"
    assert any(
        e.is_final_response() and e.content and any(p.text == "Trial recorded." for p in e.content.parts or [])
        for e in events
    )


async def test_unknown_tool_recovers_through_the_real_bridge(monkeypatch):
    monkeypatch.setattr("adk.callbacks.permission.can_use_tool", lambda *a: True)
    calls = []

    class Model(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            calls.append(1)
            if len(calls) == 1:
                part = types.Part(function_call=types.FunctionCall(name="nonexistent_tool", args={}))
            else:
                results = [
                    p.function_response for c in llm_request.contents for p in c.parts or [] if p.function_response
                ]
                assert results[-1].response["ok"] is False
                assert "nonexistent_tool" in results[-1].response["error"]
                part = types.Part(text="That tool is unavailable. We can continue the investigation ourselves.")
            yield LlmResponse(content=types.Content(role="model", parts=[part]))

    agent = LlmAgent(
        name="tutor",
        model=Model(model="stub"),
        before_tool_callback=compose_before_tool_callbacks(
            make_permission_enforcer("", ""), make_mcp_before_tool_callback()
        ),
        on_tool_error_callback=handle_unknown_tool,
    )
    bridge = ADKAgent(
        adk_agent=agent,
        app_name="test",
        user_id="u",
        session_service=InMemorySessionService(),
        use_in_memory_services=True,
        use_thread_id_as_session_id=True,
    )
    run = RunAgentInput(
        thread_id="unknown-tool",
        run_id="run",
        state={},
        tools=[],
        context=[],
        forwarded_props={},
        messages=[UserMessage(id="m", role="user", content="Help with the experiment")],
    )
    try:
        wire = [e async for e in stream_agui_events(bridge, run)]
    finally:
        await bridge._session_manager.stop_cleanup_task()
    terminals = [e for e in wire if e["type"] in ("RUN_ERROR", "RUN_FINISHED")]
    assert [e["type"] for e in terminals] == ["RUN_FINISHED"]
    assert wire[0]["type"] == "RUN_STARTED"
    assert wire[-1]["type"] == "RUN_FINISHED"
    assert "unavailable" in "".join(e.get("delta", "") for e in wire if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert len(calls) == 2


class _NodeInterruptedLike(BaseException):
    """The direct BaseException inheritance of ADK 2 graph interrupts."""


@pytest.mark.parametrize("deadline", [0, 10])
@pytest.mark.parametrize("signal_type", [asyncio.CancelledError, _NodeInterruptedLike])
async def test_model_interrupt_never_retries_or_falls_back(deadline, signal_type):
    signal = signal_type("stop")
    calls = []
    notices = []

    class Interrupt(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            calls.append("primary")
            raise signal
            yield

    class Fallback(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            calls.append("fallback")
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="wrong")]))

    reset_provider_health()
    try:
        model = ResilientLlm(
            chain=[Interrupt(model="stub-primary"), Fallback(model="stub-fallback")],
            first_token_deadline_s=deadline,
            event_sink=lambda *a: notices.append(a),
        )
        with pytest.raises(signal_type) as caught:
            _ = [r async for r in model.generate_content_async(LlmRequest(), stream=True)]
        assert caught.value is signal
        assert calls == ["primary"]
        assert notices == []
    finally:
        reset_provider_health()


async def test_inmemory_requires_session_creation_before_append():
    service = InMemorySessionService()
    with pytest.raises(SessionNotFoundError, match="Session missing not found"):
        await service.append_event(session=Session(id="missing", app_name="test", user_id="u"), event=Event(author="u"))
    session = await service.create_session(app_name="test", user_id="u")
    await service.append_event(
        session=session, event=Event(author="u", content=types.Content(parts=[types.Part(text="saved")], role="user"))
    )
    restored = await service.get_session(app_name="test", user_id="u", session_id=session.id)
    assert restored.events[-1].content.parts[0].text == "saved"
