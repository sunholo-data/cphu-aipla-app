import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { useSessionMessages } from "@/hooks/useSessionMessages";

function mockOk(messages: object[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ messages, session_id: "sess-1" }),
  } as Response);
}

function mockOkFull(body: object) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ session_id: "sess-1", ...body }),
  } as Response);
}

function mockError(status = 500) {
  mockFetch.mockResolvedValueOnce({ ok: false, status } as Response);
}

function mock404() {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as Response);
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSessionMessages", () => {
  it("does not fetch when sessionId is null", () => {
    renderHook(() => useSessionMessages(null));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns empty messages when sessionId is null", () => {
    const { result } = renderHook(() => useSessionMessages(null));
    expect(result.current.initialMessages).toEqual([]);
    expect(result.current.isLoadingHistory).toBe(false);
  });

  it("fetches the correct endpoint when sessionId is provided", async () => {
    mockOk([]);

    renderHook(() => useSessionMessages("sess-abc"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/proxy/api/sessions/sess-abc/messages",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it("returns SkillMessage[] on success", async () => {
    mockOk([
      { role: "user", content: "Hello", timestamp: 1714000000 },
      { role: "assistant", content: "Hi!", timestamp: 1714000001 },
    ]);

    const { result } = renderHook(() => useSessionMessages("sess-1"));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
    expect(result.current.initialMessages).toHaveLength(2);
    expect(result.current.initialMessages[0].role).toBe("user");
    expect(result.current.initialMessages[0].content).toBe("Hello");
    expect(result.current.initialMessages[1].role).toBe("assistant");
    // Timestamps must survive — without them every restored bubble rendered at
    // the current time (all identical) instead of when the turn happened.
    expect(result.current.initialMessages[0].timestamp).toBe(1714000000);
    expect(result.current.initialMessages[1].timestamp).toBe(1714000001);
    expect(result.current.historyError).toBeNull();
  });

  it("drops proactive-trigger sentinels ([session_start]) from restored history", async () => {
    mockOk([
      { role: "user", content: "[session_start]", timestamp: 1714000000 },
      { role: "assistant", content: "Hej og velkommen!", timestamp: 1714000001 },
      { role: "user", content: "hi", timestamp: 1714000002 },
    ]);

    const { result } = renderHook(() => useSessionMessages("sess-1"));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
    // The synthetic trigger is filtered — transcript starts at the real greet.
    expect(result.current.initialMessages).toHaveLength(2);
    expect(
      result.current.initialMessages.some((m) => m.content.includes("session_start")),
    ).toBe(false);
    expect(result.current.initialMessages[0].content).toBe("Hej og velkommen!");
  });

  describe("1.1.34 — restored interactions", () => {
    it("defaults initialInteractions to [] and truncated to false", async () => {
      mockOk([{ role: "user", content: "hi", timestamp: 1 }]);
      const { result } = renderHook(() => useSessionMessages("sess-1"));
      await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
      expect(result.current.initialInteractions).toEqual([]);
      expect(result.current.interactionsTruncated).toBe(false);
    });

    it("maps interactions to afterMessageIndex in the restored-history index space", async () => {
      // 3 history messages at t=1,2,3; an interaction at t=2.5 falls AFTER the
      // first two messages (index 2) → renders before the 3rd bubble.
      mockOkFull({
        messages: [
          { role: "user", content: "q1", timestamp: 1 },
          { role: "assistant", content: "a1", timestamp: 2 },
          { role: "assistant", content: "reaction", timestamp: 3 },
        ],
        interactions: [
          { label: "Sendte spoergsmaal med v0=15", timestamp: 2.5, server_id: "boldkast", tool_name: "state" },
        ],
      });
      const { result } = renderHook(() => useSessionMessages("sess-1"));
      await waitFor(() => expect(result.current.initialInteractions).toHaveLength(1));
      const card = result.current.initialInteractions[0];
      expect(card.label).toBe("Sendte spoergsmaal med v0=15");
      expect(card.afterMessageIndex).toBe(2);
      expect(card.status).toBe("confirmed");
      expect(card.restored).toBe(true);
    });

    it("counts only restored messages at/before the interaction (sentinels excluded)", async () => {
      // A [session_start] sentinel is dropped from history; the interaction's
      // index must be computed against the FILTERED messages that render.
      mockOkFull({
        messages: [
          { role: "user", content: "[session_start]", timestamp: 1 },
          { role: "assistant", content: "greet", timestamp: 2 },
        ],
        interactions: [{ label: "x", timestamp: 5, server_id: "boldkast", tool_name: "state" }],
      });
      const { result } = renderHook(() => useSessionMessages("sess-1"));
      await waitFor(() => expect(result.current.initialInteractions).toHaveLength(1));
      // Only 1 message survives filtering (the greet) → index 1, not 2.
      expect(result.current.initialMessages).toHaveLength(1);
      expect(result.current.initialInteractions[0].afterMessageIndex).toBe(1);
    });

    it("surfaces interactions_truncated", async () => {
      mockOkFull({
        messages: [{ role: "user", content: "hi", timestamp: 1 }],
        interactions: [{ label: "x", timestamp: 1, server_id: "boldkast", tool_name: "state" }],
        interactions_truncated: true,
      });
      const { result } = renderHook(() => useSessionMessages("sess-1"));
      await waitFor(() => expect(result.current.interactionsTruncated).toBe(true));
    });
  });

  it("sets historyError on HTTP failure", async () => {
    mockError(500);

    const { result } = renderHook(() => useSessionMessages("sess-1"));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
    expect(result.current.historyError).toContain("starting fresh");
    expect(result.current.initialMessages).toEqual([]);
  });

  it("clears messages when sessionId changes to null", async () => {
    mockOk([{ role: "user", content: "Hi", timestamp: 1 }]);

    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => useSessionMessages(sid),
      { initialProps: { sid: "sess-1" as string | null } },
    );

    await waitFor(() => expect(result.current.initialMessages).toHaveLength(1));

    rerender({ sid: null });
    expect(result.current.initialMessages).toEqual([]);
  });

  it("stranded-session-prevention (1.23) Option 1: 404 sets sessionGone=true and does NOT set historyError", async () => {
    // The hook must distinguish 404 (session truly gone) from 5xx
    // (transient). 404 surfaces as sessionGone so the chat page can
    // auto-redirect to a fresh URL via handleNewSession() instead of
    // letting the user keep typing into a stranded threadId.
    mock404();

    const { result } = renderHook(() => useSessionMessages("sess-gone"));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
    expect(result.current.sessionGone).toBe(true);
    expect(result.current.historyError).toBeNull();
    expect(result.current.initialMessages).toEqual([]);
  });

  it("stranded-session-prevention (1.23) Option 1: 5xx still sets historyError, NOT sessionGone", async () => {
    // Locks the floor: only 404 trips the auto-redirect path. Transient
    // backend errors (500, 502, 503) keep the user on the same threadId
    // with the existing "starting fresh" toast.
    mockError(500);

    const { result } = renderHook(() => useSessionMessages("sess-flake"));

    await waitFor(() => expect(result.current.isLoadingHistory).toBe(false));
    expect(result.current.sessionGone).toBe(false);
    expect(result.current.historyError).toContain("starting fresh");
  });

  it("stranded-session-prevention (1.23) Option 1: sessionGone resets when sessionId changes", async () => {
    // After the chat page reads sessionGone and calls handleNewSession,
    // the URL drops ?session= and the hook gets a new sessionId.
    // sessionGone must reset to false on the new fetch so a future 404
    // on the new id can trip again.
    mock404();
    mockOk([{ role: "user", content: "fresh start", timestamp: 1 }]);

    const { result, rerender } = renderHook(
      ({ sid }: { sid: string | null }) => useSessionMessages(sid),
      { initialProps: { sid: "sess-gone" as string | null } },
    );

    await waitFor(() => expect(result.current.sessionGone).toBe(true));

    rerender({ sid: "sess-fresh" });

    await waitFor(() => expect(result.current.initialMessages).toHaveLength(1));
    expect(result.current.sessionGone).toBe(false);
  });

  it("CHAT-HISTORY-FLICKER: does NOT refetch when the hook re-renders without sessionId changing", async () => {
    // Pairs with the AGUIProvider fix: even if the provider re-renders
    // for unrelated reasons (parent state, token swap that's now
    // non-disruptive), useSessionMessages must NOT refire its GET when
    // sessionId is stable. Pre-fix this case was masked because the
    // PROVIDER itself unmounted the subtree on every token refresh; the
    // hook never got a chance to be the second line of defence. With
    // the provider fix in place, this hook is now load-bearing on its
    // own — pin the contract.
    mockOk([
      { role: "user", content: "stable session message", timestamp: 1 },
    ]);

    const { result, rerender } = renderHook(
      ({ sid }: { sid: string }) => useSessionMessages(sid),
      { initialProps: { sid: "stable-session" } },
    );

    await waitFor(() => expect(result.current.initialMessages).toHaveLength(1));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Re-render with the SAME sessionId — simulates the parent provider
    // re-rendering for unrelated reasons (e.g. token state updating).
    rerender({ sid: "stable-session" });
    rerender({ sid: "stable-session" });
    rerender({ sid: "stable-session" });

    // After three extra renders with stable sid, the fetch count must
    // still be 1. If the lastSessionId.current guard ever regresses,
    // this would fire 4 times and the test fails loudly.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.initialMessages).toHaveLength(1);
  });

  describe("1.1.53 M1 — live refetch on group turn revision", () => {
    it("refetches history when the pulse revision advances (a groupmate's turn committed)", async () => {
      mockOk([{ role: "user", content: "turn 1", timestamp: 1 }]);
      mockOk([
        { role: "user", content: "turn 1", timestamp: 1 },
        { role: "assistant", content: "turn 2 (from groupmate)", timestamp: 2 },
      ]);

      const { result, rerender } = renderHook(
        ({ sid, rev }: { sid: string; rev: number }) => useSessionMessages(sid, rev),
        { initialProps: { sid: "sess-1", rev: 0 } },
      );

      await waitFor(() => expect(result.current.initialMessages).toHaveLength(1));
      // The pulse bumps → the watcher refetches and sees the new turn.
      rerender({ sid: "sess-1", rev: 1 });
      await waitFor(() => expect(result.current.initialMessages).toHaveLength(2));
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.current.initialMessages[1].content).toContain("groupmate");
    });

    it("does NOT refetch when the revision is unchanged or resets to 0", async () => {
      mockOk([{ role: "user", content: "x", timestamp: 1 }]);

      const { result, rerender } = renderHook(
        ({ sid, rev }: { sid: string; rev: number }) => useSessionMessages(sid, rev),
        { initialProps: { sid: "sess-1", rev: 2 } },
      );

      await waitFor(() => expect(result.current.initialMessages).toHaveLength(1));
      expect(mockFetch).toHaveBeenCalledTimes(1);

      rerender({ sid: "sess-1", rev: 2 }); // same revision — no refetch
      // Reset to 0 (this device started sending → no longer a pure watcher) must
      // NOT be read as a forward jump.
      rerender({ sid: "sess-1", rev: 0 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  it("D4 (chat-history-deep-fixes H4): refetches when sessionId changes from one id to another", async () => {
    // Bug C from chat-history-deep-fixes.md: clicking a thread in
    // DocumentHistoryPanel calls handleSelectSession → navigateToSession,
    // which updates the URL ?session=<new>. useSessionMessages should
    // then fetch the new session's messages. If the hook fails to refetch
    // (or the fetched messages never reach state), the user sees no
    // history when they select a thread.

    // First fetch: session A returns 1 message.
    mockOk([{ role: "user", content: "from session A", timestamp: 1 }]);
    // Second fetch (after rerender): session B returns 3 messages.
    mockOk([
      { role: "user", content: "Q1 in B", timestamp: 1 },
      { role: "assistant", content: "A1 in B", timestamp: 2 },
      { role: "user", content: "Q2 in B", timestamp: 3 },
    ]);

    const { result, rerender } = renderHook(
      ({ sid }: { sid: string }) => useSessionMessages(sid),
      { initialProps: { sid: "session-A" } },
    );

    await waitFor(() => expect(result.current.initialMessages).toHaveLength(1));
    expect(result.current.initialMessages[0].content).toBe("from session A");

    // Simulate user clicking a thread that points at session-B.
    rerender({ sid: "session-B" });

    // The hook MUST refetch and reflect session-B's messages.
    await waitFor(() => expect(result.current.initialMessages).toHaveLength(3));
    expect(result.current.initialMessages[0].content).toBe("Q1 in B");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe(
      "/api/proxy/api/sessions/session-B/messages",
    );
  });
});
