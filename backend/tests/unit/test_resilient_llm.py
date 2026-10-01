"""Retry, then fail over (1.1.142 M1+M2) — ``adk/resilient_llm.py``.

The motivating turn: on 2026-09-22 a Gemini ``500 INTERNAL`` ended a student's
turn outright. ``adk/quota_retry.py`` matched 429 only, and nothing could fail
over although ``gemini-3.8-flash`` was registered and healthy.

The contract pinned here, with scripted members and a fake clock:

1. **Passthrough.** Yielded responses are the same objects, same order.
2. **Retry only what is transient (429, 5xx, a first-token stall), only before
   visible output.** One answer reaches the student, never two.
3. **Fail over only before visible output.** After the student has seen text, a
   second model would splice a second answer onto the first, so the turn fails
   with a typed ``ModelTurnError`` instead.
4. **The whole thing fits a < 30 s budget**, enforced on the clock rather than
   on retry counts alone.
5. **It is actually wired in**: ``resolve_model`` builds the chain for the
   platform default, a chain of one for a pinned model, and leaves non-Gemini
   providers alone. (The quota retry it replaces had the same guard, because a
   correct wrapper nobody constructs fixes nothing.)

Adapted from upstream ``platform-source`` ``tests/unit/test_resilient_llm.py`` @
``b322f55d`` — its LiteLLM fixtures are replaced by recorded-shape google-genai
errors, since AIPLA's chain is Gemini-only.
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace
from typing import Any

import pytest
from google.adk.models.llm_response import LlmResponse
from google.genai import errors as genai_errors
from google.genai import types

from adk import resilient_llm as rl
from adk.model_errors import ModelTurnError, SilentStallError
from adk.resilient_llm import ResilientLlm

# --- Fixtures -----------------------------------------------------------------


def _server_error(code: int = 500, status: str = "INTERNAL") -> genai_errors.ServerError:
    return genai_errors.ServerError(code, {"error": {"message": "Internal error encountered.", "status": status}})


def _rate_limited(message: str = "Resource exhausted") -> genai_errors.ClientError:
    return genai_errors.ClientError(429, {"error": {"message": message, "status": "RESOURCE_EXHAUSTED"}})


def _bad_request() -> genai_errors.ClientError:
    return genai_errors.ClientError(400, {"error": {"message": "invalid argument", "status": "INVALID_ARGUMENT"}})


def _text(text: str, *, partial: bool = True) -> LlmResponse:
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]), partial=partial)


def _thought(text: str) -> LlmResponse:
    part = types.Part(text=text)
    part.thought = True
    return LlmResponse(content=types.Content(role="model", parts=[part]), partial=True)


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class _Stall:
    """Script marker: this attempt goes silent (a real hang, cut by the deadline)."""


class _Takes:
    """Script marker: this step costs `seconds` of (fake) wall-clock."""

    def __init__(self, seconds: float) -> None:
        self.seconds = seconds


class _ScriptedLlm:
    """BaseLlm stand-in. Each call consumes the next run; a run is a list of
    LlmResponse (yield), Exception (raise), ``_Stall`` or ``_Takes``."""

    def __init__(self, model: str, runs: list[list[Any]], clock: _Clock | None = None) -> None:
        self.model = model
        self.runs = runs
        self.calls = 0
        self.closed = 0
        self.seen_models: list[str | None] = []
        self._clock = clock

    async def generate_content_async(self, llm_request: Any, stream: bool = False):
        self.seen_models.append(getattr(llm_request, "model", None))
        run = self.runs[min(self.calls, len(self.runs) - 1)]
        self.calls += 1
        try:
            for item in run:
                if isinstance(item, _Stall):
                    await asyncio.sleep(3600)
                elif isinstance(item, _Takes):
                    if self._clock is not None:
                        self._clock.now += item.seconds
                elif isinstance(item, Exception):
                    raise item
                else:
                    yield item
        except (GeneratorExit, asyncio.CancelledError):
            self.closed += 1
            raise


@pytest.fixture(autouse=True)
def harness(monkeypatch):
    """Fresh cooldown registry, a fake clock, and a sleep that advances it."""
    rl.reset_provider_health()
    clock = _Clock()
    sleeps: list[float] = []

    async def _fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        clock.now += seconds

    monkeypatch.setattr(rl, "_async_sleep", _fake_sleep)
    monkeypatch.setattr(rl, "_monotonic", clock)
    monkeypatch.delenv(rl.FIRST_TOKEN_DEADLINE_ENV, raising=False)
    yield SimpleNamespace(clock=clock, sleeps=sleeps)
    rl.reset_provider_health()


def _wrap(*members: _ScriptedLlm, **kwargs) -> tuple[ResilientLlm, list[tuple[str, dict]]]:
    events: list[tuple[str, dict]] = []
    wrapper = ResilientLlm(chain=list(members), event_sink=lambda n, v: events.append((n, v)), **kwargs)
    return wrapper, events


async def _run(wrapper: ResilientLlm, *, stream: bool = True, request: Any = None) -> list[LlmResponse]:
    req = request if request is not None else SimpleNamespace(model=wrapper.model)
    return [r async for r in wrapper.generate_content_async(req, stream=stream)]


def _texts(responses: list[LlmResponse]) -> list[str]:
    return [r.content.parts[0].text for r in responses]


LITE, SMART = "gemini-3.5-flash-lite", "gemini-3.8-flash"


# --- 1. Passthrough -----------------------------------------------------------


@pytest.mark.asyncio
async def test_happy_path_passthrough_is_identical(harness):
    responses = [_thought("hmm"), _text("Hel"), _text("lo"), _text("Hello", partial=False)]
    primary = _ScriptedLlm(LITE, [list(responses)])
    wrapper, events = _wrap(primary, _ScriptedLlm(SMART, [[_text("never")]]))

    out = await _run(wrapper)

    assert all(a is b for a, b in zip(out, responses, strict=True))
    assert all(r.custom_metadata is None for r in out), "the head answering is not a fail-over — no stamp"
    assert events == []
    assert primary.calls == 1


@pytest.mark.asyncio
async def test_the_override_is_an_async_generator():
    """A plain ``async def`` would return a coroutine and drop every chunk."""
    assert inspect.isasyncgenfunction(ResilientLlm.generate_content_async)


# --- 2. Retry (transient, before visible output) --------------------------------


@pytest.mark.asyncio
async def test_a_500_then_success_is_one_turn_with_no_duplicate(harness):
    """The 22 Sep shape: ``500 INTERNAL`` before the first token, then a healthy draw."""
    primary = _ScriptedLlm(LITE, [[_server_error()], [_text("Svaret", partial=True), _text("Svaret", partial=False)]])
    fallback = _ScriptedLlm(SMART, [[_text("never", partial=False)]])
    wrapper, events = _wrap(primary, fallback)

    out = await _run(wrapper)

    assert _texts(out) == ["Svaret", "Svaret"]  # exactly the one healthy attempt's stream
    assert primary.calls == 2
    assert fallback.calls == 0
    assert [e[0] for e in events] == ["MODEL_RETRY"]
    assert events[0][1]["code"] == "MODEL_UNAVAILABLE"
    assert len(harness.sleeps) == 1 and 0 < harness.sleeps[0] <= rl.BACKOFF_CAP_SECONDS


@pytest.mark.asyncio
async def test_a_429_retry_after_is_honoured(harness):
    primary = _ScriptedLlm(LITE, [[_rate_limited('quota [{"retryDelay": "4s"}]')], [_text("ok", partial=False)]])
    wrapper, _ = _wrap(primary)

    out = await _run(wrapper)

    assert _texts(out) == ["ok"]
    assert harness.sleeps == [4.0]


@pytest.mark.asyncio
async def test_a_429_retry_after_is_capped(harness):
    """Vertex may ask for a minute; beyond the 10 s cap, waiting loses to moving on."""
    primary = _ScriptedLlm(LITE, [[_rate_limited('quota [{"retryDelay": "60s"}]')], [_text("ok", partial=False)]])
    wrapper, _ = _wrap(primary)

    await _run(wrapper)

    assert harness.sleeps == [10.0]


@pytest.mark.asyncio
async def test_a_bad_request_is_not_retried_and_not_failed_over(harness):
    primary = _ScriptedLlm(LITE, [[_bad_request()]])
    fallback = _ScriptedLlm(SMART, [[_text("never", partial=False)]])
    wrapper, events = _wrap(primary, fallback)

    with pytest.raises(ModelTurnError) as exc_info:
        await _run(wrapper)

    assert exc_info.value.error_class.code == "MODEL_REQUEST_INVALID"
    assert isinstance(exc_info.value.__cause__, genai_errors.ClientError)  # skill_processor translates the cause
    assert (primary.calls, fallback.calls) == (1, 0)
    assert events == []


# --- 3. Fail over --------------------------------------------------------------


@pytest.mark.asyncio
async def test_persistent_5xx_on_the_primary_fails_over_to_the_smart_tier(harness):
    primary = _ScriptedLlm(LITE, [[_server_error(503, "UNAVAILABLE")]])
    fallback = _ScriptedLlm(SMART, [[_text("Smart", partial=True), _text("Smart svar", partial=False)]])
    wrapper, events = _wrap(primary, fallback)

    out = await _run(wrapper)

    assert _texts(out) == ["Smart", "Smart svar"]
    assert primary.calls == 1 + wrapper.max_retries_per_model
    assert fallback.calls == 1
    fb = [v for n, v in events if n == "MODEL_FALLBACK"]
    assert fb == [{"from_model": LITE, "to_model": SMART, "code": "MODEL_UNAVAILABLE", "provider": "gemini"}]
    # Every response of a failed-over turn names the model that answered, so the
    # chat-log row and the cost dashboard do not file it under flash-lite.
    assert all(r.custom_metadata == {rl.SERVED_MODEL_KEY: SMART} for r in out)


@pytest.mark.asyncio
async def test_each_member_is_called_with_its_own_model_id(harness):
    primary = _ScriptedLlm(LITE, [[_server_error()]])
    fallback = _ScriptedLlm(SMART, [[_text("ok", partial=False)]])
    wrapper, _ = _wrap(primary, fallback)
    request = SimpleNamespace(model=LITE)  # ADK stamps the head, once

    await _run(wrapper, request=request)

    assert set(primary.seen_models) == {LITE}
    assert fallback.seen_models == [SMART]
    assert request.model == SMART


@pytest.mark.asyncio
async def test_the_chain_exhausted_raises_the_last_failure(harness):
    primary = _ScriptedLlm(LITE, [[_server_error()]])
    fallback = _ScriptedLlm(SMART, [[_rate_limited()]])
    wrapper, events = _wrap(primary, fallback)

    with pytest.raises(ModelTurnError) as exc_info:
        await _run(wrapper)

    assert exc_info.value.error_class.code == "MODEL_RATE_LIMITED"
    assert exc_info.value.model == SMART
    assert [n for n, _ in events].count("MODEL_FALLBACK") == 1


# --- 4. The visible-output gate --------------------------------------------------


@pytest.mark.asyncio
async def test_a_failure_after_partial_output_is_typed_and_never_answered_twice(harness):
    primary = _ScriptedLlm(LITE, [[_text("Lad os se på amp"), _server_error()]])
    fallback = _ScriptedLlm(SMART, [[_text("A second, different answer", partial=False)]])
    wrapper, events = _wrap(primary, fallback)
    seen: list[LlmResponse] = []

    with pytest.raises(ModelTurnError) as exc_info:
        async for response in wrapper.generate_content_async(SimpleNamespace(model=LITE), stream=True):
            seen.append(response)

    assert _texts(seen) == ["Lad os se på amp"]  # the partial, and nothing spliced after it
    assert exc_info.value.error_class.code == "MODEL_UNAVAILABLE"
    assert (primary.calls, fallback.calls) == (1, 0)
    assert not [n for n, _ in events if n in ("MODEL_RETRY", "MODEL_FALLBACK")]


@pytest.mark.asyncio
async def test_thought_only_output_still_fails_over(harness):
    """Thinking never reached the student as answer text; repeating it beats a dead turn."""
    primary = _ScriptedLlm(LITE, [[_thought("deep analysis"), _server_error()]])
    fallback = _ScriptedLlm(SMART, [[_text("saved", partial=False)]])
    wrapper, _ = _wrap(primary, fallback)

    out = await _run(wrapper)

    assert out[-1].content.parts[0].text == "saved"
    assert fallback.calls == 1


# --- 5. The < 30 s budget --------------------------------------------------------


def test_the_budget_is_under_thirty_seconds():
    """The browser abandons a silent stream at 30 s, ~3 s of which is session setup."""
    assert rl.FAILOVER_BUDGET_SECONDS < 30
    assert ResilientLlm(chain=[_ScriptedLlm(LITE, [[]])]).budget_s == rl.FAILOVER_BUDGET_SECONDS


@pytest.mark.asyncio
async def test_slow_failures_stop_at_the_budget(harness):
    """Each primary failure takes 12 s to arrive. After two there is no room for a
    third attempt or a fallback — the turn ends inside the budget, typed."""
    primary = _ScriptedLlm(LITE, [[_Takes(12.0), _server_error()]], clock=harness.clock)
    fallback = _ScriptedLlm(SMART, [[_text("too late", partial=False)]])
    wrapper, _ = _wrap(primary, fallback)
    start = harness.clock.now

    with pytest.raises(ModelTurnError):
        await _run(wrapper)

    assert primary.calls == 2
    assert fallback.calls == 0
    assert harness.clock.now - start <= rl.FAILOVER_BUDGET_SECONDS


@pytest.mark.asyncio
async def test_a_wait_that_would_overrun_the_budget_fails_over_instead(harness):
    """18 s gone and Vertex asks for 10 more: the smart tier, now, beats waiting."""
    primary = _ScriptedLlm(LITE, [[_Takes(18.0), _rate_limited('quota [{"retryDelay": "10s"}]')]], clock=harness.clock)
    fallback = _ScriptedLlm(SMART, [[_text("saved", partial=False)]])
    wrapper, events = _wrap(primary, fallback)

    out = await _run(wrapper)

    assert _texts(out) == ["saved"]
    assert harness.sleeps == []
    assert primary.calls == 1
    assert [n for n, _ in events] == ["MODEL_FALLBACK"]


@pytest.mark.asyncio
async def test_retries_alone_stay_inside_the_budget(harness):
    """Three 429s each asking for the 10 s cap would be 30 s of waiting by count
    alone; the clock stops it before then."""
    primary = _ScriptedLlm(LITE, [[_rate_limited('quota [{"retryDelay": "10s"}]')]])
    wrapper, _ = _wrap(primary)
    start = harness.clock.now

    with pytest.raises(ModelTurnError):
        await _run(wrapper)

    assert sum(harness.sleeps) <= rl.FAILOVER_BUDGET_SECONDS
    assert harness.clock.now - start <= rl.FAILOVER_BUDGET_SECONDS


# --- 6. First-token stalls (moved in from quota_retry, 2026-09-21) ----------------


@pytest.mark.asyncio
async def test_a_stall_is_retried_once_then_answered(harness, monkeypatch):
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "0.05")
    primary = _ScriptedLlm(LITE, [[_Stall()], [_text("ok", partial=False)]])
    wrapper, events = _wrap(primary, _ScriptedLlm(SMART, [[_text("never")]]))

    out = await _run(wrapper)

    assert _texts(out) == ["ok"]
    assert primary.calls == 2
    assert primary.closed == 1, "the abandoned request must be closed, not left streaming into nowhere"
    assert [n for n, _ in events] == ["MODEL_RETRY"]


@pytest.mark.asyncio
async def test_two_stalls_fail_over(harness, monkeypatch):
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "0.05")
    primary = _ScriptedLlm(LITE, [[_Stall()]])
    fallback = _ScriptedLlm(SMART, [[_text("saved", partial=False)]])
    wrapper, events = _wrap(primary, fallback)

    out = await _run(wrapper)

    assert _texts(out) == ["saved"]
    assert primary.calls == 1 + rl.MAX_STALL_RETRIES
    assert [n for n, _ in events] == ["MODEL_RETRY", "MODEL_FALLBACK"]


@pytest.mark.asyncio
async def test_a_stall_on_a_chain_of_one_ends_typed(harness, monkeypatch):
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "0.05")
    primary = _ScriptedLlm(LITE, [[_Stall()]])
    wrapper, _ = _wrap(primary)

    with pytest.raises(ModelTurnError) as exc_info:
        await _run(wrapper)

    assert isinstance(exc_info.value.__cause__, SilentStallError)
    assert exc_info.value.error_class.code == "MODEL_SILENT_STALL"
    assert primary.calls == 2


@pytest.mark.asyncio
async def test_the_deadline_only_applies_before_the_first_chunk(harness, monkeypatch):
    """Once the student can see text, the stream runs however long it takes."""
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "0.05")

    class _SlowAfterFirst(_ScriptedLlm):
        async def generate_content_async(self, llm_request, stream=False):
            self.calls += 1
            yield _text("first")
            await asyncio.sleep(0.15)
            yield _text("second", partial=False)

    primary = _SlowAfterFirst(LITE, [])
    wrapper, events = _wrap(primary)

    out = await _run(wrapper)

    assert _texts(out) == ["first", "second"]
    assert events == []


@pytest.mark.asyncio
async def test_a_non_streamed_call_has_no_deadline(harness, monkeypatch):
    """A non-streamed call's single response IS the whole answer; its length is not a stall."""
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "0.05")

    class _Slow(_ScriptedLlm):
        async def generate_content_async(self, llm_request, stream=False):
            self.calls += 1
            await asyncio.sleep(0.15)
            yield _text("whole answer", partial=False)

    primary = _Slow(LITE, [])
    wrapper, _ = _wrap(primary)

    assert _texts(await _run(wrapper, stream=False)) == ["whole answer"]
    assert primary.calls == 1


