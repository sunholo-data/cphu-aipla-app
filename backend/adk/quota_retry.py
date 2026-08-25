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
"""

from __future__ import annotations

import asyncio
import logging
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


async def retry_on_quota_exhaustion(
    make_stream: Callable[[], AsyncIterator[Any]],
    *,
    is_quota_error: Callable[[BaseException], bool] = _is_resource_exhausted,
    attempts: int = QUOTA_RETRY_ATTEMPTS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> AsyncIterator[Any]:
    """Yield from ``make_stream()``, retrying quota errors that arrive early.

    Args:
        make_stream: Called once per attempt; must return a FRESH async
            iterator. Passing an already-started iterator cannot work — a
            consumed generator has nothing left to replay.
        is_quota_error: Predicate identifying a retryable quota failure.
        attempts: Total attempts, including the first.
        sleep: Injected for tests; defaults to ``asyncio.sleep``.

    Yields:
        Whatever the underlying stream yields.

    Raises:
        The underlying exception, if it is not a quota error, if any output has
        already been yielded, or if every attempt is exhausted.
    """
    for attempt in range(1, attempts + 1):
        yielded = 0
        try:
            async for chunk in make_stream():
                yielded += 1
                yield chunk
            return
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
