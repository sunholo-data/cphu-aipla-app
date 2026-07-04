// Behavioural tests for the canonical MCP App guest bridge
// (bridge/aipla-mcp-bridge.js). This is the ONLY behavioural test of the guest
// emit code — the per-sim *SimFrame components + their integration tests were
// retired by unified-sim-rendering; sims now render through GenericArtefactFrame.
//
// Zero-dependency approach: the bridge is browser JS that reads a global
// `window`. We read the source and evaluate it inside `new Function('window',…)`
// with a hand-rolled fake window, so no jsdom/happy-dom devDependency is needed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const BRIDGE_SRC = readFileSync(
  fileURLToPath(new URL("../bridge/aipla-mcp-bridge.js", import.meta.url)),
  "utf8",
);

type Posted = Record<string, any>;

interface FakeWindow {
  openai?: any;
  parent: { postMessage: (m: Posted, origin: string) => void };
  addEventListener: (t: string, cb: (e: { data: any }) => void) => void;
  removeEventListener: (t: string, cb: (e: { data: any }) => void) => void;
  AIPLA_BRIDGE?: any;
  // test helpers
  __posted: Posted[];
  __deliver: (data: any) => void;
}

function makeWindow(openai?: any): FakeWindow {
  const listeners: Array<(e: { data: any }) => void> = [];
  const posted: Posted[] = [];
  const win: FakeWindow = {
    openai,
    parent: { postMessage: (m) => posted.push(m) },
    addEventListener: (t, cb) => {
      if (t === "message") listeners.push(cb);
    },
    removeEventListener: (t, cb) => {
      if (t !== "message") return;
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    __posted: posted,
    __deliver: (data) => listeners.slice().forEach((cb) => cb({ data })),
  };
  return win;
}

function loadBridge(win: FakeWindow): any {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function("window", `${BRIDGE_SRC}\nreturn window.AIPLA_BRIDGE;`);
  return factory(win);
}

/** Deliver the ui/initialize response so the handshake resolves + flushes. */
async function completeHandshake(win: FakeWindow, hostContext: any = { app: "test" }) {
  const initReq = win.__posted.find((m) => m.method === "ui/initialize");
  expect(initReq, "ui/initialize should have been posted by init()").toBeTruthy();
  win.__deliver({ jsonrpc: "2.0", id: initReq!.id, result: { hostContext } });
  await Promise.resolve();
  await Promise.resolve();
}

describe("emit — SEP-1865 postMessage path (AIPLA app / native hosts)", () => {
  it("queues emits before init, flushes them in order once initialized", async () => {
    const win = makeWindow();
    const bridge = loadBridge(win);

    bridge.emit("boldkast.play", { v0: 15 });
    bridge.emit("boldkast.state-change", { state: { v0: 15 }, label: "Afspillede med v₀=15 m/s" });

    // Nothing on the wire yet except (after init call) the handshake request.
    expect(win.__posted.filter((m) => m.method === "ui/update-model-context")).toHaveLength(0);

    bridge.init({ name: "boldkast", version: "1.0.0" });
    await completeHandshake(win);

    const updates = win.__posted.filter((m) => m.method === "ui/update-model-context");
    expect(updates).toHaveLength(2);
    expect(updates[0].params.structuredContent).toMatchObject({ kind: "boldkast.play", v0: 15 });
    expect(updates[1].params.structuredContent).toMatchObject({ kind: "boldkast.state-change" });
  });

  it("emits directly (no queue) after init", async () => {
    const win = makeWindow();
    const bridge = loadBridge(win);
    bridge.init({ name: "boldkast", version: "1.0.0" });
    await completeHandshake(win);

    win.__posted.length = 0;
    bridge.emit("boldkast.reset", {});
    const updates = win.__posted.filter((m) => m.method === "ui/update-model-context");
    expect(updates).toHaveLength(1);
    expect(updates[0].params.structuredContent.kind).toBe("boldkast.reset");
  });

  it("carries structuredContent.kind and a derived content text block", () => {
    const win = makeWindow();
    const bridge = loadBridge(win);
    bridge.init({ name: "led-planck", version: "1.0.0" });
    // still queued (handshake not resolved) — inspect the queued shape via a
    // labelled commit that forces content
    bridge.emit("led-planck.reading", { voltage: 2.1 });
    // deliver handshake then read the flushed message
    const initReq = win.__posted.find((m) => m.method === "ui/initialize")!;
    win.__deliver({ jsonrpc: "2.0", id: initReq.id, result: {} });
    return Promise.resolve().then(() => {
      const update = win.__posted.find((m) => m.method === "ui/update-model-context")!;
      expect(update.params.structuredContent.kind).toBe("led-planck.reading");
      expect(update.params.content[0].type).toBe("text");
      expect(update.params.content[0].text).toContain("voltage=2.1");
    });
  });

  it("prefers a curated label for the content text", async () => {
    const win = makeWindow();
    const bridge = loadBridge(win);
    bridge.init({ name: "boldkast", version: "1.0.0" });
    await completeHandshake(win);
    win.__posted.length = 0;
    bridge.emit("boldkast.state-change", { state: { v0: 15 }, label: "Afspillede med v₀=15 m/s, θ=40°" });
    const update = win.__posted.find((m) => m.method === "ui/update-model-context")!;
    expect(update.params.content[0].text).toBe("Afspillede med v₀=15 m/s, θ=40°");
  });
});

describe("emit — ChatGPT window.openai path", () => {
  it("a labelled commit sets widget state AND injects a follow-up turn", async () => {
    const openai = { setWidgetState: vi.fn(), sendFollowUpMessage: vi.fn() };
    const win = makeWindow(openai);
    const bridge = loadBridge(win);
    bridge.init({ name: "boldkast", version: "1.0.0" });
    // no real postMessage host in ChatGPT — handshake never resolves; emit still
    // reaches window.openai synchronously (before the queue check).
    bridge.emit("boldkast.state-change", {
      state: { v0: 15, theta: 40 },
      label: "Afspillede med v₀=15 m/s, θ=40°",
    });

    expect(openai.setWidgetState).toHaveBeenCalledTimes(1);
    expect(openai.setWidgetState).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "boldkast.state-change", state: { v0: 15, theta: 40 } }),
    );
    expect(openai.sendFollowUpMessage).toHaveBeenCalledTimes(1);
    expect(openai.sendFollowUpMessage).toHaveBeenCalledWith({ prompt: "Afspillede med v₀=15 m/s, θ=40°" });
  });

  it("a passive settle (no label) sets widget state but injects NO follow-up", () => {
    const openai = { setWidgetState: vi.fn(), sendFollowUpMessage: vi.fn() };
    const win = makeWindow(openai);
    const bridge = loadBridge(win);
    bridge.init({ name: "boldkast", version: "1.0.0" });
    bridge.emit("boldkast.param.change", { param: "v0", value: 12 });

    expect(openai.setWidgetState).toHaveBeenCalledTimes(1);
    expect(openai.sendFollowUpMessage).not.toHaveBeenCalled();
  });

  it("never throws when window.openai is a partial/old object", () => {
    const win = makeWindow({}); // openai present but no methods
    const bridge = loadBridge(win);
    bridge.init({ name: "boldkast", version: "1.0.0" });
    expect(() =>
      bridge.emit("boldkast.state-change", { label: "commit" }),
    ).not.toThrow();
  });
});