def test_first_token_deadline_env(monkeypatch):
    monkeypatch.delenv(rl.FIRST_TOKEN_DEADLINE_ENV, raising=False)
    assert rl.first_token_deadline() == 10.0
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "0")
    assert rl.first_token_deadline() is None
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "soon")
    assert rl.first_token_deadline() == 10.0
    monkeypatch.setenv(rl.FIRST_TOKEN_DEADLINE_ENV, "7.5")
    assert rl.first_token_deadline() == 7.5


# --- 7. Cooldown (keyed by MODEL, not provider) -----------------------------------


@pytest.mark.asyncio
async def test_a_failing_head_is_benched_and_later_turns_skip_it(harness):
    for _ in range(rl.COOLDOWN_THRESHOLD):
        wrapper, _ = _wrap(
            _ScriptedLlm(LITE, [[_server_error()]]), _ScriptedLlm(SMART, [[_text("saved", partial=False)]])
        )
        await _run(wrapper)

    primary = _ScriptedLlm(LITE, [[_text("never", partial=False)]])
    wrapper, events = _wrap(primary, _ScriptedLlm(SMART, [[_text("saved", partial=False)]]))
    out = await _run(wrapper)

    assert _texts(out) == ["saved"]
    assert primary.calls == 0
    assert events[0][1]["reason"] == "model_cooldown"


