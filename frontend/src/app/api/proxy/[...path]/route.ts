// Workshop W5b — The Proxy: Why It Exists
// In Cloud Run, frontend and backend are separate containers. The browser
// reaches one origin, so every /api/proxy/** request forwards to the backend
// sidecar. The forwarding core (IPv4 literal, SSE passthrough, header filter,
// null-body handling) lives in @/lib/backendProxy so the dedicated /api/mcp
// route shares exactly the same battle-tested logic.

import { type NextRequest } from "next/server";

import { forwardToBackend } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";

/**
 * Catch-all proxy to the sidecar backend.
 *
 * Forwards every method with its body + query string to `${BACKEND_URL}/<path>`,
 * passing the client's `Authorization: Bearer <jwt>` header through untouched so
 * the backend's `Depends(get_current_user)` can verify it.
 *
 * Regression guard: a curl to `/api/proxy/api/skills` without a Bearer token
 * must return a JSON 401 from the backend, never a Next 404.
 */
async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const backendPath = path.map(encodeURIComponent).join("/");
  return forwardToBackend(req, backendPath, req.nextUrl.search);
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
