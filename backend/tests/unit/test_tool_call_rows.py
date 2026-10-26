"""One ``aipla_tool_call`` row per tool call (1.1.152 M1b).

Design: docs/design/aipla/v1.1.0-feedback/verifiable-maths-tool.md (M1, "Recording tool use")

M1a put the tool NAMES on the tutor row. M1b logs each call: whether it
worked, and for the calculation tools only, exactly what was asked and what the
engine answered, so a researcher can re-run every calculation the tutor ever
did (``calc_id``). These drive the real walk with real ADK events, the
``test_tools_called_logging.py`` shape, because the pairing of a call with its
response lives in how those parts look.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest import mock
from unittest.mock import MagicMock, patch

from google.adk.events import Event
from google.genai import types

from adk.callbacks.session import _emit_new_turns, _tool_calls_of_invocation, _tools_per_tutor_row
from observability import chat_log

GROUP = "bold-kazoo-87"
INV = "inv-1"

CALC_ARGS = {"expression": "P * t", "quantities": ["P = 2000 W", "t = 150 s"]}
CALC_RESULT = {
    "ok": True,
    "expression": "P * t",
    "result": {"value": 300.0, "unit": "kJ", "si_value": 300000.0, "si_unit": "J"},
    "calc_id": "calc_5f20c92aabbb7c33",
    "latex": "$E = P \\cdot t = 300\\,\\text{kJ}$",
}

TOOL_CALL_KEYS = {
    "group_id",
    "session_id",
    "skill_id",
    "invocation_id",
    "turn_index",
    "call_index",
    "tool",
    "ok",
    "error",
    "args",
    "result",
    "calc_id",
    "class_id",
    "activity_id",
    "revision",
    "app_version",
}


def _text(author: str, text: str, inv: str = INV) -> Event:
    return Event(author=author, invocation_id=inv, content=types.Content(parts=[types.Part(text=text)]))


def _call(name: str, args: dict | None = None, call_id: str | None = None, inv: str = INV) -> Event:
    part = types.Part.from_function_call(name=name, args=args or {"x": 1})
    if call_id:
        part.function_call.id = call_id
    return Event(author="tutor", invocation_id=inv, content=types.Content(role="model", parts=[part]))


def _response(name: str, response: dict, call_id: str | None = None, inv: str = INV) -> Event:
    part = types.Part.from_function_response(name=name, response=response)
    if call_id:
        part.function_response.id = call_id
    return Event(author="tutor", invocation_id=inv, content=types.Content(parts=[part]))


def _emitted(events: list[Event], teaching=None) -> list[dict]:
    """The kwargs ``emit_tool_call`` was called with, through the real ``_emit_new_turns``."""
    session = SimpleNamespace(events=events)
    ctx = SimpleNamespace(invocation_id=INV)
    with (
        mock.patch("observability.chat_log.emit_chat_turn"),
        mock.patch("observability.chat_log.emit_tool_call") as emit,
        mock.patch("skills.skill_config.get_skill", return_value=None),
    ):
        _emit_new_turns(session, "sess-1", "anon-uid", "concept-dialogue", ctx, group_id=GROUP, teaching=teaching)
    return [c.kwargs for c in emit.call_args_list]


def _payload(**kwargs) -> dict:
    """The jsonPayload the real emitter writes."""
    gl = MagicMock()
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_tool_call(
            group_id=GROUP,
            session_id="sess-1",
            skill_id="concept-dialogue",
            invocation_id=INV,
            turn_index=3,
            call_index=0,
            **kwargs,
        )
    return gl.log_struct.call_args.args[0]


# --- the walk -----------------------------------------------------------------


def test_a_calculate_call_is_logged_with_its_args_and_result():
    rows = _emitted(
        [
            _text("user", "hvor meget energi?"),
            _call("calculate", CALC_ARGS, call_id="c1"),
            _response("calculate", CALC_RESULT, call_id="c1"),
            _text("tutor", "$E = P \\cdot t = 300\\,\\text{kJ}$"),
        ],
        teaching=SimpleNamespace(class_id="cls-1", activity_id="act-1"),
    )
    assert len(rows) == 1
    row = rows[0]
    assert (row["tool"], row["ok"], row["error"]) == ("calculate", True, None)
    assert row["args"] == CALC_ARGS
    assert row["result"] == CALC_RESULT
    assert (row["turn_index"], row["call_index"]) == (3, 0)
    assert (row["class_id"], row["activity_id"]) == ("cls-1", "act-1")
    assert (row["group_id"], row["session_id"], row["invocation_id"]) == (GROUP, "sess-1", INV)


def test_an_erroring_tool_is_ok_false_with_its_error():
    refused = {"ok": False, "error": "unknown symbol 'x': give it in quantities"}
    rows = _emitted(
        [
            _text("user", "regn det ud"),
            _call("calculate", {"expression": "x * 2"}),
            _response("calculate", refused),
            _text("tutor", "Hvad er x målt i?"),
        ]
    )
    assert rows[0]["ok"] is False
    assert rows[0]["error"] == refused["error"]


def test_adk_error_shape_is_a_failure_too():
    rows = _emitted([_call("control_sim"), _response("control_sim", {"error": "sim not mounted"}), _text("t", "Hm.")])
    assert (rows[0]["ok"], rows[0]["error"]) == (False, "sim not mounted")


def test_a_call_with_no_response_is_ok_null():
    rows = _emitted([_text("user", "hej"), _call("control_sim"), _text("tutor", "Et øjeblik.")])
    assert rows[0]["ok"] is None


def test_turn_index_matches_the_chat_rows_tools_called_attribution():
    """The tool-call rows and the chat row's ``tools_called`` must never disagree."""
    events = [
        _text("user", "start"),
        _call("control_sim"),
        _response("control_sim", {"ok": True}),
        _text("tutor", "Jeg har tændt kedlen."),
        _call("calculate", CALC_ARGS),
        _call("svg_illustrator"),
        _response("calculate", CALC_RESULT),
        _response("svg_illustrator", {"ok": True}),
        _text("tutor", "Her er udregningen."),
        _call("mark_checklist_item"),  # trailing: lands on the last reply
        _response("mark_checklist_item", {"ok": True}),
    ]
    calls = _tool_calls_of_invocation(events, INV)
    by_turn: dict[int, list[str]] = {}
    for c in calls:
        by_turn.setdefault(c["turn_index"], []).append(c["name"])
    expected = {k: v for k, v in _tools_per_tutor_row(events, INV).items() if v}
    assert by_turn == expected
    assert [c["call_index"] for c in calls] == [0, 1, 2, 3]
    assert [c["name"] for c in calls] == ["control_sim", "calculate", "svg_illustrator", "mark_checklist_item"]


