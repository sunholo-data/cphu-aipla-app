"""A Vertex 429 must not end a student's turn on first contact.

On 2026-08-21, three bursts of ``429 RESOURCE_EXHAUSTED`` hit the prod pilot at
only 22 groups. ADK raises these as ``_ResourceExhaustedError`` out of
``Gemini.generate_content_async`` and nothing caught them, so the stream simply
stopped: the student watched a reply begin and never finish, with no error and
nothing to retry against.

Two properties matter, and the second is the subtle one:

1. A 429 raised BEFORE any content reached the client is safely retryable.
2. A 429 raised AFTER content has been yielded is **not**. ADK's ``try`` wraps
   the whole streaming loop (``google_llm.py`` ~215-260), so the exception can
   arrive mid-stream — several chunks in. Retrying there would re-run the model
   and emit a second copy of text the student can already see. That case must
   surface, not retry.

Vertex Gemini 2.x models on this project run under Dynamic Shared Quota, where
there is no per-project QPM knob to raise — best-effort capacity from a shared
pool, so 429s are an expected operating condition rather than a misconfiguration.
That is precisely why the client has to absorb them.
"""

from __future__ import annotations

import asyncio

import pytest

from adk.quota_retry import (
    FIRST_TOKEN_ATTEMPTS,
    FIRST_TOKEN_DEADLINE_ENV,
    QUOTA_RETRY_ATTEMPTS,
    FirstTokenTimeoutError,
    first_token_deadline,
    retry_on_quota_exhaustion,
)


class _Exhausted(Exception):
    """Stands in for ADK's private ``_ResourceExhaustedError``."""


def _classify(exc: BaseException) -> bool:
    return isinstance(exc, _Exhausted)


def _stream(*scripts):
    """Build an async generator factory that replays `scripts` per attempt.

    Each script is a list of chunks; a chunk that is an exception is raised.
    """
    attempts = {"n": 0}

    async def factory():
        script = scripts[min(attempts["n"], len(scripts) - 1)]
        attempts["n"] += 1
        for chunk in script:
            if isinstance(chunk, BaseException):
                raise chunk
            yield chunk

    return factory, attempts


async def _drain(agen):
    return [chunk async for chunk in agen]


class TestRetryBeforeFirstToken:
    @pytest.mark.asyncio
    async def test_a_429_before_any_output_is_retried_and_succeeds(self):
        factory, attempts = _stream([_Exhausted("429")], ["hello", " world"])

        out = await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep))

        assert out == ["hello", " world"]
        assert attempts["n"] == 2

    @pytest.mark.asyncio
    async def test_it_gives_up_after_the_configured_attempts(self):
        factory, attempts = _stream([_Exhausted("429")])

        with pytest.raises(_Exhausted):
            await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep))

        assert attempts["n"] == QUOTA_RETRY_ATTEMPTS

    @pytest.mark.asyncio
    async def test_a_non_quota_error_is_never_retried(self):
        """Retrying a real bug wastes a student's time and hides the cause."""
        factory, attempts = _stream([ValueError("bad request")])

        with pytest.raises(ValueError):
            await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep))

        assert attempts["n"] == 1


class TestNoRetryAfterOutputHasBeenSeen:
    @pytest.mark.asyncio
    async def test_a_mid_stream_429_is_not_retried(self):
        """The property that stops a duplicated reply. Chunks already yielded
        are on the student's screen; re-running the model would print the
        beginning of the answer twice."""
        factory, attempts = _stream(["Bølgelængden er ", _Exhausted("429")], ["a whole new answer"])

        with pytest.raises(_Exhausted):
            await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep))

        assert attempts["n"] == 1

    @pytest.mark.asyncio
    async def test_chunks_yielded_before_the_failure_are_not_swallowed(self):
        factory, _ = _stream(["Bølgelængden er ", _Exhausted("429")])
        seen = []

        with pytest.raises(_Exhausted):
            async for chunk in retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep):
                seen.append(chunk)

        assert seen == ["Bølgelængden er "]


