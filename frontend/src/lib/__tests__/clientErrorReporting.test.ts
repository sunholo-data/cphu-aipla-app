/**
 * 1.1.96 M-1 — the client error reporter.
 *
 * The three things worth guarding: it never leaks a secret, it never floods, and
 * it never throws (a throw inside the error reporter would be the worst bug this
 * file could have).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANON_GROUP_TOKEN_STORAGE_KEY } from "@/lib/anonymousGroupAuth";
import {
  CLIENT_ERROR_ENDPOINT,
  MAX_REPORTS_PER_PAGE,
  redact,
  reportClientError,
  resetClientErrorReportingForTests,
} from "@/lib/clientErrorReporting";

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("redact", () => {
  it.each([
    ["token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-Value_1", "eyJhbGciOiJIUzI1NiJ9"],
    ["Bearer sk-live-abcdefghijklmnop failed", "sk-live-abcdefghijklmnop"],
    ["no user for teacher@ku.dk", "teacher@ku.dk"],
    ["GET /group?code=ABC123 failed", "ABC123"],
  ])("removes the secret from %s", (raw, secret) => {
    const out = redact(raw);
    expect(out).not.toContain(secret);
    expect(out).toContain("[redacted]");
  });

  it("keeps an ordinary message intact — redaction that eats the message defeats the point", () => {
    const msg = "TypeError: Cannot read properties of undefined (reading 'title')";
    expect(redact(msg)).toBe(msg);
  });

  it("leaves a bare question mark alone — the pattern requires a key=", () => {
    expect(redact("Why did this fail? No idea.")).toBe("Why did this fail? No idea.");
  });

  it("collapses a Bearer JWT to one marker, not a nested pair", () => {
    const out = redact("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigValue");
    expect(out.match(/\[redacted\]/g)).toHaveLength(1);
  });
});

describe("reportClientError", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetClientErrorReportingForTests();
    window.sessionStorage.clear();
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/teacher/classes/abc");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("POSTs to the unauthenticated endpoint with no Authorization header", () => {
    reportClientError({ kind: "render", message: "boom" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(CLIENT_ERROR_ENDPOINT);
    expect((init as RequestInit).keepalive).toBe(true);
    expect(JSON.stringify((init as RequestInit).headers)).not.toContain("Authorization");
  });

  it("sends the pathname only — never the query string", () => {
    window.history.pushState({}, "", "/group?code=SECRET1#frag");
    reportClientError({ kind: "render", message: "boom" });
    const body = lastBody(fetchMock);
    expect(body.url).toBe("/group");
    expect(JSON.stringify(body)).not.toContain("SECRET1");
  });

  it("sends no identity at all", () => {
    reportClientError({ kind: "render", message: "boom" });
    const body = lastBody(fetchMock);
    expect(Object.keys(body).sort()).toEqual(["kind", "message", "role", "stack", "url"]);
  });

  it("redacts the message and the stack before they leave the browser", () => {
    reportClientError({
      kind: "unhandledrejection",
      message: "401 for teacher@ku.dk",
      stack: "at fetch (Bearer sk-live-abcdefghijklmnop)",
    });
    const body = lastBody(fetchMock);
    expect(body.message).not.toContain("teacher@ku.dk");
    expect(body.stack).not.toContain("sk-live-abcdefghijklmnop");
  });

  it("appends the React component stack to the stack field", () => {
    reportClientError({ kind: "render", message: "boom", stack: "at X", componentStack: "in ClassPage" });
    expect(lastBody(fetchMock).stack).toContain("in ClassPage");
  });

  it("truncates an oversize message and stack", () => {
    reportClientError({ kind: "render", message: "x".repeat(2000), stack: "y".repeat(9000) });
    const body = lastBody(fetchMock);
    expect(body.message).toHaveLength(500);
    expect(body.stack).toHaveLength(4000);
  });

  it("reports the same error only once", () => {
    reportClientError({ kind: "render", message: "boom", stack: "at X" });
    reportClientError({ kind: "render", message: "boom", stack: "at X" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("caps the number of distinct reports per page load", () => {
    for (let i = 0; i < MAX_REPORTS_PER_PAGE + 5; i += 1) {
      reportClientError({ kind: "render", message: `boom ${i}` });
    }
    expect(fetchMock).toHaveBeenCalledTimes(MAX_REPORTS_PER_PAGE);
  });

  it("stops for the rest of the page after a non-2xx (the backend's 429)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
    reportClientError({ kind: "render", message: "first" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    reportClientError({ kind: "render", message: "second" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not throw when fetch rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() => reportClientError({ kind: "render", message: "boom" })).not.toThrow();
  });

  it("does not throw when fetch itself is missing", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => reportClientError({ kind: "render", message: "boom" })).not.toThrow();
  });

  it("sends nothing in LOCAL_MODE", () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    reportClientError({ kind: "render", message: "boom" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("role hint", () => {
    it("is student when a group session is stored", () => {
      window.sessionStorage.setItem(ANON_GROUP_TOKEN_STORAGE_KEY, JSON.stringify({ token: "t" }));
      reportClientError({ kind: "render", message: "boom" });
      expect(lastBody(fetchMock).role).toBe("student");
    });

    it("is teacher on a /teacher path with no group session", () => {
      reportClientError({ kind: "render", message: "boom" });
      expect(lastBody(fetchMock).role).toBe("teacher");
    });

    it("is anon elsewhere — an honest default beats a guess", () => {
      window.history.pushState({}, "", "/project/about");
      reportClientError({ kind: "render", message: "boom" });
      expect(lastBody(fetchMock).role).toBe("anon");
    });
  });
});
