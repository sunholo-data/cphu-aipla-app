"""Escalate hard turns to the smart tier, up front (1.1.142 M3).

Two deterministic pre-routing rules, no "is this hard?" model call:

* **escalation** — the student's CURRENT message carries an image;
* **opt_in** — the activity sets ``modelTier: smart`` (researcher-only route).

Pinned here:

1. The image rule reads the student's current message ONLY — not a teacher's
   reference image injected before it on every turn, not a photo earlier in the
   history, not a drawing agent's own preview inside a function response — and
   it holds across the tool round-trips of one turn.
2. An escalated turn starts on the smart member, keeps the default behind it
   (a smart-tier failure before visible output still gets an answer), and its
   stall deadline leaves the default room to answer.
3. The answer is stamped ``served_model`` + ``model_route`` — the M4 split.
4. It is wired: ``resolve_model`` gives the platform default an escalation
   target, a pinned model none; ``_apply_activity_model_tier`` reads the config.
5. The opt-in is researcher-only, survives a teacher's full-payload save, and
   does not travel with a copy.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest
from google.adk.models.llm_response import LlmResponse
from google.genai import errors as genai_errors
from google.genai import types

from adk import resilient_llm as rl
from adk.model_routing import (
    MODEL_ROUTE_KEY,
    ROUTE_ESCALATION,
    ROUTE_OPT_IN,
    activity_opts_into_smart,
    latest_student_message_has_image,
)
from adk.resilient_llm import ResilientLlm

LITE, SMART = "gemini-3.5-flash-lite", "gemini-3.8-flash"


# --- fixtures ----------------------------------------------------------------------


def _image_part() -> types.Part:
    return types.Part(inline_data=types.Blob(mime_type="image/png", data=b"\x89PNG"))


def _user(*parts: types.Part) -> types.Content:
    return types.Content(role="user", parts=list(parts))


def _model_text(text: str) -> types.Content:
    return types.Content(role="model", parts=[types.Part(text=text)])


def _call() -> types.Content:
    return types.Content(role="model", parts=[types.Part(function_call=types.FunctionCall(name="t", args={}))])


def _response(*inner: types.FunctionResponsePart) -> types.Content:
    fr = types.FunctionResponse(name="t", response={"ok": True}, parts=list(inner) or None)
    return types.Content(role="user", parts=[types.Part(function_response=fr)])


def _req(*contents: types.Content) -> SimpleNamespace:
    return SimpleNamespace(model=LITE, contents=list(contents))


def _text(text: str) -> LlmResponse:
    return LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]), partial=False)


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class _Stall:
    pass


class _Scripted:
    def __init__(self, model: str, runs: list[list[Any]]) -> None:
        self.model = model
        self.runs = runs
        self.calls = 0
        self.deadlines: list[float | None] = []

    async def generate_content_async(self, llm_request: Any, stream: bool = False):
        run = self.runs[min(self.calls, len(self.runs) - 1)]
        self.calls += 1
        for item in run:
            if isinstance(item, _Stall):
                await asyncio.sleep(3600)
            elif isinstance(item, Exception):
                raise item
            else:
                yield item


@pytest.fixture(autouse=True)
def harness(monkeypatch):
    rl.reset_provider_health()
    clock = _Clock()

    async def _fake_sleep(seconds: float) -> None:
        clock.now += seconds

    monkeypatch.setattr(rl, "_async_sleep", _fake_sleep)
    monkeypatch.setattr(rl, "_monotonic", clock)
    monkeypatch.delenv(rl.FIRST_TOKEN_DEADLINE_ENV, raising=False)
    yield clock
    rl.reset_provider_health()


def _wrap(lite: _Scripted, smart: _Scripted, **kwargs) -> tuple[ResilientLlm, list[tuple[str, dict]]]:
    events: list[tuple[str, dict]] = []
    wrapper = ResilientLlm(
        chain=[lite, smart], escalation_index=1, event_sink=lambda n, v: events.append((n, v)), **kwargs
    )
    return wrapper, events


async def _run(wrapper: ResilientLlm, request: Any, *, stream: bool = True) -> list[LlmResponse]:
    return [r async for r in wrapper.generate_content_async(request, stream=stream)]


def _server_error() -> genai_errors.ServerError:
    return genai_errors.ServerError(500, {"error": {"message": "Internal error encountered.", "status": "INTERNAL"}})


# --- 1. what counts as "the turn carries an image" -----------------------------------


def test_a_photo_in_the_students_current_message_counts():
    assert latest_student_message_has_image(_req(_user(types.Part(text="se her"), _image_part())))


def test_a_text_message_does_not():
    assert not latest_student_message_has_image(_req(_user(types.Part(text="hvad er amplituden?"))))


def test_a_teachers_reference_image_injected_before_the_message_does_not():
    """callbacks/activity_images.py inserts the activity's images BEFORE the
    student's message on every turn — escalating on them would put the whole
    activity on the smart tier."""
    req = _req(
        _user(types.Part(text="[Reference image for this activity: kredsløb — attached by the teacher]")),
        _user(_image_part()),
        _user(types.Part(text="hvad sker der?")),
    )
    assert not latest_student_message_has_image(req)


def test_a_photo_earlier_in_the_history_does_not():
    req = _req(_user(_image_part()), _model_text("Jeg kan se ..."), _user(types.Part(text="og så?")))
    assert not latest_student_message_has_image(req)


def test_the_tool_round_trip_of_an_image_turn_still_routes_as_the_image_turn():
    """A turn must not switch model half-way: the follow-up call after a tool
    response routes like the turn's first call."""
    req = _req(_user(types.Part(text="tjek min tegning"), _image_part()), _call(), _response())
    assert latest_student_message_has_image(req)