class TestBackoff:
    @pytest.mark.asyncio
    async def test_it_waits_between_attempts_and_the_waits_grow(self):
        factory, _ = _stream([_Exhausted("1")], [_Exhausted("2")], ["ok"])
        waits: list[float] = []

        out = await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_recording_sleep(waits)))

        assert out == ["ok"]
        assert len(waits) == 2
        assert waits[1] > waits[0], f"backoff must grow, got {waits}"

    @pytest.mark.asyncio
    async def test_the_wait_is_jittered_so_a_class_does_not_retry_in_lockstep(self):
        """Thirty students hitting the same 429 and retrying at exactly the same
        millisecond reproduces the burst that caused it."""
        seen = set()
        for _ in range(12):
            factory, _ = _stream([_Exhausted("429")], ["ok"])
            waits: list[float] = []
            await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_recording_sleep(waits)))
            seen.add(round(waits[0], 6))

        assert len(seen) > 1, f"first wait was identical every time: {seen}"


async def _no_sleep(_seconds: float) -> None:
    return None


def _recording_sleep(sink: list[float]):
    async def _sleep(seconds: float) -> None:
        sink.append(seconds)

    return _sleep


class TestItIsActuallyWiredIn:
    """The retry above is worthless if `resolve_model` stops returning the
    subclass. That is exactly how the `writing` allowlist bug survived: correct
    code on one side, never connected to the other."""

    def test_gemini_models_are_built_quota_tolerant(self):
        from adk.agent import _QuotaTolerantGemini, resolve_model

        assert isinstance(resolve_model("gemini-2.5-flash"), _QuotaTolerantGemini)

    def test_the_override_is_still_an_async_generator(self):
        """A plain `async def` here would return a coroutine and silently drop
        every streamed chunk."""
        import inspect

        from adk.agent import _QuotaTolerantGemini

        assert inspect.isasyncgenfunction(_QuotaTolerantGemini.generate_content_async)

    def test_non_gemini_providers_are_untouched(self):
        from adk.agent import _QuotaTolerantGemini, resolve_model

        assert not isinstance(resolve_model("claude-sonnet-5"), _QuotaTolerantGemini)

    @pytest.mark.asyncio
    async def test_a_streamed_call_carries_the_deadline_and_a_blocking_one_does_not(self, monkeypatch):
        """Same footgun, second guard: the deadline only exists if the wrapper
        hands it to the seam — and only for streams, where a first chunk means
        a first token rather than the whole answer."""
        from google.adk.models.base_llm import BaseLlm

        from adk import agent as agent_mod

        seen: list[float | None] = []

        async def _fake_retry(make_stream, **kw):
            seen.append(kw.get("first_token_deadline_s"))
            yield "x"

        async def _fake_super(self, llm_request, stream=False):
            yield "x"

        monkeypatch.setattr(agent_mod, "retry_on_quota_exhaustion", _fake_retry)
        monkeypatch.setattr(BaseLlm, "generate_content_async", _fake_super)
        model = agent_mod._QuotaTolerantGemini(model="gemini-3.5-flash-lite")

        await _drain(model.generate_content_async(None, stream=True))
        await _drain(model.generate_content_async(None, stream=False))

        assert seen == [10.0, None]


# --- The first-token deadline (2026-09-21) ---
#
# Thirty days of prod timing logs held six turns whose first token took 48-105 s:
# ``Sending out request`` and then silence, no error, no 429. The student's
# browser gave up at ~38 s; the backend was still waiting. The turns either side
# of each stall ran in 1-3 s, so a fresh request is the fix — under the SAME
# rule as the 429: only ever before the first chunk.


class _Stall(Exception):
    """Raised by a scripted stream to mark 'this attempt would hang here'."""


