"""Student-stream tool-result redaction (STRIP-1 — the Axiom-10 pre-pilot fix).

Tool RESULTS are addressed to the MODEL, but AG-UI mirrors them onto the SSE
stream as ``TOOL_CALL_RESULT`` events — so anything a tool returns (the
teacher's expected answers in ``run_checkpoint``, document contents, judging
guidance) is readable by a student who opens devtools. This filter closes that
at the SSE boundary for ANONYMOUS-GROUP sessions:

**The invariant (1.1.101, 2026-09-08): a tool result is privileged until
something DECLARES it renderable.** Redaction is no longer decided by registry
membership — an unrecognised tool name is redacted, because an unrecognised tool
is precisely the one nobody has reviewed.

- **Redacted (the default for everything):** every tool not named below and not
  declared at run time. The event still flows (the ``ToolCallChip`` keeps its ✓)
  but ``content`` is replaced with a sentinel.
- **Allowed — statically:** ``record_checkpoint`` (card-safe by construction:
  label/status/evidence, never the rubric) and ``send_a2ui_json_to_client``
  (the result IS the UI payload).
- **Allowed — declared at run time:** MCP-server tools, whose results carry the
  ``ui://`` references the MCP-app iframe path renders (UI-by-reference). These
  announce themselves through :func:`declare_renderable_tools` as the toolset
  resolves, so a *registered* server's tools render and a name from anywhere
  else does not.

Why the default was inverted. The previous rule redacted platform-registry
tools and let every unknown name through, on the reasoning that unknown ==
MCP == render path. That was safe while every MCP tool was hand-written by one
person who knew the rule, and it stops being safe the moment teachers author
artefacts (teacher-authored-workbench-apps / sim-catalogue-admin): a teacher
tool returning a worked solution reached the student stream by default, with
nothing that would catch it.
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
from contextvars import ContextVar

logger = logging.getLogger(__name__)

#: Per-request set of tool names declared client-renderable (MCP-server tools).
#: A *mutable* set held in a contextvar, deliberately: the toolset resolves
#: inside child tasks of the request, and a contextvar assigned there would not
#: propagate back up to the stream filter. Mutating one shared object does.
#: Unset (the default) means "nothing declared" — i.e. fully closed.
_declared_renderable: ContextVar[set[str] | None] = ContextVar("declared_renderable_tools", default=None)


def begin_renderable_declaration() -> set[str]:
    """Open a per-request declaration scope and return the shared set.

    Call once at the top of a request, before the stream is consumed.
    """
    declared: set[str] = set()
    _declared_renderable.set(declared)
    return declared


def declare_renderable_tools(names: list[str] | set[str]) -> None:
    """Declare tool names whose results the client legitimately renders.

    No-op outside a request scope, which keeps the default closed: a caller
    that forgets to open a scope gets redaction, not leakage.
    """
    declared = _declared_renderable.get()
    if declared is None:
        return
    declared.update(n for n in names if n)


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
        # ChecklistMarkCard (1.1.62 M3) — card-safe by construction: item
        # label, done flag, one line of evidence. The tool's own docstring is
        # explicit that this is student-facing: "The student sees every mark
        # you make, with your reason, and can undo it."
        #
        # Missed in the first pass of 1.1.101 and caught before prod. It is
        # neither in TOOL_REGISTRY nor was it allow-listed, so under the OLD
        # registry rule it passed as an "unknown name" — the same accident that
        # let every teacher-authored tool through. Inverting the default turned
        # that accident into a silent regression: the card would simply have
        # stopped rendering. Anything the client parses by name must be listed
        # HERE; scripts/check-stream-render-allowlist.sh now enforces that.
        "mark_checklist_item",
    }
)


def should_redact_tool(tool_name: str) -> bool:
    """True when this tool's result must not reach a student client.

    Deny by default (Axiom 9). A result is redacted unless the tool is
    statically client-renderable or was declared renderable for this request.
    An empty or missing name is redacted — it is the least-known case, not the
    most-trusted one.
    """
    if not tool_name:
        return True
    if tool_name in _CLIENT_RENDER_TOOLS:
        return False
    declared = _declared_renderable.get()
    if declared is not None and tool_name in declared:
        return False
    return True


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
            # Fail CLOSED. Two distinct unknowns, both redacted: the START was
            # never seen (``None``), or it arrived without a name (``""``).
            # The second used to slip through — ``should_redact_tool("")`` was
            # False under the registry rule — despite this comment.
            name = names_by_call_id.get(event.get("toolCallId") or "")
            if name is None or should_redact_tool(name):
                event = {**event, "content": REDACTED_CONTENT}
                logger.debug("stream_redaction: redacted result of %r", name or "(unknown)")
        yield event


__all__ = [
    "REDACTED_CONTENT",
    "begin_renderable_declaration",
    "declare_renderable_tools",
    "redact_student_stream",
    "should_redact_tool",
]
