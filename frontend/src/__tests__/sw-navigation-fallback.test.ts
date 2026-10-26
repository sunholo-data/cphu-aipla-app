/**
 * public/sw.js — a failed navigation gets the OFFLINE page, never a cached app
 * page (1.1.138 M3, option b).
 *
 * A cached page is HTML from whichever build last served it. Served on a Wi-Fi
 * blip beside the current build's chunks it is the module-map skew behind the
 * `reading 'call'` crashes. The worker is loaded as-is into a fake
 * ServiceWorkerGlobalScope, so this tests the file that ships.
 */
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

type Listener = (event: unknown) => void;

function loadWorker(store: Map<string, string>, fetchImpl: () => Promise<Response>) {
  const listeners: Record<string, Listener> = {};
  const cache = {
    put: async (req: Request | string, res: Response) => {
      store.set(typeof req === "string" ? req : new URL(req.url).pathname, await res.text());
    },
    addAll: async () => {},
  };
  const caches = {
    open: async () => cache,
    keys: async () => [],
    delete: async () => true,
    match: async (req: Request | string) => {
      const key = typeof req === "string" ? req : new URL(req.url).pathname;
      const body = store.get(key);
      return body === undefined ? undefined : new Response(body);
    },
  };
  const self = {
    location: { origin: "https://aipla.ku.dk" },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  vm.runInNewContext(SRC, { self, caches, fetch: fetchImpl, URL, Response });
  return listeners;
}

async function navigate(listeners: Record<string, Listener>, pathname: string) {
  let responded: Promise<Response> | undefined;
  const request = {
    url: `https://aipla.ku.dk${pathname}`,
    method: "GET",
    mode: "navigate",
    headers: new Headers(),
  };
  listeners.fetch({ request, respondWith: (p: Promise<Response>) => (responded = p) });
  expect(responded).toBeDefined();
  return responded!;
}

describe("sw.js navigation fallback", () => {
  it("serves /offline.html, not the cached app page, when the network fails", async () => {
    const store = new Map([
      ["/offline.html", "OFFLINE"],
      ["/teacher/classes", "OLD BUILD PAGE"],
    ]);
    const listeners = loadWorker(store, () => Promise.reject(new TypeError("offline")));
    const res = await navigate(listeners, "/teacher/classes");
    expect(await res.text()).toBe("OFFLINE");
  });

  it("does not cache a navigation response, so there is no app page to fall back to", async () => {
    const store = new Map<string, string>();
    const listeners = loadWorker(store, () => Promise.resolve(new Response("CURRENT")));
    const res = await navigate(listeners, "/teacher/classes");
    expect(await res.text()).toBe("CURRENT");
    await new Promise((r) => setTimeout(r, 0));
    expect(store.has("/teacher/classes")).toBe(false);
  });

  it("bumped CACHE_VERSION past v1 so activate deletes the v1 cached pages", () => {
    expect(SRC).toMatch(/const CACHE_VERSION = "aipla-v(\d+)"/);
    const v = Number(SRC.match(/const CACHE_VERSION = "aipla-v(\d+)"/)![1]);
    expect(v).toBeGreaterThan(1);
  });
});
