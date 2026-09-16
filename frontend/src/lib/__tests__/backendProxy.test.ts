// @vitest-environment node
//
// Runs on the REAL Node fetch (undici), against a real local HTTP server — the
// failure this guards lives inside undici and cannot be seen through a mocked
// `fetch`. Node ≥ 24's undici treats a 401 as an HTTP-auth challenge and tries
// to replay the request; with a streamed body that is impossible, the fetch
// throws "expected non-null body source", and the proxy's catch turned it into
// a 502 "backend_unreachable". Every multipart POST with a lapsed group token
// did that on Node 26 (2026-09-16). `credentials: "omit"` keeps undici out of
// the auth business — the proxy forwards `Authorization` itself.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

let server: Server;
let seen: Seen[] = [];
let respondWith: { status: number; body: string } = { status: 200, body: "{}" };

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(respondWith.status, { "content-type": "application/json" });
      res.end(respondWith.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("BACKEND_URL", `http://127.0.0.1:${port}`);
  vi.resetModules();
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((r) => server.close(() => r()));
});

async function forward(req: NextRequest, path: string) {
  // Import AFTER the env stub — BACKEND_URL is read at module load.
  const { forwardToBackend } = await import("@/lib/backendProxy");
  return forwardToBackend(req, path);
}

function multipartRequest(extraHeaders: Record<string, string> = {}, payloadBytes = 5): NextRequest {
  const boundary = "----vitest";
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="t.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="skill_id"\r\n\r\nact-1\r\n--${boundary}--\r\n`);
  const payload = new Uint8Array(payloadBytes).fill(0x41);
  // A streamed body — what Next hands a route handler for a browser upload.
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(head);
      c.enqueue(payload);
      c.enqueue(tail);
      c.close();
    },
  });
  // `duplex` is required for a streamed body on Node's fetch but absent from
  // the DOM lib's RequestInit — same cast the proxy itself has to make.
  const init = {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      authorization: "Bearer stale-group-token",
      ...extraHeaders,
    },
    body,
    duplex: "half",
  } as unknown as ConstructorParameters<typeof NextRequest>[1];
  return new NextRequest("http://localhost/api/proxy/api/documents/upload", init);
}

describe("forwardToBackend — streamed request bodies", () => {
  it("passes a 401 from the sidecar through as a 401, not a 502, with a streamed body", async () => {
    seen = [];
    respondWith = { status: 401, body: '{"detail":"Invalid token"}' };

    const resp = await forward(multipartRequest(), "api/documents/upload");

    expect(resp.status).toBe(401);
    expect(await resp.json()).toEqual({ detail: "Invalid token" });
    // The request actually reached the sidecar with its Authorization intact —
    // the group-token refresh in fetchWithAuth keys off THIS 401.
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBe("Bearer stale-group-token");
  });

  it("streams a multi-megabyte multipart body to the sidecar intact", async () => {
    seen = [];
    respondWith = { status: 200, body: '{"docId":"d1","status":"parsed"}' };
    const size = 4_447_698; // the PDF from the 2026-09-16 prod 504

    const resp = await forward(multipartRequest({}, size), "api/documents/upload");

    expect(resp.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe("/api/documents/upload");
    expect(seen[0].headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    const body = seen[0].body.toString("latin1");
    expect(body).toContain('name="skill_id"\r\n\r\nact-1');
    expect(body.endsWith("------vitest--\r\n")).toBe(true);
    expect(seen[0].body.length).toBeGreaterThan(size);
  });

  it("strips Expect: 100-continue (undici refuses it; browsers never send it)", async () => {
    seen = [];
    respondWith = { status: 200, body: "{}" };

    const resp = await forward(multipartRequest({ expect: "100-continue" }), "api/documents/upload");

    expect(resp.status).toBe(200);
    expect(seen[0].headers.expect).toBeUndefined();
  });
});
