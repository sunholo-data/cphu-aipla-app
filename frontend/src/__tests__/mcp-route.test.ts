import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal NextRequest-like object for the non-dynamic /api/mcp route handler.
function makeReq(init: RequestInit & { url?: string } = {}) {
  const url = init.url ?? "http://localhost:3000/api/mcp";
  const req = new Request(url, init) as Request & { nextUrl: URL };
  req.nextUrl = new URL(url);
  return req;
}

describe("/api/mcp route — public transport to the FastMCP server", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    process.env.BACKEND_URL = "http://127.0.0.1:1956";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The whole point of this route: the catch-all forwards /mcp (no slash), the
  // backend Starlette mount 307-redirects to /mcp/, and the proxy's
  // consumed-body fetch can't replay → 502. Forwarding straight to "mcp/"
  // (trailing slash) means there is no redirect to replay.
  it("forwards POST to the backend /mcp/ WITH a trailing slash (dodges the 307)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { POST } = await import("@/app/api/mcp/route");
    const req = makeReq({
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:1956/mcp/");
  });

  it("passes the Mcp-Session-Id response header back to the client", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ jsonrpc: "2.0" }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "sess-abc" },
      }),
    );
    const { POST } = await import("@/app/api/mcp/route");
    const req = makeReq({ method: "POST", body: "{}" });
    const res = await POST(req as never);
    expect(res.headers.get("mcp-session-id")).toBe("sess-abc");
  });

  it("pipes text/event-stream responses as a ReadableStream (not buffered)", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {}\n\n"));
        controller.close();
      },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const { GET } = await import("@/app/api/mcp/route");
    const req = makeReq({ method: "GET" });
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(ReadableStream);
  });

  it("returns 502 backend_unreachable when the upstream fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("fetch failed"));
    const { POST } = await import("@/app/api/mcp/route");
    const req = makeReq({ method: "POST", body: "{}" });
    const res = await POST(req as never);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("backend_unreachable");
  });
});
