"""Describe and retry a failed model call (BENCH-2, 2026-09-30).

The first BENCH-1 run lost two transcripts and recorded only ``ClientError`` —
the class name, which is the same for a 400 (our prompt is wrong: do not retry)
and a 429 (Vertex is busy: retry). This module keeps what the exception said
and retries only the second kind, a bounded number of times, logging each one.

Pure of any SDK import: ``google.genai.errors.APIError`` carries ``.code`` (the
HTTP status) and ``.message``; anything shaped like that is read the same way.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

#: Statuses worth another try: rate limit, timeout, and the server's own errors.
RETRYABLE_STATUSES = frozenset({408, 429})
#: How much of an exception's message is kept. Enough to tell a quota error
#: from a safety block, short enough that a report line stays a line.
ERROR_MESSAGE_MAX = 300
#: Total attempts (so 3 retries) and the backoff: 2s, 4s, 8s, capped.
DEFAULT_ATTEMPTS = 4
DEFAULT_BASE_DELAY = 2.0
DEFAULT_MAX_DELAY = 30.0

SleepFn = Callable[[float], Awaitable[None]]
OnRetry = Callable[[int, str], None]


def status_of(exc: BaseException) -> int | None:
    """The HTTP status an exception carries, or None when it carries none."""
    for attr in ("code", "status_code"):
        v = getattr(exc, attr, None)
        if isinstance(v, int) and not isinstance(v, bool):
            return v
    return None


def is_retryable(status: int | None) -> bool:
    return status is not None and (status in RETRYABLE_STATUSES or 500 <= status < 600)


def describe_error(exc: BaseException, limit: int = ERROR_MESSAGE_MAX) -> str:
    """``ClientError 429: Resource exhausted…`` — class, status and the message,
    truncated. Never just the class name: that is what BENCH-1 kept, and it
    could not say whether a failed transcript was our fault or Vertex's."""
    status = status_of(exc)
    msg = str(getattr(exc, "message", None) or exc or "").strip()
    msg = " ".join(msg.split())
    if len(msg) > limit:
        msg = msg[: limit - 1] + "…"
    head = type(exc).__name__ + (f" {status}" if status is not None else "")
    return f"{head}: {msg}" if msg else head


def backoff_delay(attempt: int, base: float = DEFAULT_BASE_DELAY, cap: float = DEFAULT_MAX_DELAY) -> float:
    """Delay before retry number ``attempt`` (1-based): base, 2*base, 4*base…, capped."""
    return min(cap, base * 2 ** (attempt - 1))


async def call_with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    label: str,
    attempts: int = DEFAULT_ATTEMPTS,
    base_delay: float = DEFAULT_BASE_DELAY,
    sleep: SleepFn = asyncio.sleep,
    on_retry: OnRetry | None = None,
) -> T:
    """Await ``fn()``; on an exception with a retryable status, back off and try
    again, at most ``attempts`` times in all. Anything else — and the last
    failure — is re-raised unchanged, so the caller's abstain path still runs."""
    attempts = max(1, attempts)
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as exc:
            if attempt >= attempts or not is_retryable(status_of(exc)):
                raise
            delay = backoff_delay(attempt, base_delay)
            desc = describe_error(exc)
            logger.warning("%s: %s — retry %d/%d in %.1fs", label, desc, attempt, attempts - 1, delay)
            if on_retry is not None:
                on_retry(attempt, desc)
            await sleep(delay)
    raise AssertionError("unreachable")  # pragma: no cover


__all__ = [
    "DEFAULT_ATTEMPTS",
    "DEFAULT_BASE_DELAY",
    "ERROR_MESSAGE_MAX",
    "RETRYABLE_STATUSES",
    "backoff_delay",
    "call_with_retry",
    "describe_error",
    "is_retryable",
    "status_of",
]
