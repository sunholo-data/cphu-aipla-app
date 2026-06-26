#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=1.7.1", "starlette>=0.37", "uvicorn>=0.30"]
# ///
"""Standalone MCP server that exposes EVERY AIPLA sim as a portable MCP App.

Why this exists
---------------
The AIPLA sims (Boldkast, KineBot, LED-Planck) are *already* MCP Apps on the
View side: each artefact speaks the SEP-1865 postMessage bridge — it sends
`ui/initialize` with `protocolVersion: "2026-01-26"`, reads `hostContext`,
answers `ping`, and pushes student interactions back as `ui/update-model-context`
(see any `artefacts/<name>/v*/index.html`, the telemetry block ~line 637).

What was missing for them to render in Claude Desktop / ChatGPT is purely the
*server* side: an MCP server that, for each artefact,
  1. registers the HTML as a `ui://` resource (mimeType `text/html;profile=mcp-app`), and
  2. exposes a `show_<name>` tool whose `_meta.ui.resourceUri` points at it.

This server does that for ALL artefacts automatically. It scans the sibling
`artefacts/` directory, takes the latest version of each sim that actually
speaks the bridge, and registers it. Add a new sim under
`artefacts/<name>/v<n>/index.html` and it shows up here with zero code changes —
that is what "all our simulations available as standard" looks like.

Run it
------
  ./server.py                       # stdio — for Claude Desktop (see README.md)
  ./server.py --http --port 8000    # Streamable HTTP — for ChatGPT / a tunnel / Inspector

Each tool's `_meta` carries BOTH the standard `ui.resourceUri` (Claude Desktop,
VS Code, Goose, MCPJam, Postman) and `openai/outputTemplate` (ChatGPT Apps SDK).
That one line is the only place the two host families still diverge.
"""

from __future__ import annotations

import argparse
import contextlib
import re
from dataclasses import dataclass
from pathlib import Path

import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.lowlevel.helper_types import ReadResourceContents

ARTEFACTS_DIR = Path(__file__).resolve().parent.parent / "artefacts"
UI_MIME_TYPE = "text/html;profile=mcp-app"
# An artefact is "MCP-App-ready" iff its HTML runs the bridge handshake.
BRIDGE_MARKER = "ui/initialize"
_VERSION_RE = re.compile(r"^v(\d+)$")
_TITLE_RE = re.compile(r"<title>([^<]*)</title>", re.IGNORECASE)


@dataclass(frozen=True)
class Artefact:
    name: str  # e.g. "boldkast"
    version: str  # e.g. "v1"
    html: str
    title: str  # from <title>, for a human-readable tool description

    @property
    def resource_uri(self) -> str:
        return f"ui://aipla/{self.name}/{self.version}"

    @property
    def tool_name(self) -> str:
        return f"show_{self.name.replace('-', '_')}"


def discover_artefacts() -> list[Artefact]:
    """Scan artefacts/, return the latest bridge-speaking version of each sim."""
    found: list[Artefact] = []
    for sim_dir in sorted(p for p in ARTEFACTS_DIR.iterdir() if p.is_dir()):
        if sim_dir.name.startswith("_"):  # _template is a scaffold, not a sim
            continue
        versions = sorted(
            (d for d in sim_dir.iterdir() if d.is_dir() and _VERSION_RE.match(d.name)),
            key=lambda d: int(_VERSION_RE.match(d.name).group(1)),  # type: ignore[union-attr]
            reverse=True,
        )
        for vdir in versions:  # newest first; take the first that has a bridged index.html
            index = vdir / "index.html"
            if not index.is_file():
                continue
            html = index.read_text(encoding="utf-8")
            if BRIDGE_MARKER not in html:
                break  # newest version isn't bridge-ready — skip this sim, don't fall back
            title_match = _TITLE_RE.search(html)
            title = title_match.group(1).strip() if title_match else sim_dir.name
            found.append(Artefact(name=sim_dir.name, version=vdir.name, html=html, title=title))
            break
    return found


ARTEFACTS = discover_artefacts()
BY_URI = {a.resource_uri: a for a in ARTEFACTS}
BY_TOOL = {a.tool_name: a for a in ARTEFACTS}

