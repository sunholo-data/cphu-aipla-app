"""after_tool_callback that offloads oversized tool responses to ADK artifacts.

Tool responses larger than ``_LARGE_OUTPUT_THRESHOLD`` characters are saved
as artifacts and replaced with a short pointer string in the LLM context —
keeps the agent from paying megabytes of tokens per turn.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)

_LARGE_OUTPUT_THRESHOLD = 50_000


def _handle_large_output(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: Any,
) -> Any:
    """Offload oversize tool responses to an ADK artifact.

    Returns the original response untouched when ``len(str(tool_response))``
    is at or below the threshold. For larger responses, saves the full
    payload as a Part-wrapped artifact and returns a short pointer string
    the model can reference.
    """
    text = str(tool_response)
    if len(text) <= _LARGE_OUTPUT_THRESHOLD:
        return tool_response

    tool_name = getattr(tool, "name", "tool")
    artifact_name = f"{tool_name}_response_{tool_context.invocation_id}"
    from google.genai import types as genai_types

    part = genai_types.Part.from_text(text=text)
    try:
        tool_context.save_artifact(filename=artifact_name, artifact=part)
    except Exception as exc:  # pragma: no cover - ADK artifact service errors
        logger.warning("save_artifact failed for %s: %s", artifact_name, exc)
        return tool_response

    logger.info("offloaded large tool response to artifact %s (%d chars)", artifact_name, len(text))
    return (
        f"[large response saved as artifact '{artifact_name}' — "
        f"{len(text):,} chars. Load via tool_context.load_artifact('{artifact_name}') "
        f"if you need the full content.]"
    )
