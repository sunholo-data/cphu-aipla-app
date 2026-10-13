"""SSE keep-alive comments during a silent stream (protocols/sse_keepalive.py)."""

from __future__ import annotations

import asyncio

import pytest

from protocols.sse_keepalive import KEEPALIVE, with_keepalive


async def _collect(agen) -> list[str]:
    return [c async for c in agen]


@pytest.mark.asyncio
async def test_a_chatty_stream_passes_through_untouched():
    async def src():
        for i in range(3):
            yield f"data: {i}\n\n"

    assert await _collect(with_keepalive(src(), 1.0)) == ["data: 0\n\n", "data: 1\n\n", "data: 2\n\n"]


@pytest.mark.asyncio
async def test_a_silent_gap_gets_keepalive_comments_and_order_is_kept():
    async def src():
        yield "data: a\n\n"
        await asyncio.sleep(0.25)
        yield "data: b\n\n"

    out = await _collect(with_keepalive(src(), 0.05))
    assert out[0] == "data: a\n\n" and out[-1] == "data: b\n\n"
    assert out.count(KEEPALIVE) >= 3
    assert all(c == KEEPALIVE for c in out[1:-1])


@pytest.mark.asyncio
async def test_closing_early_closes_the_source():
    closed = asyncio.Event()

    async def src():
        try:
            while True:
                yield "data: x\n\n"
                await asyncio.sleep(0)
        finally:
            closed.set()

    agen = with_keepalive(src(), 1.0)
    assert await agen.__anext__() == "data: x\n\n"
    await agen.aclose()
    assert closed.is_set()


@pytest.mark.asyncio
async def test_an_error_in_the_source_propagates():
    async def src():
        yield "data: 1\n\n"
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await _collect(with_keepalive(src(), 1.0))


def test_a_keepalive_is_an_sse_comment():
    assert KEEPALIVE.startswith(":") and KEEPALIVE.endswith("\n\n") and "data:" not in KEEPALIVE
