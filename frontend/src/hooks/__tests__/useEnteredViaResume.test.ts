import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useEnteredViaResume } from "@/hooks/useEnteredViaResume";

describe("useEnteredViaResume — resume detection for history rendering", () => {
  it("is a resume when a session is already in the URL at mount", () => {
    const { result } = renderHook(() => useEnteredViaResume("sess-1", 0));
    expect(result.current[0]).toBe(true);
  });

  it("is NOT a resume for a fresh chat (no session, no live turns) at mount", () => {
    const { result } = renderHook(() => useEnteredViaResume(null, 0));
    expect(result.current[0]).toBe(false);
  });

  it("PROMOTES to resume when the session is adopted async with no live turn (the reload bug)", async () => {
    // Mount with no session (anon-group: searchParams/active-session resolve a
    // tick later), no live messages — exactly the reload case where history
    // was previously dropped.
    const { result, rerender } = renderHook(
      ({ sid, n }: { sid: string | null; n: number }) =>
        useEnteredViaResume(sid, n),
      { initialProps: { sid: null as string | null, n: 0 } },
    );
    expect(result.current[0]).toBe(false);

    // The active-session fetch writes ?session= → sessionId resolves, still no
    // live turn this mount.
    rerender({ sid: "sess-1", n: 0 });
    await waitFor(() => expect(result.current[0]).toBe(true));
  });

  it("does NOT flip to resume on the fresh-chat URL-writeback (session arrives AFTER a live turn)", async () => {
    // Fresh chat: greet + first turn produce live messages BEFORE the URL gets
    // ?session= written back. Flipping here would duplicate the on-screen
    // bubbles, so it must stay false.
    const { result, rerender } = renderHook(
      ({ sid, n }: { sid: string | null; n: number }) =>
        useEnteredViaResume(sid, n),
      { initialProps: { sid: null as string | null, n: 0 } },
    );
    // Live turn lands first.
    rerender({ sid: null, n: 2 });
    // Then the writeback sets the session id.
    rerender({ sid: "sess-1", n: 2 });
    // Give the effect a chance to (incorrectly) run.
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current[0]).toBe(false);
  });

  it("honours explicit navigation via the setter (select-thread / new-conversation)", () => {
    const { result } = renderHook(() => useEnteredViaResume(null, 0));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true)); // clicked an existing thread
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false)); // "+ New conversation"
    expect(result.current[0]).toBe(false);
  });
});