def _stalling_stream(*scripts):
    """Like ``_stream`` but a ``_Stall`` marker sleeps forever instead of raising,
    and records whether the abandoned generator was closed."""
    attempts = {"n": 0, "closed": 0}

    async def factory():
        script = scripts[min(attempts["n"], len(scripts) - 1)]
        attempts["n"] += 1
        try:
            for chunk in script:
                if isinstance(chunk, _Stall):
                    await asyncio.sleep(3600)
                elif isinstance(chunk, BaseException):
                    raise chunk
                yield chunk
        finally:
            attempts["closed"] += 1

    return factory, attempts


class TestFirstTokenDeadline:
    @pytest.mark.asyncio
    async def test_a_stalled_first_attempt_is_dropped_and_the_retry_answers(self):
        factory, attempts = _stalling_stream([_Stall()], ["Bølgelængden er ", "5 m"])

        out = await _drain(
            retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep, first_token_deadline_s=0.05)
        )

        assert out == ["Bølgelængden er ", "5 m"]
        assert attempts["n"] == 2
        # The abandoned request must actually be torn down, not left streaming
        # into nowhere on a connection nobody is reading.
        assert attempts["closed"] == 2

    @pytest.mark.asyncio
    async def test_two_stalls_give_up_with_a_named_error(self):
        factory, attempts = _stalling_stream([_Stall()])

        with pytest.raises(FirstTokenTimeoutError):
            await _drain(
                retry_on_quota_exhaustion(
                    factory, is_quota_error=_classify, sleep=_no_sleep, first_token_deadline_s=0.05
                )
            )

        assert attempts["n"] == FIRST_TOKEN_ATTEMPTS

    @pytest.mark.asyncio
    async def test_the_deadline_never_applies_once_output_has_started(self):
        """A slow tail is not a stall. Once the student can read text, the
        stream runs to completion however long the rest takes."""

        async def factory():
            yield "first"
            await asyncio.sleep(0.2)  # well past the 0.05 s deadline below
            yield "second"

        out = await _drain(
            retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep, first_token_deadline_s=0.05)
        )

        assert out == ["first", "second"]

    @pytest.mark.asyncio
    async def test_no_deadline_means_no_deadline(self):
        """Non-streaming callers pass ``None``: their single chunk IS the whole
        answer, and a long answer is not a stall."""

        async def factory():
            await asyncio.sleep(0.1)
            yield "the whole answer"

        out = await _drain(retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep))
        assert out == ["the whole answer"]

    @pytest.mark.asyncio
    async def test_a_stream_that_ends_with_no_chunks_is_not_a_stall(self):
        async def factory():
            return
            yield  # pragma: no cover — makes this an async generator

        out = await _drain(
            retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep, first_token_deadline_s=0.05)
        )
        assert out == []

    @pytest.mark.asyncio
    async def test_a_429_after_a_stall_still_gets_its_own_retry(self):
        """The two failure shapes share the rule, not the budget."""
        factory, attempts = _stalling_stream([_Stall()], [_Exhausted("429")], ["ok"])

        out = await _drain(
            retry_on_quota_exhaustion(factory, is_quota_error=_classify, sleep=_no_sleep, first_token_deadline_s=0.05)
        )

        assert out == ["ok"]
        assert attempts["n"] == 3


class TestDeadlineConfig:
    def test_default_is_ten_seconds(self, monkeypatch):
        monkeypatch.delenv(FIRST_TOKEN_DEADLINE_ENV, raising=False)
        assert first_token_deadline() == 10.0

    def test_zero_disables_it(self, monkeypatch):
        monkeypatch.setenv(FIRST_TOKEN_DEADLINE_ENV, "0")
        assert first_token_deadline() is None

    def test_garbage_falls_back_to_the_default_rather_than_crashing_a_turn(self, monkeypatch):
        monkeypatch.setenv(FIRST_TOKEN_DEADLINE_ENV, "soon")
        assert first_token_deadline() == 10.0
