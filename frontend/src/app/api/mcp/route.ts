// Public MCP transport — a dedicated route to the backend's FastMCP server.
//
// Why a separate route (not just /api/proxy/mcp)? The catch-all forwards
// "/mcp" with NO trailing slash. FastMCP's Streamable-HTTP app is a Starlette
// mount at /mcp serving at its root, so the backend 307-redirects /mcp → /mcp/.
// The proxy's fetch sends the POST body as a consumed stream (duplex:"half")
// and cannot replay it across the redirect → `TypeError: fetch failed` → 502.
// And Next 308-strips a client-supplied "/mcp/", so callers can't add the slash
// themselves. Forwarding straight to "mcp/" here means there is no redirect to
// replay. Streaming (SSE) + the Mcp-Session-Id header round-trip via the shared
// forwarder.
//
// Public, no auth — matches the FastMCP server's "public skills, no auth"
// posture (see backend/protocols/mcp_server.py). The external MCP endpoint is
// https://<frontend-url>/api/mcp.

import { type NextRequest } from "next/server";

import { forwardToBackend } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

function mcp(req: NextRequest) {
  return forwardToBackend(req, "mcp/", req.nextUrl.search);
}

export const GET = mcp;
export const POST = mcp;
export const DELETE = mcp;
export const OPTIONS = mcp;