server = Server("aipla-sims-demo")


# ── Resources: hand over each artefact's HTML ───────────────────────────────
@server.list_resources()
async def list_resources() -> list[types.Resource]:
    return [
        types.Resource(
            uri=a.resource_uri,  # type: ignore[arg-type]
            name=a.title,
            description=f"AIPLA physics-tutor workbench sim ({a.name} {a.version}).",
            mimeType=UI_MIME_TYPE,
        )
        for a in ARTEFACTS
    ]


@server.read_resource()
async def read_resource(uri) -> list[ReadResourceContents]:
    artefact = BY_URI.get(str(uri).rstrip("/"))
    if artefact is None:
        raise ValueError(f"Unknown resource: {uri}")
    # The sims are self-contained (inline canvas/JS, no external fetches), so we
    # declare no CSP — the host applies the restrictive default
    # (script-src 'self' 'unsafe-inline'), which is exactly what they need.
    return [ReadResourceContents(content=artefact.html, mime_type=UI_MIME_TYPE)]


# ── Tools: one agent-callable entry point per sim, linked to its UI resource ─
@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name=a.tool_name,
            description=(
                f"Show the interactive '{a.title}' simulation. The student "
                "manipulates it directly; their interactions are fed back to you "
                "as model context so you can tutor on what they did."
            ),
            inputSchema={"type": "object", "properties": {}, "additionalProperties": False},
            _meta={
                # Standard MCP Apps linkage (Claude Desktop, VS Code, Goose, …,
                # and ChatGPT's MCP-Apps mode).
                "ui": {"resourceUri": a.resource_uri, "visibility": ["model", "app"]},
                # ChatGPT Apps SDK still reads this OpenAI-flavoured key.
                "openai/outputTemplate": a.resource_uri,
            },
        )
        for a in ARTEFACTS
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.ContentBlock]:
    artefact = BY_TOOL.get(name)
    if artefact is None:
        raise ValueError(f"Unknown tool: {name}")
    # Text fallback for hosts without MCP Apps support, and the model-visible
    # summary. The interactive iframe is rendered by the host from the linked
    # ui:// resource; this text is what the model "sees".
    return [
        types.TextContent(
            type="text",
            text=(
                f"Opened the '{artefact.title}' simulation. The student can interact "
                "with it now; their actions will arrive as model-context updates."
            ),
        )
    ]


# ── Transports ──────────────────────────────────────────────────────────────
async def run_stdio() -> None:
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def run_http(port: int) -> None:
    import uvicorn
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from starlette.applications import Starlette
    from starlette.routing import Mount

    # stateless=True keeps it friendly for hosts that open a fresh session per
    # request (e.g. ChatGPT). json_response=False uses SSE streaming.
    session_manager = StreamableHTTPSessionManager(app=server, json_response=False, stateless=True)

    async def handle_mcp(scope, receive, send) -> None:
        await session_manager.handle_request(scope, receive, send)

    @contextlib.asynccontextmanager
    async def lifespan(_app):
        async with session_manager.run():
            yield

    app = Starlette(routes=[Mount("/mcp", app=handle_mcp)], lifespan=lifespan)
    print(f"AIPLA sims MCP App server on http://localhost:{port}/mcp (Streamable HTTP)")
    print(f"Serving {len(ARTEFACTS)} sim(s): {', '.join(a.name for a in ARTEFACTS)}")
    uvicorn.run(app, host="0.0.0.0", port=port)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve every AIPLA sim as a portable MCP App.")
    parser.add_argument("--http", action="store_true", help="Serve over Streamable HTTP instead of stdio.")
    parser.add_argument("--port", type=int, default=8000, help="Port for --http mode (default: 8000).")
    args = parser.parse_args()

    if not ARTEFACTS:
        raise SystemExit(f"No bridge-speaking artefacts found under {ARTEFACTS_DIR}")

    if args.http:
        run_http(args.port)
    else:
        import anyio

        anyio.run(run_stdio)


if __name__ == "__main__":
    main()
