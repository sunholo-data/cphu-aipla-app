// Shared sidecar-proxy core, used by both the catch-all /api/proxy/[...path]
// route and the dedicated /api/mcp route.
//
// In Cloud Run the frontend and backend are one multi-container service; the
// browser reaches one origin, so server-side routes forward to the backend
// sidecar at http://127.0.0.1:1956. Two gotchas live here (see the
// FE-BRINGUP-1 postmortem, docs/ops/incidents/fe-bringup-1-proxy-404.md):
//   1. IPv4 literal (127.0.0.1) not "localhost" — Node DNS can resolve
//      localhost to ::1 while uvicorn only listens on IPv4. Silent failure.
//   2. SSE passthrough: detect text/event-stream and stream the body directly.
//      Buffer it first and you turn SSE into a single delayed response.

import { NextResponse, type NextRequest } from "next/server";

// Default backend is the sidecar's IPv4 literal. Never fall back to :8080 —
// that's Next's own ingress port in Cloud Run, which would loop requests back
// into this process and return a Next 404 HTML page.
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:1956";

// Headers that must not be forwarded upstream: hop-by-hop, Next-internal, or
// ones that would confuse the upstream server (host rewriting).
const BLOCKED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  // Next/fetch-internal
  "x-middleware-invoke",
  "x-invoke-path",
  "x-invoke-query",
]);

// HTTP statuses that must not carry a body (per the Fetch spec). The Web
// Response constructor throws if you pass a non-null body with one of these.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

// Response headers we should not echo back (fetch sets Content-Length itself;
// hop-by-hop headers don't belong in a Next response). Note: Mcp-Session-Id is
// deliberately NOT blocked — Streamable HTTP needs it round-tripped.
const BLOCKED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-length",
  "transfer-encoding",
  "keep-alive",
]);

function filterRequestHeaders(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!BLOCKED_REQUEST_HEADERS.has(key.toLowerCase())) {
      out.set(key, value);
    }
  });
  return out;
}

function filterResponseHeaders(headers: Headers): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!BLOCKED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      out.set(key, value);
    }
  });
  return out;
}

/**
 * Forward `req` to `${BACKEND_URL}/${backendPath}${search}`, passing the body,
 * the client's `Authorization` header, and any `Mcp-Session-Id` through
 * untouched. `backendPath` is already URL-encoded and has NO leading slash;
 * include a trailing slash when the upstream requires one (e.g. `"mcp/"` —
 * FastMCP's mount 307-redirects `/mcp` → `/mcp/`, and a redirect can't replay
 * a consumed streaming body).
 */
export async function forwardToBackend(
  req: NextRequest,
  backendPath: string,
  search = "",
): Promise<NextResponse> {
  const url = `${BACKEND_URL}/${backendPath}${search}`;

  const init: RequestInit = {
    method: req.method,
    headers: filterRequestHeaders(req.headers),
    // Avoid Next fetch cache — we're a proxy, not a CDN.
    cache: "no-store",
    // Required when forwarding a streaming body in Node's fetch.
    // @ts-expect-error — `duplex` is valid on Node's fetch but not in the DOM lib types.
    duplex: "half",
  };

  // Only attach a body for methods that can have one.
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
  }

  try {
    const upstream = await fetch(url, init);
    const contentType = upstream.headers.get("content-type") ?? "";
    if (contentType.includes("text/event-stream")) {
      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: filterResponseHeaders(upstream.headers),
      });
    }
    // Null-body statuses (101/103/204/205/304) MUST be constructed with a null
    // body — passing a buffer throws and the catch below would turn that into a
    // spurious 502. The iframe-context endpoint returns 204.
    if (NULL_BODY_STATUSES.has(upstream.status)) {
      return new NextResponse(null, {
        status: upstream.status,
        headers: filterResponseHeaders(upstream.headers),
      });
    }
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: upstream.status,
      headers: filterResponseHeaders(upstream.headers),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "backend_unreachable", message: String(err) },
      { status: 502 },
    );
  }
}
