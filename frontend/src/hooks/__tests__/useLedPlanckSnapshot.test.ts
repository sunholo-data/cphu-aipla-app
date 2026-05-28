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

import { useLedPlanckSnapshot } from "../useLedPlanckSnapshot";

describe("useLedPlanckSnapshot", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockClear();
    dispatchMock.mockClear();
  });

  it("starts with an empty snapshot", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    expect(result.current.snapshot.readings).toEqual({});
    expect(result.current.snapshot.fits).toEqual({});
    expect(result.current.snapshot.spectra).toEqual({});
    expect(result.current.snapshot.measurements).toEqual([]);
    expect(result.current.snapshot.calibrated).toBe(false);
  });

  it("reading appends to the per-LED dataset, silent push (no card)", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.reading",
        led: "red",
        I: 0.01,
        U: 1.85,
        Vs: 3.2,
      }),
    );
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.reading",
        led: "red",
        I: 0.02,
        U: 1.95,
        Vs: 3.6,
      }),
    );
    expect(result.current.snapshot.readings.red).toHaveLength(2);
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("auto-run replaces the per-LED dataset, silent push", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    const points = [
      { I: 0.001, U: 1.5, Vs: 2 },
      { I: 0.01, U: 1.9, Vs: 3.3 },
    ];
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.auto-run",
        led: "green",
        points,
      }),
    );
    expect(result.current.snapshot.readings.green).toEqual(points);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("fit records U0 per LED, silent push", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.fit",
        led: "blue",
        u0: 2.64,
      }),
    );
    expect(result.current.snapshot.fits.blue).toBe(2.64);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("spectrum records lambda per LED, silent push", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.spectrum",
        led: "blue",
        lambda: 470,
      }),
    );
    expect(result.current.snapshot.spectra.blue).toBe(470);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("calibrated sets the flag, silent push", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() => result.current.reportEvent({ kind: "led-planck.calibrated" }));
    expect(result.current.snapshot.calibrated).toBe(true);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it("step-change part1 dispatches 'Begyndte I-U-måling'", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.step-change",
        step: 2,
        stepName: "part1",
      }),
    );
    expect(result.current.snapshot.currentStep).toBe(2);
    expect(result.current.snapshot.currentStepName).toBe("part1");
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe("Begyndte I-U-måling");
  });

  it("component-placed correct dispatches a card; incorrect is silent", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.component-placed",
        component: "voltmeter",
        correct: true,
      }),
    );
    expect(result.current.snapshot.componentsPlaced).toEqual(["voltmeter"]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe("Placerede voltmeter");

    act(() =>
      result.current.reportEvent({
        kind: "led-planck.component-placed",
        component: "ammeter",
        correct: false,
      }),
    );
    // Incorrect placement: silent push, no new card, not added to list.
    expect(result.current.snapshot.componentsPlaced).toEqual(["voltmeter"]);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).toHaveBeenCalledTimes(2);
  });

  it("led-polarity-error dispatches 'Forsøgte LED med omvendt polaritet'", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({ kind: "led-planck.led-polarity-error" }),
    );
    expect(result.current.snapshot.lastPolarityError).not.toBeNull();
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock.mock.calls[0][0].label).toBe(
      "Forsøgte LED med omvendt polaritet",
    );
  });

  it("measurement dispatches a card and dedupes by LED color (newest wins)", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot("sess-1"));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.measurement",
        data: { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 },
      }),
    );
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.measurement",
        data: { led: "red", u0: 2.01, lambda: 625, h_computed: 6.7e-34 },
      }),
    );
    expect(result.current.snapshot.measurements).toHaveLength(1);
    expect(result.current.snapshot.measurements[0].u0).toBe(2.01);
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[0][0].label).toBe("Målte U₀ for rød LED");
  });

  it("does not push when sessionId is null but still updates locally", () => {
    const { result } = renderHook(() => useLedPlanckSnapshot(null));
    act(() =>
      result.current.reportEvent({
        kind: "led-planck.fit",
        led: "red",
        u0: 1.8,
      }),
    );
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(result.current.snapshot.fits.red).toBe(1.8);
  });
});
