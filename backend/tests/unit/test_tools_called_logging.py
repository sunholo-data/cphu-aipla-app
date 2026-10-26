"""Every tutor row names the tools that reply called (1.1.152 M1a).

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md (F4, M1)

Until 2026-10-26 no chat-log row recorded a tool call. A ``function_call``
event has no text part, and ``_emit_new_turns`` skips events without text, so
"is the maths tool being called?" (notes 2026-10-22) had no answer for ANY tool.
These tests drive the real emitter with real ADK events, because the bug lived in
how a function-call part looks, not in the logic around it.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

from google.adk.events import Event
from google.genai import types

from adk.callbacks.session import _emit_new_turns, _tools_per_tutor_row

GROUP = "bold-kazoo-87"
INV = "inv-1"


def _text(author: str, text: str, inv: str = INV) -> Event:
    return Event(author=author, invocation_id=inv, content=types.Content(parts=[types.Part(text=text)]))


def _call(name: str, inv: str = INV) -> Event:
    return Event(
        author="tutor",
        invocation_id=inv,
        content=types.Content(role="model", parts=[types.Part.from_function_call(name=name, args={"x": 1})]),
    )


def _response(name: str, inv: str = INV) -> Event:
    return Event(
        author="tutor",
        invocation_id=inv,
        content=types.Content(parts=[types.Part.from_function_response(name=name, response={"ok": True})]),
    )


def _run(events: list[Event]) -> list[dict]:
    session = SimpleNamespace(events=events)
    ctx = SimpleNamespace(invocation_id=INV)
    with (
        mock.patch("observability.chat_log.emit_chat_turn") as emit,
        mock.patch("skills.skill_config.get_skill", return_value=None),
    ):
        _emit_new_turns(session, "sess-1", "anon-uid", "concept-dialogue", ctx, group_id=GROUP)
    return [c.kwargs for c in emit.call_args_list]


def test_a_tool_call_with_no_text_is_not_dropped():
    """The F4 bug written as a test: the call event has no text, the reply after it does."""
    rows = _run(
        [
            _text("user", "hvad sker der hvis jeg skruer op?"),
            _call("control_sim"),
            _response("control_sim"),
            _text("tutor", "Jeg har sat effekten til 2000 W. Hvad forventer du?"),
        ]
    )
    tutor = [r for r in rows if r["role"] == "tutor"]
    assert len(tutor) == 1
    assert tutor[0]["tools_called"] == "control_sim"
    assert tutor[0]["tool_call_count"] == 1


def test_a_tutor_reply_with_no_tools_is_recorded_as_none_called_not_null():
    """'' / 0 = recorded, nothing called. NULL is reserved for 'not recorded'."""
    rows = _run([_text("user", "hej"), _text("tutor", "Hej! Hvad vil du undersøge?")])
    tutor = next(r for r in rows if r["role"] == "tutor")
    assert tutor["tools_called"] == ""
    assert tutor["tool_call_count"] == 0


def test_student_rows_carry_null():
    rows = _run([_text("user", "hej"), _text("tutor", "Hej!")])
    student = next(r for r in rows if r["role"] == "student")
    assert student["tools_called"] is None
    assert student["tool_call_count"] is None


def test_each_call_is_counted_once_across_several_tutor_rows():
    """Calls go to the NEXT tutor text, so summing tool_call_count is a true total."""
    rows = _run(
        [
            _text("user", "tegn det"),
            _call("draw_physics_diagram"),
            _response("draw_physics_diagram"),
            _text("tutor", "Her er tegningen."),
            _call("control_sim"),
            _call("control_sim"),
            _text("tutor", "Og nu kører simuleringen."),
        ]
    )
    tutor = [r for r in rows if r["role"] == "tutor"]
    assert [r["tools_called"] for r in tutor] == ["draw_physics_diagram", "control_sim,control_sim"]
    assert sum(r["tool_call_count"] for r in tutor) == 3


def test_a_call_after_the_last_reply_lands_on_that_reply():
    """E.g. a checkpoint recorded after the tutor has answered."""
    rows = _run([_text("user", "færdig"), _text("tutor", "Godt arbejde."), _call("record_checkpoint")])
    tutor = next(r for r in rows if r["role"] == "tutor")
    assert tutor["tools_called"] == "record_checkpoint"


def test_other_invocations_are_ignored():
    events = [_call("control_sim", inv="older"), _text("user", "hej"), _text("tutor", "Hej!")]
    assert _tools_per_tutor_row(events, INV) == {2: []}