def test_responses_pair_by_id_when_two_calls_share_a_name():
    events = [
        _call("calculate", {"expression": "a"}, call_id="first"),
        _call("calculate", {"expression": "b"}, call_id="second"),
        _response("calculate", {"ok": True, "calc_id": "calc_b"}, call_id="second"),
        _response("calculate", {"ok": False, "error": "bad a"}, call_id="first"),
        _text("tutor", "Færdig."),
    ]
    a, b = _tool_calls_of_invocation(events, INV)
    assert (a["args"]["expression"], a["response"]["error"]) == ("a", "bad a")
    assert (b["args"]["expression"], b["response"]["calc_id"]) == ("b", "calc_b")


def test_a_call_in_an_invocation_with_no_tutor_text_is_still_logged():
    rows = _emitted([_text("user", "[session_start]"), _call("control_sim"), _response("control_sim", {"ok": True})])
    assert len(rows) == 1 and rows[0]["turn_index"] is None


def test_other_invocations_calls_are_not_logged_again():
    rows = _emitted([_call("calculate", inv="old"), _text("tutor", "før", inv="old"), _text("user", "nu")])
    assert rows == []


def test_an_emitter_failure_never_breaks_the_chat_rows():
    session = SimpleNamespace(events=[_text("user", "hej"), _call("calculate"), _text("tutor", "Hej!")])
    ctx = SimpleNamespace(invocation_id=INV)
    with (
        mock.patch("observability.chat_log.emit_chat_turn") as chat,
        mock.patch("observability.chat_log.emit_tool_call", side_effect=RuntimeError("sink down")),
        mock.patch("skills.skill_config.get_skill", return_value=None),
    ):
        _emit_new_turns(session, "sess-1", "anon-uid", "concept-dialogue", ctx, group_id=GROUP)
    assert [c.kwargs["role"] for c in chat.call_args_list] == ["student", "tutor"]


