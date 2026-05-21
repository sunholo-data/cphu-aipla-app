import { act, renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HumanToolEventsProvider, useHumanToolEvents } from "../useHumanToolEvents";

const wrapper = ({ children }: { children: ReactNode }) => (
  <HumanToolEventsProvider>{children}</HumanToolEventsProvider>
);

const okResponse = (status = 204) => new Response(null, { status });
const failResponse = (status = 404) => new Response(null, { status });

describe("useHumanToolEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no events", () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    expect(result.current.events).toEqual([]);
  });

  it("appends a pending event synchronously on dispatch", () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({
        label: "Tick a",
        push: () => Promise.resolve(okResponse()),
      });
    });
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].label).toBe("Tick a");
    expect(result.current.events[0].status).toBe("pending");
  });

  it("transitions pending -> confirmed when push resolves with 204", async () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({
        label: "Tick a",
        push: () => Promise.resolve(okResponse()),
      });
    });
    // Wait past the min pending hold + flush microtasks.
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.events[0].status).toBe("confirmed");
    expect(result.current.events[0].httpStatus).toBe(204);
  });

  it("transitions pending -> failed with httpStatus on 4xx", async () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({
        label: "Tick a",
        push: () => Promise.resolve(failResponse(404)),
      });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.events[0].status).toBe("failed");
    expect(result.current.events[0].httpStatus).toBe(404);
  });

  it("transitions pending -> failed with detail when push throws", async () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({
        label: "Tick a",
        push: () => Promise.reject(new Error("offline")),
      });
    });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(result.current.events[0].status).toBe("failed");
    expect(result.current.events[0].detail).toBe("offline");
    expect(result.current.events[0].httpStatus).toBeUndefined();
  });

  it("holds the pending state for at least 200ms even when push resolves instantly", async () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({
        label: "Tick a",
        push: () => Promise.resolve(okResponse()),
      });
    });
    // Flush microtasks but not timers — push has resolved, but the
    // setTimeout(MIN_PENDING_MS) hasn't fired yet.
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.events[0].status).toBe("pending");

    // Advance just past the threshold and confirm the transition.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(210);
    });
    expect(result.current.events[0].status).toBe("confirmed");
  });

  it("supports multiple concurrent dispatches with distinct ids", () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({ label: "a", push: () => Promise.resolve(okResponse()) });
      result.current.dispatch({ label: "b", push: () => Promise.resolve(okResponse()) });
    });
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].id).not.toBe(result.current.events[1].id);
  });

  it("clear() drops all events", () => {
    const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
    act(() => {
      result.current.dispatch({ label: "a", push: () => Promise.resolve(okResponse()) });
      result.current.clear();
    });
    expect(result.current.events).toEqual([]);
  });

  describe("no provider", () => {
    it("returns a no-op dispatch that still runs the push side-effect", async () => {
      const push = vi.fn(() => Promise.resolve(okResponse()));
      const { result } = renderHook(() => useHumanToolEvents());
      act(() => {
        result.current.dispatch({ label: "a", push });
      });
      expect(result.current.events).toEqual([]);
      expect(push).toHaveBeenCalledTimes(1);
    });
  });
});
