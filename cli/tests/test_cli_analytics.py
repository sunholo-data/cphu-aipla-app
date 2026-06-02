"""Unit tests for ``aiplatform analytics`` (sprint
ANALYTICS-CHAT-AND-INSIGHTS, M5).

Mocks the backend with respx so tests never need a live backend.
Three subcommands under test:

- ``analytics tools`` — table + ``--json`` output
- ``analytics probe`` — kwargs forwarding, JSON result, HARD GATE
  surface (cross-tenant 404 surfaces as the same error message)
- ``analytics ask`` — SSE stream parsing: text deltas reach stdout,
  tool calls are listed on stderr, RUN_ERROR exits non-zero
"""

from __future__ import annotations

import json

import httpx
import respx
from click.testing import CliRunner

from aiplatform.cli import main

BASE = "http://localhost:1956"


def _sse_body(events: list[dict]) -> str:
    return "".join(f"data: {json.dumps(e)}\n\n" for e in events)


# ---------------------------------------------------------------------------
# analytics tools
# ---------------------------------------------------------------------------


@respx.mock
def test_tools_prints_table() -> None:
    respx.get(f"{BASE}/api/analytics/tools").mock(
        return_value=httpx.Response(
            200,
            json={
                "tools": [
                    {"name": "count_messages", "description": "Total turns.", "parameters": []},
                    {"name": "time_on_task", "description": "Per-group duration.", "parameters": []},
                ]
            },
        )
    )

    result = CliRunner().invoke(main, ["--env", "local", "analytics", "tools"])
    assert result.exit_code == 0, result.output
    assert "count_messages" in result.output
    assert "time_on_task" in result.output
    assert "Total turns" in result.output


@respx.mock
def test_tools_json_flag() -> None:
    payload = {"tools": [{"name": "count_messages", "description": "x", "parameters": []}]}
    respx.get(f"{BASE}/api/analytics/tools").mock(return_value=httpx.Response(200, json=payload))

    result = CliRunner().invoke(main, ["--env", "local", "analytics", "tools", "--json"])
    assert result.exit_code == 0
    parsed = json.loads(result.output)
    assert parsed == payload


# ---------------------------------------------------------------------------
# analytics probe
# ---------------------------------------------------------------------------


@respx.mock
def test_probe_owned_class_prints_result() -> None:
    route = respx.post(f"{BASE}/api/analytics/probe/count_messages").mock(
        return_value=httpx.Response(
            200,
            json={
                "tool": "count_messages",
                "class_id": "cls-1",
                "result": {"total": 42, "per_group": [{"group_code": "g1", "count": 42}]},
            },
        )
    )

    result = CliRunner().invoke(main, ["--env", "local", "analytics", "probe", "cls-1", "count_messages"])
    assert result.exit_code == 0, result.output
    assert route.called
    body = json.loads(route.calls.last.request.content)
    assert body == {"class_id": "cls-1", "kwargs": {}}
    assert '"total": 42' in result.output


@respx.mock
def test_probe_forwards_kwargs() -> None:
    route = respx.post(f"{BASE}/api/analytics/probe/most_active_groups").mock(
        return_value=httpx.Response(200, json={"tool": "most_active_groups", "class_id": "c", "result": {}})
    )

    result = CliRunner().invoke(
        main,
        [
            "--env",
            "local",
            "analytics",
            "probe",
            "c",
            "most_active_groups",
            "--kwarg",
            "since=2026-05-01T00:00:00Z",
            "--kwargs-json",
            '{"limit": 5}',
        ],
    )
    assert result.exit_code == 0, result.output
    body = json.loads(route.calls.last.request.content)
    assert body["kwargs"] == {"since": "2026-05-01T00:00:00Z", "limit": 5}


@respx.mock
def test_probe_cross_tenant_surfaces_class_not_accessible() -> None:
    # The route returns the HARD-GATE 404 with the canonical detail.
    respx.post(f"{BASE}/api/analytics/probe/count_messages").mock(
        return_value=httpx.Response(404, json={"detail": "class not accessible"})
    )

    result = CliRunner().invoke(main, ["--env", "local", "analytics", "probe", "not-mine", "count_messages"])
    assert result.exit_code != 0
    # The CLI surfaces APIError.detail in the error message.
    assert "class not accessible" in result.output


@respx.mock
def test_probe_bad_kwarg_pair_rejected_locally() -> None:
    # No HTTP mock — the CLI should fail before hitting the network.
    result = CliRunner().invoke(
        main,
        ["--env", "local", "analytics", "probe", "c", "count_messages", "--kwarg", "no_equals"],
    )
    assert result.exit_code != 0
    assert "key=value" in result.output


# ---------------------------------------------------------------------------
# analytics ask  — SSE stream
# ---------------------------------------------------------------------------


@respx.mock
def test_ask_streams_text_and_lists_tool_calls() -> None:
    events = [
        {"type": "RUN_STARTED", "threadId": "t", "runId": "r"},
        {"type": "TOOL_CALL_START", "toolCallName": "count_messages"},
        {"type": "TOOL_CALL_END"},
        {"type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant"},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "42 messages "},
        {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "across two groups."},
        {"type": "TEXT_MESSAGE_END", "messageId": "m1"},
        {"type": "RUN_FINISHED", "threadId": "t", "runId": "r"},
    ]
    respx.post(f"{BASE}/api/skill/analytics-chat/stream").mock(
        return_value=httpx.Response(200, headers={"content-type": "text/event-stream"}, text=_sse_body(events))
    )

    result = CliRunner().invoke(
        main,
        ["--env", "local", "analytics", "ask", "cls-1", "How many messages?"],
    )
    assert result.exit_code == 0, result.output
    # Text deltas + tool-call summary are both in combined output (Click 8.2+).
    assert "42 messages across two groups." in result.output
    assert "count_messages" in result.output


@respx.mock
def test_ask_run_error_exits_nonzero() -> None:
    events = [
        {"type": "RUN_STARTED", "threadId": "t", "runId": "r"},
        {"type": "RUN_ERROR", "message": "model failed"},
    ]
    respx.post(f"{BASE}/api/skill/analytics-chat/stream").mock(return_value=httpx.Response(200, text=_sse_body(events)))

    result = CliRunner().invoke(main, ["--env", "local", "analytics", "ask", "c", "q"])
    assert result.exit_code != 0
    assert "model failed" in result.output


@respx.mock
def test_ask_http_error_surfaces() -> None:
    respx.post(f"{BASE}/api/skill/analytics-chat/stream").mock(
        return_value=httpx.Response(403, text='{"detail":"teacher access required"}')
    )

    result = CliRunner().invoke(main, ["--env", "local", "analytics", "ask", "c", "q"])
    assert result.exit_code != 0
    assert "teacher access required" in result.output
