"""Heartbeat wrappers must preserve and close the upstream generator's context."""

from __future__ import annotations

import asyncio
from contextvars import ContextVar

import pytest

from adk.agui import _with_progress_flush
from protocols.sse_keepalive import with_keepalive


class _Tracker:
    def drain_stage_events(self):
        return []


@pytest.fixture(params=["keepalive", "progress"])
def wrap(request):
    if request.param == "keepalive":
        return lambda source: with_keepalive(source, interval_s=1)
    return lambda source: _with_progress_flush(source, _Tracker(), poll_s=1)


@pytest.mark.asyncio
async def test_iteration_and_cleanup_share_one_context(wrap):
    owner = ContextVar("owner", default="caller")
    closed = asyncio.Event()

    async def source():
        token = owner.set("stream")
        try:
            for _ in range(3):
                await asyncio.sleep(0)
                assert owner.get() == "stream"
                yield "chunk"
        finally:
            owner.reset(token)
            closed.set()

    assert [item async for item in wrap(source())] == ["chunk"] * 3
    assert closed.is_set()
    assert owner.get() == "caller"


@pytest.mark.asyncio
async def test_disconnect_awaits_source_cleanup_in_its_own_context(wrap):
    owner = ContextVar("owner", default="caller")
    closed = asyncio.Event()

    async def source():
        token = owner.set("stream")
        try:
            yield "chunk"
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            owner.reset(token)
            closed.set()

    stream = wrap(source())
    assert await anext(stream) == "chunk"
    await stream.aclose()
    assert closed.is_set()
    assert owner.get() == "caller"


@pytest.mark.asyncio
async def test_source_errors_reach_the_caller_after_cleanup(wrap):
    closed = asyncio.Event()

    async def source():
        try:
            yield "chunk"
            raise RuntimeError("source failed")
        finally:
            closed.set()

    with pytest.raises(RuntimeError, match="source failed"):
        _ = [item async for item in wrap(source())]
    assert closed.is_set()


@pytest.mark.asyncio
async def test_cancelling_a_waiting_consumer_awaits_cleanup(wrap):
    waiting = asyncio.Event()
    closed = asyncio.Event()

    async def source():
        try:
            yield "chunk"
            waiting.set()
            await asyncio.Event().wait()
        finally:
            await asyncio.sleep(0)
            closed.set()

    stream = wrap(source())
    assert await anext(stream) == "chunk"
    consumer = asyncio.create_task(anext(stream))
    await waiting.wait()
    consumer.cancel()
    with pytest.raises(asyncio.CancelledError):
        await consumer
    assert closed.is_set()


@pytest.mark.asyncio
async def test_source_cancellation_does_not_leave_an_endless_heartbeat(wrap):
    async def source():
        yield "chunk"
        raise asyncio.CancelledError

    async def collect():
        return [item async for item in wrap(source())]

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(collect(), timeout=2)
