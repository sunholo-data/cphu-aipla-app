"""SSE keep-alive: a comment line whenever the stream has been silent a while.

A sim-author draft turn is silent for minutes: Gemini does not stream function
call arguments, so nothing arrives until the whole page is written as
``verify_sim``'s argument. Every hop with an idle timer then cuts the stream:
on dev, the Next.js proxy's fetch died with undici ``UND_ERR_BODY_TIMEOUT``
after 300 s without a body chunk (2026-10-13). An SSE comment (a line starting
``:``) resets those timers and is ignored by every SSE parser, including the
AG-UI client's (it keeps only ``data:`` lines and skips a block with none).
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

KEEPALIVE = ": keepalive\n\n"


async def with_keepalive(source: AsyncIterator[str], interval_s: float = 15.0) -> AsyncIterator[str]:
    """Yield ``source``'s chunks; after ``interval_s`` of silence, yield a comment and keep waiting."""
    it = source.__aiter__()
    pending: asyncio.Task | None = None
    try:
        while True:
            if pending is None:
                pending = asyncio.ensure_future(it.__anext__())
            done, _ = await asyncio.wait({pending}, timeout=interval_s)
            if not done:
                yield KEEPALIVE
                continue
            task, pending = pending, None
            try:
                chunk = task.result()
            except StopAsyncIteration:
                return
            yield chunk
    finally:
        if pending is not None and not pending.done():
            pending.cancel()
        aclose = getattr(it, "aclose", None)
        if aclose is not None:
            try:
                await aclose()
            except Exception:  # closing a finished generator must not mask the real outcome
                pass
