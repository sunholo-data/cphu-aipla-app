import { act, renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HumanToolEventsProvider,
  _resetNoProviderWarnedForTests,
  useHumanToolEvents,
  useSyncMessageCount,
} from "../useHumanToolEvents";

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

  describe("seed (1.1.34 — restore)", () => {
    const restored = (id: string, afterMessageIndex: number) => ({
      id,
      label: `restored ${id}`,
      status: "pending" as const, // deliberately wrong — seed must force confirmed
      t: 1,
      afterMessageIndex,
      restored: true,
    });

    it("loads restored cards as read-only confirmed", () => {
      const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
      act(() => {
        result.current.seed([restored("a", 0), restored("b", 1)]);
      });
      expect(result.current.events).toHaveLength(2);
      expect(result.current.events.every((e) => e.status === "confirmed")).toBe(true);
      expect(result.current.events.every((e) => e.restored)).toBe(true);
    });

    it("is idempotent — re-seeding replaces the prior restored set", () => {
      const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
      act(() => result.current.seed([restored("a", 0), restored("b", 1)]));
      act(() => result.current.seed([restored("c", 0)]));
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0].id).toBe("c");
    });

    it("keeps live dispatches when seeding (no collision)", () => {
      const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
      act(() => {
        result.current.dispatch({ label: "live", push: () => Promise.resolve(okResponse()) });
      });
      act(() => result.current.seed([restored("a", 0)]));
      // both the live card and the restored card coexist
      expect(result.current.events).toHaveLength(2);
      expect(result.current.events.some((e) => e.label === "live" && !e.restored)).toBe(true);
      expect(result.current.events.some((e) => e.id === "a" && e.restored)).toBe(true);
    });

    it("a live dispatch AFTER seeding does not clear restored cards", () => {
      const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
      act(() => result.current.seed([restored("a", 0)]));
      act(() => {
        result.current.dispatch({ label: "live", push: () => Promise.resolve(okResponse()) });
      });
      expect(result.current.events.some((e) => e.id === "a" && e.restored)).toBe(true);
      expect(result.current.events.some((e) => e.label === "live")).toBe(true);
    });
  });

  describe("useSyncMessageCount", () => {
    // Regression for 2026-06-01: when the provider was moved inside the
    // component that owns useSkillAgent so it could read messages.length
    // as a prop, all snapshot hooks called at that component's top level
    // (useBoldkastSnapshot, useLedPlanckSnapshot, useKineBotSnapshot)
    // fell outside the provider subtree and got the no-op fallback —
    // POSTs still went out, but no cards rendered. useSyncMessageCount
    // exists so the provider can sit ABOVE that component (keeping all
    // snapshot hooks inside its subtree) while still tracking the
    // current message count.
    it("updates afterMessageIndex on the NEXT dispatch", async () => {
      const { result } = renderHook(
        () => {
          useSyncMessageCount(7);
          return useHumanToolEvents();
        },
        { wrapper },
      );
      act(() => {
        result.current.dispatch({
          label: "Tick a",
          push: () => Promise.resolve(okResponse()),
        });
      });
      expect(result.current.events[0].afterMessageIndex).toBe(7);
    });

    it("is a no-op when no provider is mounted", () => {
      // Just shouldn't throw; nothing observable to assert beyond that.
      const { result } = renderHook(() => {
        useSyncMessageCount(3);
        return useHumanToolEvents();
      });
      expect(result.current.events).toEqual([]);
    });
  });

  describe("no provider", () => {
    beforeEach(() => {
      _resetNoProviderWarnedForTests();
    });

    it("returns a no-op dispatch that still runs the push side-effect", async () => {
      const push = vi.fn(() => Promise.resolve(okResponse()));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useHumanToolEvents());
      act(() => {
        result.current.dispatch({ label: "a", push });
      });
      expect(result.current.events).toEqual([]);
      expect(push).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    // Catches the 2026-06-01 class of bug for ALL sims that route through
    // useHumanToolEvents (Boldkast, LED Planck, KineBot, ProgressChecklist,
    // and any future sim). The bug pattern: provider is mounted but sits
    // inside the component whose hooks dispatch — so the React context
    // boundary skips them and useHumanToolEvents() silently returns this
    // no-op fallback. Without this warning the regression is invisible:
    // POSTs succeed (smoke passes), agent sees state, but cards never
    // render in chat.
    it("dispatch() warns ONCE in dev when no provider is mounted", () => {
      const push = vi.fn(() => Promise.resolve(okResponse()));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useHumanToolEvents());
      act(() => {
        result.current.dispatch({ label: "a", push });
        result.current.dispatch({ label: "b", push });
        result.current.dispatch({ label: "c", push });
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/HumanToolEventsProvider/);
      warn.mockRestore();
    });

    it("dispatch() inside a mounted provider does NOT warn", () => {
      const push = vi.fn(() => Promise.resolve(okResponse()));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { result } = renderHook(() => useHumanToolEvents(), { wrapper });
      act(() => {
        result.current.dispatch({ label: "a", push });
      });
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("dispatch() is silent in production builds", () => {
      const push = vi.fn(() => Promise.resolve(okResponse()));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("NODE_ENV", "production");
      const { result } = renderHook(() => useHumanToolEvents());
      act(() => {
        result.current.dispatch({ label: "a", push });
      });
      expect(warn).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
      warn.mockRestore();
    });
  });
});