@pytest.mark.asyncio
async def test_a_pinned_models_failures_do_not_bench_the_tutor_head(harness):
    """Upstream benched by PROVIDER. Every AIPLA model is Gemini, so that would let
    a pinned 3.6-flash skill's outage bench flash-lite for every student."""
    for _ in range(rl.COOLDOWN_THRESHOLD + 1):
        wrapper, _ = _wrap(_ScriptedLlm("gemini-3.6-flash", [[_server_error()]]))
        with pytest.raises(ModelTurnError):
            await _run(wrapper)

    primary = _ScriptedLlm(LITE, [[_text("fine", partial=False)]])
    wrapper, _ = _wrap(primary, _ScriptedLlm(SMART, [[_text("never")]]))
    assert _texts(await _run(wrapper)) == ["fine"]
    assert primary.calls == 1


# --- 8. Wired in: resolve_model + the registry -------------------------------------


def test_the_platform_default_gets_the_whole_chain():
    from adk.agent import resolve_model
    from config.models import default_model, tutor_chain

    model = resolve_model(default_model())

    assert isinstance(model, ResilientLlm)
    assert model.chain_models == tutor_chain() == [LITE, SMART]
    assert model.model == LITE  # ADK stamps llm_request.model with a gemini-* id


def test_a_pinned_model_gets_retry_but_no_fail_over():
    from adk.agent import resolve_model

    model = resolve_model("gemini-3.6-flash")

    assert isinstance(model, ResilientLlm)
    assert model.chain_models == ["gemini-3.6-flash"]


