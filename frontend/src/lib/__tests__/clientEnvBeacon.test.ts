/**
 * Screen-size slice of 1.1.96 M0 (2026-09-30) — the client environment beacon.
 *
 * Guards: once per page session; again only on a bucket change; nothing in the
 * payload that identifies a person or a browser; never throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANON_GROUP_TOKEN_STORAGE_KEY } from "@/lib/anonymousGroupAuth";
import {
  RESIZE_DEBOUNCE_MS,
  resetClientEnvBeaconForTests,
  sendClientEnvIfNewBucket,
  startClientEnvBeacon,
  surfaceFromPath,
  viewportBucket,
} from "@/lib/clientEnvBeacon";
import { CLIENT_ERROR_ENDPOINT } from "@/lib/clientErrorReporting";

function setViewport(width: number, height = 800) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function bodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));
}

describe("clientEnvBeacon", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetClientEnvBeaconForTests();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    setViewport(1366, 657);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends once on load, to the client-error endpoint, with keepalive and no auth header", () => {
    const stop = startClientEnvBeacon();
    vi.advanceTimersByTime(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CLIENT_ERROR_ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    stop();
  });

  it("does not re-send on a resize within the same bucket, or on a remount", () => {
    const stop = startClientEnvBeacon();
    vi.advanceTimersByTime(0);
    setViewport(1400); // still 1280–1439
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    stop();
    // A client-side navigation remounts nothing, but even a remount is one session.
    const stop2 = startClientEnvBeacon();
    vi.advanceTimersByTime(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop2();
  });

  it("re-sends only when a debounced resize crosses a bucket", () => {
    const stop = startClientEnvBeacon();
    vi.advanceTimersByTime(0);
    // A drag through several widths: only where it settles counts.
    setViewport(900);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS / 2);
    setViewport(1500);
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies(fetchMock)[1].viewportW).toBe(1500);
    stop();
  });

  it("carries only the documented fields — no user agent, path or ids", () => {
    sessionStorage.setItem(ANON_GROUP_TOKEN_STORAGE_KEY, "eyJ.fake.token");
    sendClientEnvIfNewBucket();
    const body = bodies(fetchMock)[0];
    expect(Object.keys(body).sort()).toEqual(
      ["buildId", "dpr", "kind", "pointer", "screenH", "screenW", "surface", "viewportH", "viewportW"].sort(),
    );
    expect(body.kind).toBe("env");
    expect(JSON.stringify(body)).not.toMatch(/Mozilla|jsdom|eyJ/);
    sessionStorage.clear();
  });

  it("stops for the page after a non-2xx (429)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429 });
    sendClientEnvIfNewBucket();
    await vi.runAllTimersAsync();
    setViewport(500);
    sendClientEnvIfNewBucket();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws when fetch throws synchronously", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("no fetch");
    });
    expect(() => sendClientEnvIfNewBucket()).not.toThrow();
  });
});

describe("surfaceFromPath", () => {
  it.each([
    ["/teacher", "teacher"],
    ["/teacher/classes/abc", "teacher"],
    ["/lessons/xyz", "student"],
    ["/chat/abc", "student"],
    ["/group", "student"],
    ["/project", "public"],
    ["/", "public"],
    ["/teachers-lounge", "public"],
  ])("%s → %s", (path, surface) => {
    expect(surfaceFromPath(path)).toBe(surface);
  });
});

describe("viewportBucket", () => {
  it.each([
    [0, 0],
    [767, 0],
    [768, 1],
    [1279, 1],
    [1280, 2],
    [1366, 2],
    [1440, 3],
    [1919, 3],
    [1920, 4],
    [3840, 4],
  ])("%i → bucket %i", (w, b) => {
    expect(viewportBucket(w)).toBe(b);
  });
});
