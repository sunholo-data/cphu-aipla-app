import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth-aware fetch so we drive the greet POST directly, with no
// token/SSE plumbing. fetchProactiveGreet calls fetchWithAuth(url, init).
const fetchWithAuth = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
}));

import { useProactiveGreet } from "@/lib/proactiveGreet";

function okGreet(body: { skipped?: boolean; text?: string }) {
  return {
    ok: true,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(body),
  } as Response;
}

/** A promise whose resolution we control, to hold a greet POST "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fetchWithAuth.mockReset();
});

describe("useProactiveGreet — loading lifecycle", () => {
  it("clears loading and surfaces the greet on success", async () => {
    fetchWithAuth.mockResolvedValueOnce(okGreet({ skipped: false, text: "Hej!" }));

    const { result } = renderHook(() =>
      useProactiveGreet({ sessionId: "s1", skillId: "k1", enabled: true }),
    );

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.greetMessage?.content).toBe("Hej!");
  });

  it("does not fire (and is not loading) when disabled", () => {
    const { result } = renderHook(() =>
      useProactiveGreet({ sessionId: "s1", skillId: "k1", enabled: false }),
    );
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  // Regression: the AIPLA activity-chat "stuck thinking on initial start" bug.
  // The per-activity active-session resume (ALS-1) pins ?session= asynchronously
  // while the greet POST is still in flight, flipping `enabled` false mid-flight.
  // Before the fix, the in-flight `.finally` was guarded on the (then `alive`)
  // cleanup flag, so `loading` was left stuck true forever → a permanent
  // "thinking" indicator even though the backend returned the greeting.
  it("clears loading when `enabled` flips false mid-flight (activity-resume race)", async () => {
    const inflight = deferred<Response>();
    fetchWithAuth.mockReturnValueOnce(inflight.promise);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useProactiveGreet({ sessionId: "s1", skillId: "k1", enabled }),
      { initialProps: { enabled: true } },
    );

    // Greet POST is in flight → spinner up.
    expect(result.current.loading).toBe(true);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);

    // ALS-1 writeback pins ?session= → the chat page flips the greet gate off.
    rerender({ enabled: false });

    // The spinner MUST clear. This is the assertion that fails without the fix.
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Settle the orphaned in-flight request; its result must be discarded
    // (belongs to a superseded tuple) and must not re-raise the spinner.
    await act(async () => {
      inflight.resolve(okGreet({ skipped: false, text: "late greeting" }));
      await inflight.promise;
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.greetMessage).toBeNull();
  });
});