def test_the_members_are_bare_gemini_so_retries_live_in_one_layer():
    from google.adk.models import Gemini

    from adk.agent import resolve_model

    model = resolve_model("gemini-3.5-flash-lite")
    assert all(type(m) is Gemini for m in model.chain)
    assert all(m.retry_options is None for m in model.chain)


def test_non_gemini_models_are_unaffected():
    from google.adk.models import Claude

    from adk.agent import resolve_model

    model = resolve_model("claude-sonnet-4-6")
    assert isinstance(model, Claude)
    assert not isinstance(model, ResilientLlm)


@pytest.mark.asyncio
async def test_real_gemini_members_fail_over(monkeypatch, harness):
    """End to end through resolve_model's real Gemini members: the head 500s, the
    smart tier answers — with each member's own model id."""
    from google.adk.models import Gemini

    from adk.agent import resolve_model

    calls: list[str] = []

    async def _fake_generate(self, llm_request, stream=False):
        calls.append(self.model)
        if self.model == LITE:
            raise _server_error()
        yield _text(f"answered by {self.model}", partial=False)

    monkeypatch.setattr(Gemini, "generate_content_async", _fake_generate)
    model = resolve_model(LITE)
    model.event_sink = lambda n, v: None

    out = await _run(model)

    assert _texts(out) == [f"answered by {SMART}"]
    assert calls == [LITE, LITE, LITE, SMART]


