"""STRIP-1 — student-stream tool-result redaction (the Axiom-10 pre-pilot fix).

Headline: expected answers and other server-only tool results must never reach
a STUDENT client's SSE frames. `run_checkpoint` returns the teacher's judging
rubric TO THE MODEL — the client has no business seeing it. Tool results the
client genuinely renders (the CheckpointCard's `record_checkpoint`, A2UI, MCP
app tools) pass through, and TEACHER streams are byte-identical (the co-pilot
proposal cards depend on their tool results).
"""

from __future__ import annotations

import json

import pytest

from adk.stream_redaction import REDACTED_CONTENT, redact_student_stream, should_redact_tool


async def _agen(events):
    for e in events:
        yield e


async def _collect(it):
    return [e async for e in it]


def _start(call_id: str, name: str) -> dict:
    return {"type": "TOOL_CALL_START", "toolCallId": call_id, "toolCallName": name}


def _result(call_id: str, content: str) -> dict:
    return {"type": "TOOL_CALL_RESULT", "toolCallId": call_id, "content": content}


SECRET = json.dumps({"ok": True, "questions": [{"expectedAnswer": "45 grader — sin/cos balancen"}]})
CARD_SAFE = json.dumps({"ok": True, "node": {"label": "Vektorer"}, "status": "demonstrated", "evidence": "ok"})


# --- the policy ---


def test_platform_tools_are_redacted_but_client_render_tools_are_not():
    # server-only platform tools
    assert should_redact_tool("run_checkpoint") is True
    assert should_redact_tool("get_document_content") is True
    assert should_redact_tool("list_documents") is True
    # client-render paths
    assert should_redact_tool("record_checkpoint") is False
    assert should_redact_tool("send_a2ui_json_to_client") is False
    # unknown names = MCP server tools (the iframe UI-by-reference path)
    assert should_redact_tool("boldkast_show_value") is False


# --- the stream filter ---


@pytest.mark.asyncio
async def test_student_stream_redacts_run_checkpoint_but_keeps_record_checkpoint():
    events = [
        _start("c1", "run_checkpoint"),
        _result("c1", SECRET),
        _start("c2", "record_checkpoint"),
        _result("c2", CARD_SAFE),
        {"type": "TEXT_MESSAGE_CONTENT", "delta": "Lad os tjekke vektorer!"},
    ]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    results = {e["toolCallId"]: e["content"] for e in out if e["type"] == "TOOL_CALL_RESULT"}
    assert results["c1"] == REDACTED_CONTENT
    assert "expectedAnswer" not in json.dumps(out)
    assert results["c2"] == CARD_SAFE  # the CheckpointCard still renders
    # non-result events untouched, order preserved
    assert [e["type"] for e in out] == [e["type"] for e in events]


@pytest.mark.asyncio
async def test_teacher_stream_is_byte_identical():
    events = [_start("c1", "set_lesson_prompt"), _result("c1", '{"proposal": {"value": "..."}}')]
    out = await _collect(redact_student_stream(_agen(events), is_student=False))
    assert out == events


@pytest.mark.asyncio
async def test_unknown_call_id_defaults_to_redacted_for_students():
    # A result whose START we never saw (adapter hiccup): fail CLOSED.
    out = await _collect(redact_student_stream(_agen([_result("ghost", SECRET)]), is_student=True))
    assert out[0]["content"] == REDACTED_CONTENT


@pytest.mark.asyncio
async def test_mcp_app_tool_results_pass_through_for_students():
    ui = json.dumps({"resource": "ui://boldkast/panel"})
    events = [_start("c9", "boldkast_show_value"), _result("c9", ui)]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    assert out[1]["content"] == ui