# --- the emitter --------------------------------------------------------------


def test_payload_shape_is_exactly_the_view_columns():
    payload = _payload(tool="calculate", ok=True, args=CALC_ARGS, result=CALC_RESULT)
    assert set(payload) == TOOL_CALL_KEYS


def test_calculation_rows_carry_args_result_and_calc_id_as_json_strings():
    payload = _payload(tool="calculate", ok=True, args=CALC_ARGS, result=CALC_RESULT)
    assert json.loads(payload["args"]) == CALC_ARGS
    assert json.loads(payload["result"]) == CALC_RESULT
    assert payload["calc_id"] == "calc_5f20c92aabbb7c33"
    assert payload["result"].count("kJ") == 2  # ensure_ascii=False keeps the text readable


def test_show_calculation_is_detailed_too():
    payload = _payload(tool="show_calculation", ok=True, args=CALC_ARGS, result=CALC_RESULT)
    assert payload["args"] is not None and payload["calc_id"] == "calc_5f20c92aabbb7c33"


def test_no_other_tools_args_or_result_are_ever_logged():
    """An illustrator request or a sim control can quote the student."""
    quoting = {"request": "draw what Lærke said: 'my ball goes up forever'", "calc_id": "calc_x"}
    for tool in ("svg_illustrator", "control_sim", "mark_checklist_item", "search_curriculum"):
        payload = _payload(tool=tool, ok=True, args=quoting, result=quoting)
        assert (payload["args"], payload["result"], payload["calc_id"]) == (None, None, None), tool
        assert payload["tool"] == tool and payload["ok"] is True


def test_no_arrays_reach_the_sink():
    """The 'Array specified for non-repeated field' failure: every value is a scalar."""
    payload = _payload(tool="calculate", ok=True, args=CALC_ARGS, result=CALC_RESULT)
    assert all(not isinstance(v, (list, tuple, dict)) for v in payload.values())


def test_an_over_cap_value_is_still_valid_json():
    huge = {"expression": "x" * 10_000}
    payload = _payload(tool="calculate", ok=False, args=huge, result=None)
    parsed = json.loads(payload["args"])
    assert parsed["truncated"] is True and parsed["chars"] > chat_log.TOOL_CALL_JSON_CAP
    assert payload["result"] is None


def test_error_is_truncated():
    payload = _payload(tool="control_sim", ok=False, error="e" * 5000)
    assert len(payload["error"]) == chat_log.TOOL_CALL_ERROR_CAP


def test_log_id_and_never_raises():
    captured: dict = {}
    with patch.object(chat_log, "_get_logger", side_effect=lambda lid: captured.update(log_id=lid) or MagicMock()):
        chat_log.emit_tool_call(
            group_id=GROUP,
            session_id="s",
            skill_id="k",
            invocation_id=INV,
            turn_index=1,
            call_index=0,
            tool="t",
            ok=True,
        )
    assert captured["log_id"] == "aipla_tool_call"
    gl = MagicMock()
    gl.log_struct.side_effect = RuntimeError("boom")
    with patch.object(chat_log, "_get_logger", return_value=gl):
        chat_log.emit_tool_call(
            group_id=GROUP,
            session_id="s",
            skill_id="k",
            invocation_id=INV,
            turn_index=1,
            call_index=0,
            tool="t",
            ok=True,
        )