def _models_config(**overrides):
    from config.models import ModelEntry, ModelsConfig

    def entry(model_id, api, provider="google", tier="default"):
        return ModelEntry(
            id=model_id,
            api_name=api,
            provider=provider,
            tier=tier,
            context_window=1,
            max_output_tokens=1,
            description="",
        )

    models = [
        entry("lite", "gemini-lite"),
        entry("smart", "gemini-smart", tier="smart"),
        entry("claude", "claude-x", provider="anthropic"),
    ]
    kwargs = {"models": models, "defaults": {"google": "lite"}, "platform_default": "lite"}
    kwargs.update(overrides)
    return ModelsConfig(**kwargs)


def test_tutor_chain_validation():
    assert _models_config(tutor_chain=["lite", "smart"]).tutor_chain == ["lite", "smart"]
    assert _models_config().tutor_chain is None  # optional — an older YAML still loads
    with pytest.raises(ValueError, match="must start with platform_default"):
        _models_config(tutor_chain=["smart", "lite"])
    with pytest.raises(ValueError, match="not found"):
        _models_config(tutor_chain=["lite", "gemini-9"])
    with pytest.raises(ValueError, match="not a google model"):
        _models_config(tutor_chain=["lite", "claude"])
    with pytest.raises(ValueError, match="repeats"):
        _models_config(tutor_chain=["lite", "lite"])
    with pytest.raises(ValueError, match="must not be empty"):
        _models_config(tutor_chain=[])


