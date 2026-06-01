import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStableThreadId } from "@/hooks/useStableThreadId";

// Polyfill / pin crypto.randomUUID for deterministic assertions where we
// only care that the value changed, not what it is.
beforeAll(() => {
  let n = 0;
  // jsdom has crypto.randomUUID, but pinning makes the change-detection
  // assertions in tests below far easier to read.
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => `mock-uuid-${++n}`,
  });
});

describe("useStableThreadId — chat-history-deep-fixes-2 Bug A' fix", () => {
  it("adopts the URL session id on initial mount when one is present", () => {
    const { result } = renderHook(() => useStableThreadId("existing-id"));
    expect(result.current).toBe("existing-id");
  });

  it("mints a fresh UUID on initial mount when URL has no session", () => {
    const { result } = renderHook(() => useStableThreadId(null));
    expect(result.current).toMatch(/^mock-uuid-\d+$/);
  });

  it("STAYS STABLE across URL writeback (URL gains the threadId we already had) — closes the visible flicker", () => {
    // Initial: no URL session → fresh UUID minted at init.
    const { result, rerender } = renderHook(
      ({ urlSessionId }: { urlSessionId: string | null }) =>
        useStableThreadId(urlSessionId),
      { initialProps: { urlSessionId: null as string | null } },
    );
    const initialThreadId = result.current;
    expect(initialThreadId).toMatch(/^mock-uuid-\d+$/);

    // URL writeback effect (in real chat page) rewrites ?session=<initialThreadId>
    rerender({ urlSessionId: initialThreadId });

    // Critical: the threadId must NOT change. AGUIProvider's useMemo
    // depends on this — a stable value means no HttpAgent rebuild,
    // which means agent.messages survives turn 1 with no flicker.
    expect(result.current).toBe(initialThreadId);
  });

  it("adopts a new id when the user navigates to a different existing thread", () => {
    const { result, rerender } = renderHook(
      ({ urlSessionId }: { urlSessionId: string | null }) =>
        useStableThreadId(urlSessionId),
      { initialProps: { urlSessionId: "session-A" as string | null } },
    );
    expect(result.current).toBe("session-A");

    rerender({ urlSessionId: "session-B" });
    expect(result.current).toBe("session-B");
  });

  it("mints a fresh UUID when URL ?session= is cleared (+ New conversation)", () => {
    const { result, rerender } = renderHook(
      ({ urlSessionId }: { urlSessionId: string | null }) =>
        useStableThreadId(urlSessionId),
      { initialProps: { urlSessionId: "existing-id" as string | null } },
    );
    const idBefore = result.current;
    expect(idBefore).toBe("existing-id");

    // User clicks "+ New conversation"
    rerender({ urlSessionId: null });

    expect(result.current).not.toBe(idBefore);
    expect(result.current).toMatch(/^mock-uuid-\d+$/);
  });
});

describe("useStableThreadId — session persistence (1.F M5)", () => {
  it("uses initialSessionId instead of minting a UUID when URL has no session", () => {
    const { result } = renderHook(() =>
      useStableThreadId(null, { initialSessionId: "resumed-sess-abc" }),
    );
    expect(result.current).toBe("resumed-sess-abc");
  });

  it("stays stable when URL writeback fires with the same id as initialSessionId", () => {
    const { result, rerender } = renderHook(
      ({ urlSessionId }: { urlSessionId: string | null }) =>
        useStableThreadId(urlSessionId, { initialSessionId: "resumed-sess-abc" }),
      { initialProps: { urlSessionId: null as string | null } },
    );
    expect(result.current).toBe("resumed-sess-abc");

    // URL writeback sets ?session=resumed-sess-abc — threadId must NOT change.
    rerender({ urlSessionId: "resumed-sess-abc" });
    expect(result.current).toBe("resumed-sess-abc");
  });

  it("prefers urlSessionId over initialSessionId when URL already has a session", () => {
    const { result } = renderHook(() =>
      useStableThreadId("url-session-xyz", { initialSessionId: "resumed-sess-abc" }),
    );
    expect(result.current).toBe("url-session-xyz");
  });

  it("mints a fresh UUID when initialSessionId is absent and URL has no session", () => {
    const { result } = renderHook(() => useStableThreadId(null));
    expect(result.current).toMatch(/^mock-uuid-\d+$/);
  });
});
