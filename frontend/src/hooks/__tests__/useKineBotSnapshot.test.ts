import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const dispatchMock = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({
  useHumanToolEvents: () => ({ events: [], dispatch: dispatchMock, clear: vi.fn() }),
}));

import { useKineBotSnapshot } from "../useKineBotSnapshot";

describe("useKineBotSnapshot", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
  });

  it("starts with an empty snapshot", () => {
    const { result } = renderHook(() => useKineBotSnapshot("sess-1"));
    expect(result.current.snapshot.currentTopic).toBeNull();
    expect(result.current.snapshot.topicsVisited).toEqual([]);
    expect(result.current.snapshot.quizProgress).toEqual([]);
  });

  it("set-topic updates currentTopic + topicsVisited (dedup), silent push", () => {
    const { result } = renderHook(() => useKineBotSnapshot("sess-1"));
    act(() => result.current.reportEvent({ kind: "kinebot.set-topic", topic: "projectile" }));
    act(() => result.current.reportEvent({ kind: "kinebot.set-topic", topic: "projectile" }));
    expect(result.current.snapshot.currentTopic).toBe("projectile");
    expect(result.current.snapshot.topicsVisited).toEqual(["projectile"]);
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(dispatchMock).not.toHaveBeenCalled(); // silent
  });

  it("sim-run updates lastSimRun, silent push (no card)", () => {
    const { result } = renderHook(() => useKineBotSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "kinebot.sim-run",
        simType: "projectile",
        params: { velocity: 20, angle: 45 },
      }),
    );
    expect(result.current.snapshot.lastSimRun).toEqual({
      simType: "projectile",
      params: { velocity: 20, angle: 45 },
    });
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("graph-change updates currentGraph + dispatches a card", () => {
    const { result } = renderHook(() => useKineBotSnapshot("sess-1"));
    act(() => result.current.reportEvent({ kind: "kinebot.graph-change", graphType: "vt" }));
    expect(result.current.snapshot.currentGraph).toBe("vt");
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe("Viewing v-t graph");
  });

  it("quiz-attempt correct: aggregates + dispatches a card", () => {
    const { result } = renderHook(() => useKineBotSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "kinebot.quiz-attempt",
        topic: "freefall",
        questionId: "freefall-q1",
        answeredCorrectly: true,
      }),
    );
    expect(result.current.snapshot.quizProgress).toEqual([
      { topic: "freefall", attempts: 1, correct: 1 },
    ]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe("Quiz: correct on Free Fall");
  });

  it("quiz-attempt incorrect: aggregates, silent (no card)", () => {
    const { result } = renderHook(() => useKineBotSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "kinebot.quiz-attempt",
        topic: "freefall",
        questionId: "freefall-q2",
        answeredCorrectly: false,
      }),
    );
    expect(result.current.snapshot.quizProgress).toEqual([
      { topic: "freefall", attempts: 1, correct: 0 },
    ]);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("does not push when sessionId is null", () => {
    const { result } = renderHook(() => useKineBotSnapshot(null));
    act(() => result.current.reportEvent({ kind: "kinebot.graph-change", graphType: "xt" }));
    expect(fetchWithAuth).not.toHaveBeenCalled();
    // snapshot still updates locally
    expect(result.current.snapshot.currentGraph).toBe("xt");
  });
});
