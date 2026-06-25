import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useArtefactReportEvent } from "../useArtefactReportEvent";

/**
 * Unit coverage for useArtefactReportEvent (sprint SIM-ERGONOMICS M1).
 *
 * The helper is the denylist-shaped replacement for the per-artefact
 * allowlist filters the old bespoke sim frames carried before USR-1
 * unified them onto GenericArtefactFrame. These tests pin the five paths:
 *   1. kind in `drop` → not forwarded
 *   2. kind in `narrow` → narrower called; valid return forwarded
 *   3. kind in `narrow` → narrower returns null → not forwarded
 *   4. kind in neither → forwarded as `{kind}` (default-through path)
 *   5. non-string / empty kind → silently dropped
 *
 * Regression bar: if a future PR re-introduces the allowlist shape
 * (e.g. by making the default-through path a drop), these tests fail.
 */

interface TestEvent {
  kind: string;
  // Optional fields the narrowers may populate
  marker?: string;
  revealed?: boolean;
}

describe("useArtefactReportEvent", () => {
  it("drops kinds present in `drop`", () => {
    const report = vi.fn();
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({
        report,
        drop: new Set(["boldkast.pause", "boldkast.reset"]),
      }),
    );

    result.current({ kind: "boldkast.pause" });
    result.current({ kind: "boldkast.reset" });

    expect(report).not.toHaveBeenCalled();
  });

  it("calls the narrower for kinds in `narrow` and forwards a valid event", () => {
    const report = vi.fn();
    const narrower = vi.fn(
      (data: Record<string, unknown>): TestEvent | null =>
        typeof data.marker === "string" && typeof data.revealed === "boolean"
          ? {
              kind: "boldkast.show_value",
              marker: data.marker,
              revealed: data.revealed,
            }
          : null,
    );
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({
        report,
        narrow: { "boldkast.show_value": narrower },
      }),
    );

    result.current({
      kind: "boldkast.show_value",
      marker: "range",
      revealed: true,
    });

    expect(narrower).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      kind: "boldkast.show_value",
      marker: "range",
      revealed: true,
    });
  });

  it("does not forward when the narrower returns null (failed shape validation)", () => {
    const report = vi.fn();
    const narrower = vi.fn(
      (data: Record<string, unknown>): TestEvent | null =>
        typeof data.marker === "string" && typeof data.revealed === "boolean"
          ? {
              kind: "boldkast.show_value",
              marker: data.marker,
              revealed: data.revealed,
            }
          : null,
    );
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({
        report,
        narrow: { "boldkast.show_value": narrower },
      }),
    );

    // Missing `revealed` — shape validation fails, narrower returns null
    result.current({ kind: "boldkast.show_value", marker: "range" });

    expect(narrower).toHaveBeenCalledTimes(1);
    expect(report).not.toHaveBeenCalled();
  });

  it("forwards `{kind}` for kinds in neither `drop` nor `narrow` (default-through path)", () => {
    // This is the bug-class killer: a kind the author didn't explicitly
    // handle still reaches the snapshot hook. Today's snapshot hooks
    // tolerate unknown kinds (switch falls through); the central
    // useSimSnapshotPush + proactiveEventCheck mapper turns matching
    // tokens into meaningful kinds without per-frame code.
    const report = vi.fn();
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({
        report,
        drop: new Set(["boldkast.pause"]),
        narrow: {
          "boldkast.show_value": () => null,
        },
      }),
    );

    result.current({ kind: "boldkast.play" });
    result.current({ kind: "boldkast.open" });

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenNthCalledWith(1, { kind: "boldkast.play" });
    expect(report).toHaveBeenNthCalledWith(2, { kind: "boldkast.open" });
  });

  it("silently drops events with non-string or empty `kind`", () => {
    const report = vi.fn();
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({ report }),
    );

    result.current({ kind: 42 } as unknown as Record<string, unknown>);
    result.current({ kind: "" });
    result.current({} as Record<string, unknown>);
    result.current({ kind: null } as unknown as Record<string, unknown>);

    expect(report).not.toHaveBeenCalled();
  });

  it("returns a stable callback identity across renders", () => {
    const report = vi.fn();
    const { result, rerender } = renderHook(
      ({ r }: { r: (e: TestEvent) => void }) =>
        useArtefactReportEvent<TestEvent>({ report: r }),
      { initialProps: { r: report } },
    );

    const firstCallback = result.current;
    // Re-render with a fresh report prop — the returned callback must
    // not change identity (would invalidate StaticArtefactFrame's
    // effect deps and re-init the iframe handshake).
    const reportTwo = vi.fn();
    rerender({ r: reportTwo });

    expect(result.current).toBe(firstCallback);

    // But calls now go to the newer report via the internal ref.
    result.current({ kind: "boldkast.open" });
    expect(reportTwo).toHaveBeenCalledWith({ kind: "boldkast.open" });
    expect(report).not.toHaveBeenCalled();
  });

  it("respects drop+narrow precedence — drop wins over narrow", () => {
    // If an author accidentally lists a kind in both, drop wins.
    // (Author intent for `drop` is louder than `narrow`.)
    const report = vi.fn();
    const narrower = vi.fn(() => ({ kind: "boldkast.pause" }) as TestEvent);
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({
        report,
        drop: new Set(["boldkast.pause"]),
        narrow: { "boldkast.pause": narrower },
      }),
    );

    result.current({ kind: "boldkast.pause" });

    expect(narrower).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("works with no `drop` or `narrow` provided — everything default-through", () => {
    const report = vi.fn();
    const { result } = renderHook(() =>
      useArtefactReportEvent<TestEvent>({ report }),
    );

    result.current({ kind: "anything.goes" });
    result.current({ kind: "another.kind" });

    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenNthCalledWith(1, { kind: "anything.goes" });
    expect(report).toHaveBeenNthCalledWith(2, { kind: "another.kind" });
  });
});
