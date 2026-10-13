"""Stage labels reach the wire while the agent is busy (adk/agui.py _with_progress_flush)."""

from __future__ import annotations

import asyncio

import pytest

from adk.agui import _with_progress_flush


class _Stage:
    def __init__(self, label: str) -> None:
        self.label = label

    def model_dump(self, **_kw) -> dict:
        return {"type": "CUSTOM", "name": "STAGE_PROGRESS", "value": {"label": self.label}}


class _Tracker:
    def __init__(self) -> None:
        self.queue: list[_Stage] = []

    def drain_stage_events(self) -> list[_Stage]:
        out, self.queue = self.queue, []
        return out


@pytest.mark.asyncio
async def test_a_label_set_mid_step_is_flushed_before_the_step_ends():
    tracker = _Tracker()

    async def agent():
        yield "event-1"
        tracker.queue.append(_Stage("Checking version 1 in the browser…"))  # a tool starts its long step
        await asyncio.sleep(0.3)
        yield "event-2"

    out = [e async for e in _with_progress_flush(agent(), tracker, poll_s=0.05)]
    assert out[0] == "event-1" and out[-1] == "event-2"
    assert {
        "type": "CUSTOM",
        "name": "STAGE_PROGRESS",
        "value": {"label": "Checking version 1 in the browser…"},
    } in out[1:-1]


@pytest.mark.asyncio
async def test_a_fast_agent_passes_through_unchanged():
    tracker = _Tracker()

    async def agent():
        for i in range(3):
            yield i

    assert [e async for e in _with_progress_flush(agent(), tracker, poll_s=1.0)] == [0, 1, 2]
