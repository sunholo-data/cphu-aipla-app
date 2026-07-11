"""Student-stream tool-result redaction (STRIP-1 — the Axiom-10 pre-pilot fix).

Tool RESULTS are addressed to the MODEL, but AG-UI mirrors them onto the SSE
stream as ``TOOL_CALL_RESULT`` events — so anything a tool returns (the
teacher's expected answers in ``run_checkpoint``, document contents, judging
guidance) is readable by a student who opens devtools. This filter closes that
at the SSE boundary for ANONYMOUS-GROUP sessions:

- **Redacted (default for platform tools):** every ``TOOL_REGISTRY`` tool plus
  the per-session checkpoint reader — their results are server/model-only. The
  event still flows (the ``ToolCallChip`` keeps its ✓) but ``content`` is
  replaced with a sentinel.
- **Allowed (the client genuinely renders these):** ``record_checkpoint``
  (already card-safe — label/status/evidence only, no rubric),
  ``send_a2ui_json_to_client`` (the A2UI renderer), and any name NOT in the
  platform registry — i.e. MCP-server tools, whose results carry the
  ``ui://`` references the MCP-app iframe path renders (UI-by-reference).
- **Teacher streams are untouched** — the co-pilot's proposal cards ARE tool
  results.

AG-UI's ``TOOL_CALL_RESULT`` carries no tool NAME, only ``toolCallId`` — so the
filter tracks ``TOOL_CALL_START`` (id → name) within the stream and **fails
closed**: a result whose start was never seen is redacted.

History replay is already safe: ``GET /api/sessions/{id}/messages`` skips
tool-call events entirely (sessions_route). Tool ARGS stream too, but the
sensitive direction is results (args are model-authored: node ids, evidence
summaries the card shows anyway).
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

#: What a redacted result reads as client-side (kept JSON so any parser that
#: does reach it degrades cleanly instead of throwing).
REDACTED_CONTENT = json.dumps({"redacted": "server-only tool result"})

#: Platform tools whose results the client legitimately renders.
_CLIENT_RENDER_TOOLS = frozenset(
    {
        # CheckpointCard (CONCEPT-1 M3) — the return is card-safe by
        # construction: node label, status, one-line evidence. Never the rubric.
        "record_checkpoint",
        # A2UI renderer — the result IS the UI payload.
        "send_a2ui_json_to_client",
    }
)


def _platform_tool_names() -> frozenset[str]:
    """Every registry tool + the per-session checkpoint tools — the set whose
    results are server/model-only unless explicitly allow-listed."""
    from adk.tools import TOOL_REGISTRY

    return frozenset(TOOL_REGISTRY) | {"run_checkpoint", "record_checkpoint"}


def should_redact_tool(tool_name: str) -> bool:
    """True when this tool's result must not reach a student client.

    Platform tools are redacted by default (deny-by-default, Axiom 9); the
    small allow-list above passes; unknown names are MCP-server tools — the
    interactive-iframe render path — and pass through.
    """
    if tool_name in _CLIENT_RENDER_TOOLS:
        return False
    return tool_name in _platform_tool_names()


async def redact_student_stream(
    events: AsyncIterator[dict],
    *,
    is_student: bool,
) -> AsyncIterator[dict]:
    """Yield the AG-UI event stream, redacting server-only tool results for
    anonymous-group (student) sessions. Teacher streams pass through untouched.
    """
    if not is_student:
        async for event in events:
            yield event
        return

    names_by_call_id: dict[str, str] = {}
    async for event in events:
        etype = event.get("type")
        if etype == "TOOL_CALL_START":
            call_id = event.get("toolCallId")
            if call_id:
                names_by_call_id[call_id] = event.get("toolCallName") or ""
        elif etype == "TOOL_CALL_RESULT":
            # Fail CLOSED: an unmatched result (start never seen) is redacted.
            name = names_by_call_id.get(event.get("toolCallId") or "")
            if name is None or should_redact_tool(name):
                event = {**event, "content": REDACTED_CONTENT}
                logger.debug("stream_redaction: redacted result of %r", name or "(unknown)")
        yield event


__all__ = ["REDACTED_CONTENT", "redact_student_stream", "should_redact_tool"]
