"""A teacher's turn finishes after the client leaves (protocols/detached_runs.py)."""

from __future__ import annotations

import asyncio

import pytest

from protocols import detached_runs
from protocols.detached_runs import is_running, outlive_client


async def _events(n: int, done: list[str], delay: float = 0.01):
    try:
        for i in range(n):
            await asyncio.sleep(delay)
            yield i
        done.append("finished")
    except asyncio.CancelledError:
        done.append("cancelled")
        raise


@pytest.mark.asyncio
async def test_passes_every_item_through_while_the_client_stays():
    done: list[str] = []
    seen_running = []
    async for i in outlive_client(_events(5, done), session_id="s1", uid="u"):
        seen_running.append(is_running("s1", "u"))
        assert i == len(seen_running) - 1
    assert all(seen_running)  # a run is "in flight" while attached too
    assert done == ["finished"]
    await asyncio.sleep(0)
    assert not is_running("s1")


@pytest.mark.asyncio
async def test_the_run_finishes_when_the_client_leaves_mid_turn():
    done: list[str] = []
    gen = outlive_client(_events(10, done), session_id="s2", uid="teacher-a")
    assert await gen.__anext__() == 0
    await gen.aclose()  # what Starlette does when the phone drops the connection
    assert is_running("s2")
    assert is_running("s2", "teacher-a")
    assert not is_running("s2", "teacher-b")  # only the run's own teacher sees it
    for _ in range(100):
        if done:
            break
        await asyncio.sleep(0.02)
    assert done == ["finished"]
    await asyncio.sleep(0)
    assert not is_running("s2")


@pytest.mark.asyncio
async def test_a_cancelled_consumer_does_not_cancel_the_run():
    done: list[str] = []
    gen = outlive_client(_events(6, done), session_id="s3", uid="u")

    async def consume():
        async for _ in gen:
            pass

    task = asyncio.ensure_future(consume())
    await asyncio.sleep(0.025)
    task.cancel()  # Starlette cancels the response task on disconnect
    with pytest.raises(asyncio.CancelledError):
        await task
    for _ in range(100):
        if done:
            break
        await asyncio.sleep(0.02)
    assert done == ["finished"]


@pytest.mark.asyncio
async def test_a_detached_run_stops_at_the_limit():
    done: list[str] = []
    gen = outlive_client(_events(1000, done, delay=0.05), session_id="s4", uid="u", limit_s=0.1)
    await gen.__anext__()
    await gen.aclose()
    for _ in range(100):
        if done:
            break
        await asyncio.sleep(0.02)
    assert done == ["cancelled"]
    await asyncio.sleep(0)
    assert not is_running("s4")
    assert not detached_runs._TASKS


@pytest.mark.asyncio
async def test_an_error_reaches_the_attached_client():
    async def boom():
        yield 1
        raise ValueError("model failed")

    gen = outlive_client(boom(), session_id=None, uid="u")
    assert await gen.__anext__() == 1
    with pytest.raises(ValueError, match="model failed"):
        await gen.__anext__()
