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

import pytest

from adk.quota_retry import QUOTA_RETRY_ATTEMPTS, retry_on_quota_exhaustion


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
