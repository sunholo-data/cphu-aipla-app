"""on_tool_error_callback that turns a hallucinated tool name into a tool result.

When the model calls a function the agent does not have, ADK raises
``ValueError("Tool '<name>' not found. ...")`` from ``_get_tool`` and, with no
error callback, re-raises it — ending the student's turn with no reply. Prod,
2026-09-21: a student turn died on ``Tool 'rag_retrieval' not found``.

Returning a result instead lets the model see the mistake and carry on with the
tools it actually has. Only the not-found case is handled; any other tool error
returns ``None`` so it propagates exactly as before.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def handle_unknown_tool(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    error: Exception,
) -> dict[str, Any] | None:
    """Answer a call to a non-existent tool with an error result, not a crash."""
    if not (isinstance(error, ValueError) and "not found" in str(error)):
        return None
    name = getattr(tool, "name", "?")
    logger.warning("unknown_tool: model called %r, which this agent does not have", name)
    return {
        "ok": False,
        "error": f"There is no tool named '{name}'. Do not call it again; "
        "answer with the tools you have, or without a tool.",
    }