def test_a_drawing_agents_own_preview_inside_a_function_response_does_not():
    preview = types.FunctionResponsePart(inline_data=types.FunctionResponseBlob(mime_type="image/png", data=b"x"))
    req = _req(_user(types.Part(text="tegn en bølge")), _call(), _response(preview))
    assert not latest_student_message_has_image(req)


def test_no_contents_is_not_an_image_turn():
    assert not latest_student_message_has_image(SimpleNamespace())


# --- 2+3. routing, fallback behind the smart tier, the stamp ---------------------------


async def test_an_image_turn_starts_on_the_smart_tier_and_is_stamped():
    lite = _Scripted(LITE, [[_text("lite")]])
    smart = _Scripted(SMART, [[_text("smart")]])
    wrapper, events = _wrap(lite, smart)

    out = await _run(wrapper, _req(_user(_image_part())))

    assert [r.content.parts[0].text for r in out] == ["smart"]
    assert (lite.calls, smart.calls) == (0, 1)
    assert out[0].custom_metadata == {rl.SERVED_MODEL_KEY: SMART, MODEL_ROUTE_KEY: ROUTE_ESCALATION}
    assert events == [(rl.MODEL_ESCALATION_EVENT, {"from_model": LITE, "to_model": SMART, "route": ROUTE_ESCALATION})]


async def test_a_text_turn_stays_on_the_default_unstamped():
    lite = _Scripted(LITE, [[_text("lite")]])
    smart = _Scripted(SMART, [[_text("smart")]])
    wrapper, events = _wrap(lite, smart)

    out = await _run(wrapper, _req(_user(types.Part(text="hej"))))

    assert (lite.calls, smart.calls) == (1, 0)
    assert out[0].custom_metadata is None
    assert events == []


async def test_an_opted_in_activity_puts_every_turn_on_the_smart_tier():
    lite = _Scripted(LITE, [[_text("lite")]])
    smart = _Scripted(SMART, [[_text("smart")]])
    wrapper, _ = _wrap(lite, smart)
    wrapper.opt_in_smart = True

    out = await _run(wrapper, _req(_user(types.Part(text="hej"))))

    assert (lite.calls, smart.calls) == (0, 1)
    assert out[0].custom_metadata == {rl.SERVED_MODEL_KEY: SMART, MODEL_ROUTE_KEY: ROUTE_OPT_IN}