# --- 9. The chat-log stamp ------------------------------------------------------------


def test_the_chat_log_names_the_model_that_answered():
    from adk.callbacks.session import _served_model

    failed_over = SimpleNamespace(custom_metadata={rl.SERVED_MODEL_KEY: SMART})
    normal = SimpleNamespace(custom_metadata=None)

    assert _served_model(failed_over, LITE) == SMART
    assert _served_model(normal, LITE) == LITE
    assert _served_model(SimpleNamespace(), None) is None


@pytest.mark.asyncio
async def test_the_stamp_survives_into_the_adk_session_event(harness):
    """The stamp is only useful if ADK carries ``custom_metadata`` from the
    response onto the persisted event the chat-log callback reads."""
    from google.adk.agents import LlmAgent
    from google.adk.models.base_llm import BaseLlm
    from google.adk.runners import InMemoryRunner

    class _Down(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            raise _server_error()
            yield  # pragma: no cover — makes this an async generator

    class _Up(BaseLlm):
        async def generate_content_async(self, llm_request, stream=False):
            yield _text("Hej fra smart", partial=False)

    model = ResilientLlm(chain=[_Down(model=LITE), _Up(model=SMART)], event_sink=lambda n, v: None)
    agent = LlmAgent(name="tutor", model=model, instruction="Be brief.")
    runner = InMemoryRunner(agent=agent, app_name="t")
    session = await runner.session_service.create_session(app_name="t", user_id="u")

    events = [
        e
        async for e in runner.run_async(
            user_id="u",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text="hej")]),
        )
    ]

    answers = [e for e in events if e.author == "tutor" and e.content and e.content.parts]
    assert [p.text for e in answers for p in e.content.parts] == ["Hej fra smart"]  # once
    assert answers[0].custom_metadata == {rl.SERVED_MODEL_KEY: SMART}


def test_a_model_turn_error_reads_as_a_student_message_not_a_stack():
    from adk.model_errors import ErrorClass
    from skills.skill_processor import _translate_model_turn_error

    exc = ModelTurnError(ErrorClass(transient=True, fallbackable=True, code="MODEL_UNAVAILABLE"), SMART)
    message, code = _translate_model_turn_error(exc)

    assert code == "MODEL_UNAVAILABLE"
    assert "prøv igen" in message.lower()
    assert SMART not in message
