"""Describe and retry a failed model call (BENCH-2)."""

from __future__ import annotations

import pytest

from analytics import model_retry as mr


class _ApiError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(f"{code} {message}")
        self.code = code
        self.message = message


class ClientError(_ApiError):
    pass


def test_the_description_keeps_status_and_message_not_just_the_class():
    d = mr.describe_error(ClientError(429, "Resource exhausted. Please try again later."))
    assert d == "ClientError 429: Resource exhausted. Please try again later."
    long = mr.describe_error(ClientError(400, "x" * 1000))
    assert len(long) < 330 and long.endswith("…")
    assert mr.describe_error(ValueError()) == "ValueError"


def test_only_rate_limits_timeouts_and_server_errors_retry():
    assert all(mr.is_retryable(s) for s in (408, 429, 500, 503))
    assert not any(mr.is_retryable(s) for s in (None, 400, 403, 404))


async def test_a_429_is_retried_with_backoff_then_succeeds():
    sleeps: list[float] = []
    seen: list[str] = []
    calls = [0]

    async def fn():
        calls[0] += 1
        if calls[0] < 3:
            raise ClientError(429, "busy")
        return "ok"

    async def sleep(d):
        sleeps.append(d)

    out = await mr.call_with_retry(fn, label="t", sleep=sleep, on_retry=lambda a, d: seen.append(d))
    assert out == "ok" and calls[0] == 3 and sleeps == [2.0, 4.0]
    assert seen == ["ClientError 429: busy"] * 2


async def test_a_400_is_not_retried_and_the_last_failure_is_reraised():
    calls = [0]

    async def bad():
        calls[0] += 1
        raise ClientError(400, "invalid")

    async def sleep(d):  # pragma: no cover - must not run
        raise AssertionError("slept")

    with pytest.raises(ClientError):
        await mr.call_with_retry(bad, label="t", sleep=sleep)
    assert calls[0] == 1


async def test_retries_are_bounded():
    calls = [0]

    async def busy():
        calls[0] += 1
        raise ClientError(503, "unavailable")

    async def nosleep(d):
        return None

    with pytest.raises(ClientError):
        await mr.call_with_retry(busy, label="t", attempts=3, sleep=nosleep)
    assert calls[0] == 3
