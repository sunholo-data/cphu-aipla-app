"""Smoke-test the AIPLA-sims MCP App server the way an external host would.

Spawns server.py over stdio, runs the MCP handshake, and asserts for EVERY
discovered sim:
  - tools/list returns a `show_<name>` tool with _meta.ui.resourceUri set
  - the tool also carries openai/outputTemplate (ChatGPT compatibility)
  - resources/read on the ui:// URI returns HTML with the mcp-app mimeType
    that actually runs the bridge handshake

Run from a python env that has `mcp` installed, e.g.:
  cd backend && uv run python ../infrastructure/mcp-sandbox/external-host-demo/smoke_test.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import anyio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = Path(__file__).resolve().parent / "server.py"
MIME = "text/html;profile=mcp-app"


async def main() -> int:
    params = StdioServerParameters(command="uv", args=["run", "--script", str(SERVER)])
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        init = await session.initialize()
        print(f"initialized — server: {init.serverInfo.name}, protocol: {init.protocolVersion}")

        tools = (await session.list_tools()).tools
        show_tools = [t for t in tools if t.name.startswith("show_")]
        assert show_tools, "no show_<sim> tools registered"
        print(f"discovered {len(show_tools)} sim tool(s): {[t.name for t in show_tools]}\n")

        for tool in show_tools:
            meta = tool.meta or {}
            ui_uri = (meta.get("ui") or {}).get("resourceUri")
            oai_uri = meta.get("openai/outputTemplate")
            assert ui_uri, f"{tool.name}: missing _meta.ui.resourceUri"
            assert oai_uri == ui_uri, f"{tool.name}: ChatGPT key missing/wrong: {oai_uri}"

            content = await session.read_resource(ui_uri)  # type: ignore[arg-type]
            block = content.contents[0]
            mime = getattr(block, "mimeType", None)
            text = getattr(block, "text", "") or ""
            assert mime == MIME, f"{tool.name}: wrong mimeType {mime}"
            assert "ui/initialize" in text, f"{tool.name}: artefact HTML missing the bridge handshake"
            assert "<!doctype html>" in text.lower(), f"{tool.name}: not an HTML document"
            print(f"  OK  {tool.name:22} -> {ui_uri}  ({len(text)} bytes, mimeType ok, bridge present)")

    print("\nALL CHECKS PASSED — every sim is a spec-compliant MCP App an external host can render.")
    return 0


if __name__ == "__main__":
    sys.exit(anyio.run(main))
