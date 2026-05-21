"""`aiplatform sessions` — inspect ADK session state for debugging.

Sprint 1.25 — small helper for "is the iframe actually pushing
ui/update-model-context properly?" without staring at backend logs.
Filters session state to the `mcp_app_context.*` namespace by default.

Endpoints used:
    GET /api/sessions/{session_id}                  — session metadata
    GET /api/sessions/{session_id}/state            — full ADK state
                                                       (filtered locally)
"""

from __future__ import annotations

import json as _json

import click

from aiplatform.http import AIPlatformClient

_NAMESPACE_PREFIX = "mcp_app_context."


def _client(ctx: click.Context) -> AIPlatformClient:
    return AIPlatformClient(env=ctx.obj["env"])


@click.group()
def sessions() -> None:
    """Inspect chat sessions and their iframe-app context."""


@sessions.command("inspect")
@click.argument("session_id")
@click.option(
    "--mcp-context",
    "mcp_context_only",
    is_flag=True,
    help=(
        "Only show the `mcp_app_context.*` namespace (sprint 1.25). "
        "Useful for debugging iframe→agent context flow."
    ),
)
@click.pass_context
def inspect(
    ctx: click.Context, session_id: str, mcp_context_only: bool
) -> None:
    """Show metadata + state for SESSION_ID.

    With --mcp-context, prints only the `mcp_app_context.*` namespace
    so you can verify MCP App iframes are pushing
    `ui/update-model-context` correctly.
    """
    client = _client(ctx)
    meta = client.get(f"/api/sessions/{session_id}")
    state = client.get(f"/api/sessions/{session_id}/state") or {}

    if mcp_context_only:
        filtered = {
            k: v for k, v in state.items() if k.startswith(_NAMESPACE_PREFIX)
        }
        if not filtered:
            click.echo(
                f"No keys with prefix {_NAMESPACE_PREFIX!r} in session "
                f"{session_id}. Has any MCP App iframe been rendered + "
                f"interacted with in this session?"
            )
            return
        click.echo(_json.dumps(filtered, indent=2, default=str))
        return

    click.echo("=== Session metadata ===")
    click.echo(_json.dumps(meta, indent=2, default=str))
    click.echo("\n=== Session state ===")
    click.echo(_json.dumps(state, indent=2, default=str))


@sessions.command("iframe-context")
@click.argument("session_id")
@click.pass_context
def iframe_context(ctx: click.Context, session_id: str) -> None:
    """Dump the `mcp_app_context.*` namespace for SESSION_ID.

    Convenience alias for `inspect --mcp-context`. Shows exactly what
    the agent's next turn would see via the InstructionProvider — every
    iframe-context push that landed for this session, grouped by
    `server.tool`. Use this to debug "the agent says it can't see what
    I clicked" without grepping backend logs (closes the 2026-05-21
    debug workflow gap).
    """
    client = _client(ctx)
    state = client.get(f"/api/sessions/{session_id}/state") or {}
    filtered = {k: v for k, v in state.items() if k.startswith(_NAMESPACE_PREFIX)}
    if not filtered:
        click.echo(
            f"No keys with prefix {_NAMESPACE_PREFIX!r} in session "
            f"{session_id}. Either no iframe pushes have landed (workspace "
            f"never interacted with), or the bootstrap race regressed."
        )
        return
    click.echo(_json.dumps(filtered, indent=2, default=str))