describe("emit — no window.openai (AIPLA app / Claude): pure no-op", () => {
  it("does not throw and uses only the postMessage path", async () => {
    const win = makeWindow(undefined);
    const bridge = loadBridge(win);
    bridge.init({ name: "kinebot", version: "1.0.0" });
    await completeHandshake(win);
    win.__posted.length = 0;
    expect(() => bridge.emit("kinebot.run", { label: "Kørte simulationen" })).not.toThrow();
    const updates = win.__posted.filter((m) => m.method === "ui/update-model-context");
    expect(updates).toHaveLength(1);
  });
});

describe("host→iframe notifications", () => {
  it("responds to ping with an empty result", () => {
    const win = makeWindow();
    loadBridge(win);
    win.__deliver({ jsonrpc: "2.0", id: 99, method: "ping" });
    const pong = win.__posted.find((m) => m.id === 99);
    expect(pong).toMatchObject({ jsonrpc: "2.0", id: 99, result: {} });
  });

  it("routes onChatFlush", () => {
    const win = makeWindow();
    const bridge = loadBridge(win);
    const flushed = vi.fn();
    bridge.onChatFlush(flushed);
    win.__deliver({ jsonrpc: "2.0", method: "ui/notifications/chat-flush" });
    expect(flushed).toHaveBeenCalledTimes(1);
  });

  it("routes a custom onHostNotification (e.g. kinebot.set-topic) with params", () => {
    const win = makeWindow();
    const bridge = loadBridge(win);
    const setTopic = vi.fn();
    bridge.onHostNotification("kinebot.set-topic", setTopic);
    win.__deliver({ jsonrpc: "2.0", method: "kinebot.set-topic", params: { topic: "vectors" } });
    expect(setTopic).toHaveBeenCalledWith({ topic: "vectors" }, expect.any(Object));
  });

  it("a throwing handler does not break the bridge", () => {
    const win = makeWindow();
    const bridge = loadBridge(win);
    bridge.onChatFlush(() => {
      throw new Error("boom");
    });
    expect(() => win.__deliver({ jsonrpc: "2.0", method: "ui/notifications/chat-flush" })).not.toThrow();
  });
});