async def test_a_failing_smart_tier_still_gets_the_student_an_answer_from_the_default():
    lite = _Scripted(LITE, [[_text("lite svar")]])
    smart = _Scripted(SMART, [[_server_error()]])
    wrapper, events = _wrap(lite, smart)

    out = await _run(wrapper, _req(_user(_image_part())))

    assert [r.content.parts[0].text for r in out] == ["lite svar"]
    assert smart.calls == 1 + wrapper.max_retries_per_model
    assert lite.calls == 1
    # Answered by the chain head: no served-model stamp, priced as the default.
    assert out[0].custom_metadata is None
    assert events[0][0] == rl.MODEL_ESCALATION_EVENT
    assert rl.MODEL_FALLBACK_EVENT in [n for n, _ in events]


async def test_a_stalled_smart_tier_falls_back_without_a_stall_retry(harness, monkeypatch):
    """The escalated primary waits budget-minus-reserve (not the tutor's 10 s,
    which its ~20 s p90 would trip on most turns), then hands over at once."""
    lite = _Scripted(LITE, [[_text("lite svar")]])
    smart = _Scripted(SMART, [[_Stall()]])
    wrapper, _ = _wrap(lite, smart)
    waits: list[float] = []
    real_wait_for = asyncio.wait_for

    async def _spy(aw, timeout):
        waits.append(timeout)
        if len(waits) == 1:  # the smart tier's first-token wait: simulate it running out
            harness.now += timeout
            aw.close()
            raise TimeoutError
        return await real_wait_for(aw, timeout)

    monkeypatch.setattr(rl.asyncio, "wait_for", _spy)
    out = await _run(wrapper, _req(_user(_image_part())))

    assert [r.content.parts[0].text for r in out] == ["lite svar"]
    assert len(waits) == 2  # smart once, then the default: no stall retry on the escalated primary
    assert waits[0] == pytest.approx(rl.FAILOVER_BUDGET_SECONDS - rl.ESCALATION_FALLBACK_RESERVE_S)
    assert waits[1] == pytest.approx(rl.ESCALATION_FALLBACK_RESERVE_S)  # the default gets the rest


def test_an_escalation_index_outside_the_chain_is_refused():
    with pytest.raises(ValueError, match="outside"):
        ResilientLlm(chain=[_Scripted(LITE, [[]])], escalation_index=3)


def test_index_zero_means_no_escalation():
    assert (
        ResilientLlm(chain=[_Scripted(LITE, [[]]), _Scripted(SMART, [[]])], escalation_index=0).escalation_index is None
    )


# --- 4. wiring -----------------------------------------------------------------------


def test_the_platform_default_can_escalate_and_a_pinned_model_cannot():
    from adk.agent import resolve_model
    from config.models import default_model, smart_model

    head = resolve_model(default_model())
    assert head.chain_models[head.escalation_index] == smart_model()

    pinned = resolve_model(smart_model())
    assert pinned.escalation_index is None


def test_apply_activity_model_tier_reads_the_config():
    from adk.agent import _apply_activity_model_tier, resolve_model
    from config.models import default_model, smart_model

    head = resolve_model(default_model())
    _apply_activity_model_tier(head, SimpleNamespace(model_tier="smart"))
    assert head.opt_in_smart is True
    _apply_activity_model_tier(head, SimpleNamespace(model_tier="default"))
    assert head.opt_in_smart is False
    _apply_activity_model_tier(head, None)
    assert head.opt_in_smart is False

    pinned = resolve_model(smart_model())
    _apply_activity_model_tier(pinned, SimpleNamespace(model_tier="smart"))
    assert pinned.opt_in_smart is False  # a pinned model keeps its pin


def test_activity_opts_into_smart():
    assert activity_opts_into_smart(SimpleNamespace(model_tier="smart"))
    assert not activity_opts_into_smart(SimpleNamespace(model_tier="default"))
    assert not activity_opts_into_smart(None)


def test_the_activity_tier_reaches_the_resolved_config():
    from adk.teacher_focus import _activity_to_config
    from db.models.activity import Activity

    cfg = _activity_to_config(Activity(activityId="act-x", ownerUid="t", modelTier="smart"), class_id="c")
    assert cfg.model_tier == "smart"
    assert Activity(activityId="act-y", ownerUid="t").model_tier == "default"
