import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() =>
    Promise.resolve(new Response(null, { status: 204 })),
  ),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const dispatchMock = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({
  useHumanToolEvents: () => ({
    events: [],
    dispatch: dispatchMock,
    clear: vi.fn(),
  }),
}));

import { useBoldkastSnapshot } from "../useBoldkastSnapshot";

describe("useBoldkastSnapshot", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
  });

  it("starts empty", () => {
    const { result } = renderHook(() => useBoldkastSnapshot("sess-1"));
    expect(result.current.snapshot.v0).toBeNull();
    expect(result.current.snapshot.revealedMarkers).toEqual([]);
  });

  it("open pushes silently (no card)", () => {
    const { result } = renderHook(() => useBoldkastSnapshot("sess-1"));
    act(() => result.current.reportEvent({ kind: "boldkast.open" }));
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("state-change updates v0/theta/g and dispatches an Afspillede card", () => {
    const { result } = renderHook(() => useBoldkastSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "boldkast.state-change",
        changed: ["v0", "theta"],
        state: { v0: 25, theta: 40, g: 9.82 },
        triggeredBy: "play",
      }),
    );
    expect(result.current.snapshot.v0).toBe(25);
    expect(result.current.snapshot.theta).toBe(40);
    expect(result.current.snapshot.g).toBe(9.82);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe(
      "Afspillede med v₀=25 m/s, θ=40°",
    );
  });

  it("chat-submit state-change uses the 'Sendte spørgsmål' verb", () => {
    const { result } = renderHook(() => useBoldkastSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "boldkast.state-change",
        changed: ["g"],
        state: { v0: 10, theta: 30, g: 1.62 },
        triggeredBy: "chat-submit",
      }),
    );
    expect(dispatchMock.mock.calls[0][0].label).toBe(
      "Sendte spørgsmål med g=1.62 m/s²",
    );
  });

  it("show_value reveal adds the marker + card; re-reveal dedupes; un-reveal is silent", () => {
    const { result } = renderHook(() => useBoldkastSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "boldkast.show_value",
        marker: "ymax",
        revealed: true,
      }),
    );
    expect(result.current.snapshot.revealedMarkers).toEqual(["ymax"]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe("Afslørede Maks. højde");

    // Re-reveal: no new card.
    act(() =>
      result.current.reportEvent({
        kind: "boldkast.show_value",
        marker: "ymax",
        revealed: true,
      }),
    );
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    // Un-reveal: removed locally, no push.
    vi.mocked(fetchWithAuth).mockClear();
    act(() =>
      result.current.reportEvent({
        kind: "boldkast.show_value",
        marker: "ymax",
        revealed: false,
      }),
    );
    expect(result.current.snapshot.revealedMarkers).toEqual([]);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("does not push when sessionId is null but still updates locally", () => {
    const { result } = renderHook(() => useBoldkastSnapshot(null));
    act(() =>
      result.current.reportEvent({
        kind: "boldkast.state-change",
        changed: ["v0"],
        state: { v0: 12 },
        triggeredBy: "play",
      }),
    );
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(result.current.snapshot.v0).toBe(12);
  });
});
