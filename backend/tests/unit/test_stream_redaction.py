"""STRIP-1 — student-stream tool-result redaction (the Axiom-10 pre-pilot fix).

Headline: expected answers and other server-only tool results must never reach
a STUDENT client's SSE frames. `run_checkpoint` returns the teacher's judging
rubric TO THE MODEL — the client has no business seeing it. Tool results the
client genuinely renders (the CheckpointCard's `record_checkpoint`, A2UI, MCP
app tools) pass through, and TEACHER streams are byte-identical (the co-pilot
proposal cards depend on their tool results).

1.1.101 inverted the decision rule: a result is privileged until something
DECLARES it renderable. So the MCP case below now asserts the declaration, not
the absence of registry membership — and the property test is the one that keeps
holding when somebody adds a tool and never reads this file.
"""

from __future__ import annotations

import json

import pytest

from adk.stream_redaction import (
    REDACTED_CONTENT,
    begin_renderable_declaration,
    declare_renderable_tools,
    redact_student_stream,
    should_redact_tool,
)


@pytest.fixture(autouse=True)
def _fresh_declaration_scope():
    """Each test gets its own declaration scope, so one test's declarations
    cannot make another's assertion pass."""
    begin_renderable_declaration()
    yield


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
    # 1.1.101: an UNDECLARED name is redacted, whatever it is called. This is
    # the inversion — it used to pass because it was not in the registry.
    assert should_redact_tool("boldkast_show_value") is True
    # ...and passes once the toolset declares it.
    declare_renderable_tools(["boldkast_show_value"])
    assert should_redact_tool("boldkast_show_value") is False


def test_an_undeclared_tool_name_is_redacted_whatever_it_is_called():
    """The PROPERTY, not the list. A tool added later, by someone who never
    reads this module, must not reach a student stream by default."""
    for name in (
        "teacher_authored_marking_scheme",
        "totally_new_tool",
        "get_answers",
        "",
    ):
        assert should_redact_tool(name) is True, name


def test_empty_tool_name_is_redacted():
    """A TOOL_CALL_START carrying no name stored "" and should_redact_tool("")
    was False under the registry rule, so the result passed through despite the
    filter's own "fail CLOSED" comment. Verified and fixed 2026-09-08."""
    assert should_redact_tool("") is True


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
async def test_declared_mcp_app_tool_results_pass_through_for_students():
    ui = json.dumps({"resource": "ui://boldkast/panel"})
    declare_renderable_tools(["boldkast_show_value"])  # what TaggedMcpToolset does
    events = [_start("c9", "boldkast_show_value"), _result("c9", ui)]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    assert out[1]["content"] == ui


@pytest.mark.asyncio
async def test_undeclared_iframe_shaped_tool_is_redacted_for_students():
    """Looking like an MCP tool is not a credential. Without a declaration —
    e.g. a teacher-authored artefact nobody registered — it is redacted."""
    ui = json.dumps({"resource": "ui://teacher-thing/panel"})
    events = [_start("c10", "teacher_authored_tool"), _result("c10", ui)]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    assert out[1]["content"] == REDACTED_CONTENT


@pytest.mark.asyncio
async def test_start_without_a_name_is_redacted_for_students():
    events = [_start("c11", ""), _result("c11", SECRET)]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    assert out[1]["content"] == REDACTED_CONTENT


# --- the declaration must survive ADK's task topology ---------------------
#
# The real risk in 1.1.101 is not the policy, it is the plumbing: the toolset
# resolves inside ADK's own tasks/threads while the filter runs in the request
# coroutine. A contextvar ASSIGNED in a child does not propagate back to the
# parent — which is exactly why the declaration is a MUTABLE SET held in a
# contextvar rather than a value reassigned per call. These tests pin that
# reasoning, because the deployed smoke cannot reach it: no dev skill sets
# mcpServers, so there is no MCP tool to declare in that environment.


@pytest.mark.asyncio
async def test_declaration_from_a_child_task_is_visible_to_the_parent_filter():
    import asyncio

    async def resolve_toolset():  # stands in for TaggedMcpToolset.get_tools
        declare_renderable_tools(["late_declared_tool"])

    await asyncio.create_task(resolve_toolset())

    ui = json.dumps({"resource": "ui://late/panel"})
    events = [_start("t1", "late_declared_tool"), _result("t1", ui)]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    assert out[1]["content"] == ui


@pytest.mark.asyncio
async def test_declaration_from_a_worker_thread_is_visible_to_the_parent_filter():
    import asyncio

    def resolve_in_thread():  # ADK sync tool paths land here
        declare_renderable_tools(["thread_declared_tool"])

    await asyncio.to_thread(resolve_in_thread)

    ui = json.dumps({"resource": "ui://thread/panel"})
    events = [_start("t2", "thread_declared_tool"), _result("t2", ui)]
    out = await _collect(redact_student_stream(_agen(events), is_student=True))
    assert out[1]["content"] == ui


@pytest.mark.asyncio
async def test_a_declaration_does_not_leak_into_a_different_request_scope():
    """Two concurrent requests must not see each other's declarations —
    otherwise one student's registered sim would un-redact another's tools."""
    declare_renderable_tools(["request_a_tool"])
    assert should_redact_tool("request_a_tool") is False

    begin_renderable_declaration()  # a second request opens its own scope
    assert should_redact_tool("request_a_tool") is True


def test_every_tool_the_client_renders_by_name_is_allow_listed():
    """The regression that nearly shipped: `mark_checklist_item` is parsed by
    ChecklistMarkCard but sits outside TOOL_REGISTRY, so the OLD rule passed it
    as an 'unknown name'. Inverting the default silently redacted it and the
    card would have stopped rendering.

    Keep this list in step with the frontend's `tc.name === "..."` consumers —
    scripts/check-stream-render-allowlist.sh enforces it mechanically."""
    for name in ("record_checkpoint", "mark_checklist_item"):
        assert should_redact_tool(name) is False, f"{name} is rendered by the client"
