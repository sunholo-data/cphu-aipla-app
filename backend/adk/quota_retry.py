"""Absorb Vertex 429s that would otherwise end a student's turn mid-sentence.

Found in the 2026-08-21 prod pilot logs: three bursts of
``429 RESOURCE_EXHAUSTED``, surfacing as ADK's ``_ResourceExhaustedError`` out of
``Gemini.generate_content_async``. Nothing caught them, so the stream stopped —
no error in the UI, no partial answer explained, nothing for the student to act
on. At only 22 groups, and the pilot scales up from there.

**Why this is a client-side problem, not a quota request.** Gemini 2.x models on
Vertex serve this project under Dynamic Shared Quota: capacity comes from a
shared pool on a best-effort basis and there is no per-project requests-per-minute
limit to raise. A 429 is an expected operating condition. The only ways to change
that are Provisioned Throughput (a purchasing decision) or absorbing the burst
here.

**The retry is deliberately narrow.** ADK wraps its entire streaming loop in one
``try`` (``google/adk/models/google_llm.py`` ~215-260), so a 429 can arrive after
chunks have already been yielded to the client. Re-running the model at that
point emits a second copy of text the student can already read. So:

- 429 with **nothing yielded yet** → retry with jittered backoff.
- 429 **after any chunk** → re-raise. A truncated answer is bad; a truncated
  answer followed by a different answer spliced onto it is worse.

Jitter matters more than it looks: a class of thirty devices that all hit the
same burst and all retry at exactly the same millisecond simply recreates it.

**The first-token deadline (2026-09-21).** The other way a turn dies before it
starts is silence: Vertex accepts the request and no token arrives. Thirty days
of prod timing logs held six of these — 105 s, 89 s, 81 s, 61 s, 49 s, 48 s to
first token — every one on a request that logged ``Sending out request`` and
then nothing, no error, no retry. The student's browser gave up at ~38 s with
``network error`` while the backend was still waiting. The stalls are
per-request, not systemic (the turns either side ran in 1-3 s), so the fix is
the same shape as the 429 one: if nothing has been yielded by the deadline,
drop the attempt and make a fresh one. Same narrowness — a deadline only ever
applies BEFORE the first chunk; once the student can see text, the stream runs
to completion however long that takes.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

# Three total attempts: the observed bursts lasted seconds, not minutes, and a
# student is watching a spinner the whole time. Beyond this the honest thing is
# to say so rather than keep them waiting.
QUOTA_RETRY_ATTEMPTS = 3

# First backoff. Doubles per attempt, so waits are ~0.5s then ~1.0s (plus
# jitter) — under two seconds of added latency in the worst case.
QUOTA_RETRY_BASE_DELAY_S = 0.5

# Jitter as a fraction of the computed delay.
QUOTA_RETRY_JITTER = 0.5

#: Env override for the first-token deadline (seconds). Blank/unset → the
#: default below; ``0`` disables the deadline entirely.
FIRST_TOKEN_DEADLINE_ENV = "AIPLA_FIRST_TOKEN_DEADLINE_S"

# Prod flash-lite model-side first-token latency (v0.1.49+, 114 turns): 108
# under 6.1 s, then 14.9, 18.1, 20.1, 36, 58, 78 s — bimodal, with nothing
# between 6 and 15. 10 s sits in that gap. It also has to fit the client:
# `useSkillAgent` abandons a silent stream at 30 s, and the turn carries ~3 s
# of session setup before the model is even asked, so a stall + retry must
# answer inside ~27 s. 10 + ~1 s (a healthy retry) does; 15 + 15 would not.
FIRST_TOKEN_DEADLINE_S = 10.0

# One retry: a stalled request is a bad draw, not a bad model, and the second
# draw came back in seconds every time we could observe it. A third wait would
# push the turn past the point the client has already abandoned it.
FIRST_TOKEN_ATTEMPTS = 2


class FirstTokenTimeoutError(TimeoutError):
    """No token arrived from the model within the deadline, on every attempt."""


def first_token_deadline() -> float | None:
    """The configured first-token deadline in seconds, or ``None`` when disabled."""
    raw = (os.environ.get(FIRST_TOKEN_DEADLINE_ENV) or "").strip()
    if not raw:
        return FIRST_TOKEN_DEADLINE_S
    try:
        value = float(raw)
    except ValueError:
        logger.warning(
            "%s=%r is not a number — using the default %.0fs", FIRST_TOKEN_DEADLINE_ENV, raw, FIRST_TOKEN_DEADLINE_S
        )
        return FIRST_TOKEN_DEADLINE_S
    return value if value > 0 else None


def _is_resource_exhausted(exc: BaseException) -> bool:
    """True for ADK's private ``_ResourceExhaustedError`` and bare 429s.

    Matched by NAME rather than by import: the ADK class is private
    (``google.adk.models.google_llm._ResourceExhaustedError``) and importing it
    would couple us to an underscore-prefixed symbol across ADK upgrades. The
    ``code``/``status`` check catches ``google.genai.errors.ClientError`` 429s
    arriving by any other route.
    """
    if type(exc).__name__ == "_ResourceExhaustedError":
        return True
    if getattr(exc, "code", None) == 429:
        return True
    status = getattr(exc, "status", "") or ""
    return "RESOURCE_EXHAUSTED" in str(status).upper()


_END = object()


async def _first_chunk_within(stream: AsyncIterator[Any], deadline_s: float) -> tuple[bool, Any]:
    """Await the first chunk of ``stream`` for at most ``deadline_s`` seconds.

    Returns ``(True, chunk)`` or ``(True, _END)`` on a natural end; ``(False,
    None)`` on timeout, with the stream closed so the underlying HTTP request is
    dropped rather than left streaming into nowhere.
    """
    try:
        chunk = await asyncio.wait_for(stream.__anext__(), timeout=deadline_s)
    except StopAsyncIteration:
        return True, _END
    except TimeoutError:
        aclose = getattr(stream, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except BaseException as exc:  # a dead stream may object to closing; irrelevant now
                logger.debug("first-token: aclose after timeout raised %r (ignored)", exc)
        return False, None
    return True, chunk


async def retry_on_quota_exhaustion(
    make_stream: Callable[[], AsyncIterator[Any]],
    *,
    is_quota_error: Callable[[BaseException], bool] = _is_resource_exhausted,
    attempts: int = QUOTA_RETRY_ATTEMPTS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    first_token_deadline_s: float | None = None,
    first_token_attempts: int = FIRST_TOKEN_ATTEMPTS,
) -> AsyncIterator[Any]:
    """Yield from ``make_stream()``, retrying failures that arrive BEFORE any output.

    Two failure shapes, one rule: nothing yielded yet → try again; anything
    yielded → let it surface.

    Args:
        make_stream: Called once per attempt; must return a FRESH async
            iterator. Passing an already-started iterator cannot work — a
            consumed generator has nothing left to replay.
        is_quota_error: Predicate identifying a retryable quota failure.
        attempts: Total attempts for quota errors, including the first.
        sleep: Injected for tests; defaults to ``asyncio.sleep``.
        first_token_deadline_s: Seconds to wait for the FIRST chunk of an
            attempt before abandoning it. ``None`` disables the deadline (the
            default, so non-streaming callers are untouched).
        first_token_attempts: Total attempts when the deadline fires,
            including the first.

    Yields:
        Whatever the underlying stream yields.

    Raises:
        The underlying exception, if it is not a quota error, if any output has
        already been yielded, or if every attempt is exhausted;
        :class:`FirstTokenTimeoutError` when every attempt stalled.
    """
    stalls = 0
    for attempt in range(1, attempts + 1):
        yielded = 0
        try:
            stream = make_stream()
            if first_token_deadline_s is not None:
                arrived, first = await _first_chunk_within(stream, first_token_deadline_s)
                if not arrived:
                    stalls += 1
                    if stalls >= first_token_attempts:
                        logger.error(
                            "first-token: no token after %.1fs on %d attempt(s) — giving up",
                            first_token_deadline_s,
                            stalls,
                        )
                        raise FirstTokenTimeoutError(
                            f"the model sent nothing for {first_token_deadline_s:.0f}s on {stalls} attempt(s)"
                        )
                    delay = random.uniform(0, QUOTA_RETRY_BASE_DELAY_S)
                    logger.warning(
                        "first-token: no token after %.1fs on attempt %d — retrying in %.2fs",
                        first_token_deadline_s,
                        attempt,
                        delay,
                    )
                    await sleep(delay)
                    continue
                if first is _END:
                    return
                yielded += 1
                yield first
            async for chunk in stream:
                yielded += 1
                yield chunk
            return
        except FirstTokenTimeoutError:
            raise
        except BaseException as exc:
            if not is_quota_error(exc):
                raise

            if yielded:
                # Mid-stream. The student is already reading a partial answer;
                # a retry would append a second, different one to it.
                logger.warning(
                    "quota: 429 after %d chunk(s) on attempt %d — NOT retrying, a retry would duplicate visible output",
                    yielded,
                    attempt,
                )
                raise

            if attempt >= attempts:
                logger.error(
                    "quota: 429 on attempt %d of %d with no output yielded — giving up",
                    attempt,
                    attempts,
                )
                raise

            delay = QUOTA_RETRY_BASE_DELAY_S * (2 ** (attempt - 1))
            delay += random.uniform(0, delay * QUOTA_RETRY_JITTER)
            logger.warning(
                "quota: 429 on attempt %d of %d before first token — retrying in %.2fs",
                attempt,
                attempts,
                delay,
            )
            await sleep(delay)
