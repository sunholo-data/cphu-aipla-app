"""A teacher's turn outlives the connection that started it.

A Sim workshop build runs for minutes, and a phone cuts the connection whenever
its screen locks or the browser goes to the background: iOS suspends the tab and
the stream fetch dies ("Load failed"). Starlette then closes the response
generator, which closed the agent's event stream, which cancelled the run, so
the half-built sim was never checked and never saved (prod, 2026-10-14).

``outlive_client`` moves the run into its own task. The response reads from it
while the client is there; when the client goes away the task keeps running to
the end of the turn (bounded by ``limit_s``), and the turn is saved to the
session like any other, so reopening the chat shows it. Only teacher streams use
it: a student turn takes seconds, and an abandoned one should not keep spending.

While a teacher's run is in flight for a session (attached or not), a new turn
on that session is refused (``is_running``), because two runs appending to one
ADK session at once corrupt it; the client is told to wait and reload instead.
The co-pilot asks the same question after a dropped stream, and reloads the
conversation once the run has finished.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from typing import Any, TypeVar

_log = logging.getLogger(__name__)

T = TypeVar("T")

#: Long enough for the longest Sim workshop turn; the request timeout is 1800 s.
DEFAULT_LIMIT_S = 20 * 60

_DONE = object()

# session id -> (owner uid, started at). One entry per teacher run in flight;
# this instance only (session affinity keeps a teacher on one).
_RUNNING: dict[str, tuple[str, float]] = {}
# Strong references, so a detached task is not garbage-collected mid-run.
_TASKS: set[asyncio.Task[Any]] = set()


class _Raised:
    def __init__(self, exc: BaseException) -> None:
        self.exc = exc


def is_running(session_id: str | None, uid: str | None = None) -> bool:
    """True while a run for ``session_id`` (owned by ``uid``, when given) is in flight."""
    if not session_id:
        return False
    entry = _RUNNING.get(session_id)
    if entry is None:
        return False
    return uid is None or entry[0] == uid


async def outlive_client(
    source: AsyncIterator[T],
    *,
    session_id: str | None,
    uid: str,
    limit_s: float = DEFAULT_LIMIT_S,
) -> AsyncIterator[T]:
    """Yield ``source``'s items; if the consumer leaves early, finish ``source`` anyway."""
    queue: asyncio.Queue[Any] = asyncio.Queue()
    attached = True

    async def pump() -> None:
        try:
            async for item in source:
                if attached:
                    queue.put_nowait(item)
        except asyncio.CancelledError:
            queue.put_nowait(_DONE)
            raise
        except BaseException as exc:  # handed to the consumer, who re-raises it
            queue.put_nowait(_Raised(exc))
            if not attached:
                _log.warning("detached run for session %s failed: %s", session_id, exc)
        finally:
            queue.put_nowait(_DONE)
            aclose = getattr(source, "aclose", None)
            if aclose is not None:
                try:
                    await aclose()
                except Exception:  # closing a finished generator must not mask the real outcome
                    pass

    task = asyncio.ensure_future(pump())
    started = time.monotonic()
    if session_id:
        _RUNNING[session_id] = (uid, started)

    def _forget(_: asyncio.Task[Any]) -> None:
        if session_id and _RUNNING.get(session_id, (None, None))[1] == started:
            del _RUNNING[session_id]

    task.add_done_callback(_forget)
    finished = False
    try:
        while True:
            item = await queue.get()
            if item is _DONE:
                finished = True
                return
            if isinstance(item, _Raised):
                finished = True
                raise item.exc
            yield item
    finally:
        if not finished and not task.done():
            attached = False
            _detach(task, session_id=session_id, limit_s=limit_s)


def _detach(task: asyncio.Task[Any], *, session_id: str | None, limit_s: float) -> None:
    started = time.monotonic()
    _TASKS.add(task)
    _log.info("client left mid-turn; run for session %s carries on (limit %ss)", session_id, int(limit_s))
    timer = asyncio.get_running_loop().call_later(limit_s, task.cancel)

    def _finished(t: asyncio.Task[Any]) -> None:
        timer.cancel()
        _TASKS.discard(t)
        _log.info(
            "detached run for session %s %s after %ss",
            session_id,
            "was stopped at the limit" if t.cancelled() else "finished",
            int(time.monotonic() - started),
        )

    task.add_done_callback(_finished)
