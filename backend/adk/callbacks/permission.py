"""before_tool_callback and before_agent_callback for permission enforcement.

* ``make_permission_enforcer`` — before_tool_callback that checks
  tool_permissions Firestore rules and emits a TTFT timing mark.
* ``make_before_agent`` — before_agent_callback that annotates the
  current OTEL span and (optionally) pre-resolves signed URLs for
  storage-backed tools.
"""

from __future__ import annotations

import logging
from typing import Any

from google.adk.tools import BaseTool
from google.adk.tools.tool_context import ToolContext
from opentelemetry import trace

from auth.access_context import AccessContext
from auth.permissions import ToolPermissionDenied, can_use_tool

logger = logging.getLogger(__name__)


def make_permission_enforcer(
    user_email: str,
    user_domain: str,
) -> Any:
    """Return a ``before_tool_callback`` that enforces tool permissions."""

    def _enforcer(
        tool: BaseTool,
        args: dict[str, Any],
        tool_context: ToolContext,
    ) -> dict[str, Any] | None:
        tool_name = tool.name
        if not can_use_tool(user_email, user_domain, tool_name):
            logger.info(
                "perm: blocked %s for %s (tool=%s)",
                user_email,
                tool_context.agent_name,
                tool_name,
            )
            raise ToolPermissionDenied(user_email, tool_name)

        # TTFT: emit a STAGE_PROGRESS label per tool call so the UI can
        # show "Calling search…" instead of an indefinite cursor while
        # the model waits on the tool. Each call gets its own mark name
        # (suffixed by a per-turn counter) — same name twice would be
        # idempotent and the second tool's label would never fire.
        from observability.timing import STAGE_TOOL_CALL_STARTED, get_current_tracker

        tracker = get_current_tracker()
        tracker.mark(
            f"{STAGE_TOOL_CALL_STARTED}_{tracker.tools_invoked_count}",
            user_label=f"Calling {tool_name}…",
        )

        return None

    return _enforcer


def make_before_agent(
    skill_id: str,
    tool_configs: dict[str, Any] | None = None,
    access_context: AccessContext | None = None,
) -> Any:
    """Return a ``before_agent_callback`` that:

    1. Annotates the current OTEL span with the original (pre-sanitization)
       ``skill_id`` and, if the SSE endpoint has set ``routing_choice`` on
       session state, that too.
    2. (RESOURCE-ACCESS M3) If ``tool_configs`` + ``access_context`` are
       provided, resolves any ``bucket_folders`` entries to signed URLs and
       stashes them under ``callback_context.state['signed_urls']``.
       Downstream tools then read URLs from state instead of re-hitting
       Firestore on every turn.

    Captures ``skill_id`` in a closure so we keep the original kebab-case /
    UUID form rather than the sanitized agent name.

    tool_configs shape (convention for M3):
        {"<tool_name>": {"bucket_folders": [{"bucket_id": "...", "folder_id": "..."}]}}
    TODO(v6.1): formalize this shape in SkillMetadata once the first real
    storage-backed tool lands.
    """

    def _callback(callback_context: Any) -> None:
        # COMPACTION-LATENCY M1 — demote this turn's pre-request compaction
        # trigger to emergency-only so routine compaction runs post-invocation
        # (while the student reads) instead of inside TTFT. Fail-open.
        from adk.callbacks.compaction import _demote_pre_request_compaction

        _demote_pre_request_compaction(callback_context)

        span = trace.get_current_span()
        span.set_attribute("skill_id", skill_id)
        state = callback_context.state if hasattr(callback_context, "state") else None
        routing_choice = state.get("routing_choice") if state is not None else None
        if routing_choice:
            span.set_attribute("routing_choice", routing_choice)

        if access_context is None or not tool_configs or state is None:
            return
        _populate_signed_urls(tool_configs, access_context, state)

    return _callback


def _populate_signed_urls(
    tool_configs: dict[str, Any],
    ctx: AccessContext,
    state: Any,
) -> None:
    """Resolve tool_configs → folder configs → signed URLs. Never crashes the run."""
    from auth.signed_urls import build_signed_urls_for_folders
    from buckets.folder_config import get_folder

    folder_refs: list[tuple[str, str]] = []
    for _tool, config in tool_configs.items():
        if not isinstance(config, dict):
            continue
        for entry in config.get("bucket_folders", []) or []:
            if isinstance(entry, dict) and "bucket_id" in entry and "folder_id" in entry:
                folder_refs.append((entry["bucket_id"], entry["folder_id"]))

    if not folder_refs:
        return

    folders = []
    for bucket_id, folder_id in folder_refs:
        try:
            folder = get_folder(bucket_id, folder_id)
        except Exception as exc:
            logger.warning("failed to load folder %s/%s: %s", bucket_id, folder_id, exc)
            continue
        if folder is not None:
            folders.append(folder)

    temp: dict[str, Any] = {}
    build_signed_urls_for_folders(folders, ctx, state=temp)
    for key in ("signed_urls", "signed_urls_unavailable"):
        if key in temp:
            state[key] = temp[key]
