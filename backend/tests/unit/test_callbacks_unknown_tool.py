"""A hallucinated tool name must not end the student's turn (prod, 2026-09-21)."""

from __future__ import annotations

from google.adk.agents import LlmAgent
from google.adk.flows.llm_flows import functions
from google.adk.tools import BaseTool
from google.genai import types

from adk.callbacks import handle_unknown_tool


def _not_found() -> ValueError:
    try:
        functions._get_tool(types.FunctionCall(name="rag_retrieval", args={}), {})
    except ValueError as exc:
        return exc
    raise AssertionError("ADK no longer raises ValueError for an unknown tool")


def test_unknown_tool_becomes_an_error_result() -> None:
    result = handle_unknown_tool(BaseTool(name="rag_retrieval", description=""), {}, None, _not_found())
    assert result is not None
    assert result["ok"] is False
    assert "rag_retrieval" in result["error"]


def test_other_tool_errors_still_propagate() -> None:
    tool = BaseTool(name="calc", description="")
    assert handle_unknown_tool(tool, {}, None, RuntimeError("boom")) is None
    assert handle_unknown_tool(tool, {}, None, ValueError("bad argument")) is None


def test_agent_factory_wires_it() -> None:
    import inspect

    from adk import agent

    assert "on_tool_error_callback=handle_unknown_tool" in inspect.getsource(agent)
    assert "on_tool_error_callback" in LlmAgent.model_fields
