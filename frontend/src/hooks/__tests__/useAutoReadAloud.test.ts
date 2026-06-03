import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { VOICE_CANCEL_EVENT, useAutoReadAloud } from "@/hooks/useAutoReadAloud";

// jsdom's localStorage doesn't provide setItem/getItem in this project's
// vitest setup. Stub a minimal in-memory shim per test so the hook's
// persistence path runs without relying on the host.

let storage: Record<string, string>;

beforeEach(() => {
  storage = {};
  const stub = {
    getItem: (k: string) => (k in storage ? storage[k] : null),
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
    clear: () => {
      storage = {};
    },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() {
      return Object.keys(storage).length;
    },
  };
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: stub,
  });
});

afterEach(() => {
  storage = {};
});

describe("useAutoReadAloud", () => {
  it("defaults to OFF when localStorage is empty", () => {
    const { result } = renderHook(() => useAutoReadAloud());
    expect(result.current.enabled).toBe(false);
  });

  it("reads initial state from localStorage", () => {
    storage["aipla.voice.auto_read"] = "1";
    const { result } = renderHook(() => useAutoReadAloud());
    expect(result.current.enabled).toBe(true);
  });

  it("toggle() flips state + persists to localStorage", () => {
    const { result } = renderHook(() => useAutoReadAloud());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(storage["aipla.voice.auto_read"]).toBe("1");
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(storage["aipla.voice.auto_read"]).toBe("0");
  });

  it("toggle() OFF mid-utterance dispatches voice.cancel event", () => {
    storage["aipla.voice.auto_read"] = "1";
    const cancelSpy = vi.fn();
    window.addEventListener(VOICE_CANCEL_EVENT, cancelSpy);
    try {
      const { result } = renderHook(() => useAutoReadAloud());
      act(() => result.current.toggle()); // ON -> OFF
      expect(cancelSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(VOICE_CANCEL_EVENT, cancelSpy);
    }
  });

  it("toggle() ON does NOT dispatch voice.cancel", () => {
    const cancelSpy = vi.fn();
    window.addEventListener(VOICE_CANCEL_EVENT, cancelSpy);
    try {
      const { result } = renderHook(() => useAutoReadAloud());
      act(() => result.current.toggle()); // OFF -> ON
      expect(cancelSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(VOICE_CANCEL_EVENT, cancelSpy);
    }
  });

  it("cancelInFlight() always dispatches voice.cancel", () => {
    const cancelSpy = vi.fn();
    window.addEventListener(VOICE_CANCEL_EVENT, cancelSpy);
    try {
      const { result } = renderHook(() => useAutoReadAloud());
      act(() => result.current.cancelInFlight());
      expect(cancelSpy).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(VOICE_CANCEL_EVENT, cancelSpy);
    }
  });

  it("syncs across tabs via the storage event", () => {
    const { result } = renderHook(() => useAutoReadAloud());
    expect(result.current.enabled).toBe(false);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "aipla.voice.auto_read",
          newValue: "1",
        }),
      );
    });
    expect(result.current.enabled).toBe(true);
  });

  it("survives localStorage write failures (private mode)", () => {
    storage["aipla.voice.auto_read"] = "";
    const failingStub = {
      getItem: () => null,
      setItem: () => {
        throw new Error("private mode");
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value: failingStub,
    });
    const { result } = renderHook(() => useAutoReadAloud());
    expect(result.current.enabled).toBe(false);
    // toggle() must not throw.
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
  });
});
