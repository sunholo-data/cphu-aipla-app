import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RELOAD_COOLDOWN_MS,
  clientBuildId,
  isChunkLoadFailure,
  isStaleDeployError,
  reloadIfStaleDeploy,
  shouldAutoReload,
  takePendingReload,
} from "@/lib/staleDeployReload";

const reload = vi.fn();

beforeEach(() => {
  window.sessionStorage.clear();
  reload.mockReset();
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isStaleDeployError", () => {
  it.each([
    // The two prod messages, 2026-09-23/24.
    `can't access property "call", e[o] is undefined`,
    "Cannot read properties of undefined (reading 'call')",
    "Loading chunk 1255 failed.",
    "Loading CSS chunk app-layout failed",
    "Failed to fetch dynamically imported module: https://x/_next/a.js",
  ])("recognises %s", (message) => {
    expect(isStaleDeployError(new TypeError(message))).toBe(true);
  });

  it("recognises webpack's ChunkLoadError by name", () => {
    const err = Object.assign(new Error("whatever"), { name: "ChunkLoadError" });
    expect(isStaleDeployError(err)).toBe(true);
    expect(isChunkLoadFailure(err)).toBe(true);
  });

  it("ignores ordinary bugs", () => {
    expect(isStaleDeployError(new TypeError("Cannot read properties of undefined (reading 'name')"))).toBe(false);
    expect(isStaleDeployError(null)).toBe(false);
  });

  it("the window-listener test does NOT trust the bare 'call' TypeError", () => {
    expect(isChunkLoadFailure(new TypeError("Cannot read properties of undefined (reading 'call')"))).toBe(false);
  });
});

describe("reloadIfStaleDeploy", () => {
  const stale = new TypeError("Cannot read properties of undefined (reading 'call')");

  it("reloads once for a stale deploy", () => {
    expect(reloadIfStaleDeploy(stale)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never loops: a second crash inside the cooldown shows the boundary", () => {
    reloadIfStaleDeploy(stale);
    expect(reloadIfStaleDeploy(stale)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the cooldown has passed (the next deploy)", () => {
    reloadIfStaleDeploy(stale);
    const later = Date.now() + RELOAD_COOLDOWN_MS + 1;
    vi.spyOn(Date, "now").mockReturnValue(later);
    expect(reloadIfStaleDeploy(stale)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an ordinary error", () => {
    expect(reloadIfStaleDeploy(new Error("boom"))).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("chunkLoadOnly skips the looser module-factory signature", () => {
    expect(reloadIfStaleDeploy(stale, { chunkLoadOnly: true })).toBe(false);
    expect(reloadIfStaleDeploy(new Error("Loading chunk 7 failed."), { chunkLoadOnly: true })).toBe(true);
  });

  it("does not reload when storage is blocked (no loop guard)", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(reloadIfStaleDeploy(stale)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("1.1.138 M0 — which crash it was", () => {
  const stale = new TypeError("Cannot read properties of undefined (reading 'call')");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shouldAutoReload predicts the reload without starting it", () => {
    expect(shouldAutoReload(stale)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(shouldAutoReload(new Error("boom"))).toBe(false);
    expect(shouldAutoReload(stale, { chunkLoadOnly: true })).toBe(false);
  });

  it("shouldAutoReload agrees with the cooldown", () => {
    reloadIfStaleDeploy(stale);
    expect(shouldAutoReload(stale)).toBe(false);
  });

  it("clientBuildId reads the inlined build id, null when absent", () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "");
    expect(clientBuildId()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "b20260929080000-abcd");
    expect(clientBuildId()).toBe("b20260929080000-abcd");
  });

  it("a reload leaves a marker naming the build it came from; the next load takes it once", () => {
    vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "b-old");
    reloadIfStaleDeploy(stale);
    const pending = takePendingReload();
    expect(pending?.fromBuildId).toBe("b-old");
    // One-shot: a boundary that takes it means the recovery check cannot.
    expect(takePendingReload()).toBeNull();
  });

  it("no reload, no marker", () => {
    reloadIfStaleDeploy(new Error("ordinary bug"));
    expect(takePendingReload()).toBeNull();
  });

  it("a stale marker (the reloaded page never ran) is not claimed later", () => {
    reloadIfStaleDeploy(stale);
    expect(takePendingReload(Date.now() + RELOAD_COOLDOWN_MS + 1)).toBeNull();
  });

  it("a corrupt marker is ignored, never thrown", () => {
    window.sessionStorage.setItem("aipla:stale-deploy-reload-pending", "{not json");
    expect(takePendingReload()).toBeNull();
  });
});
