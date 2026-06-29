import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useToast } from "@/hooks/useToast";

describe("useToast", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows a message then auto-dismisses after the given duration", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast("hi", 1000));
    expect(result.current.toast).toBe("hi");
    act(() => vi.advanceTimersByTime(999));
    expect(result.current.toast).toBe("hi");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  it("uses the hook's default duration when none is passed", () => {
    const { result } = renderHook(() => useToast(2000));
    act(() => result.current.showToast("x"));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.toast).toBeNull();
  });

  it("a second toast resets the timer (the first's timer can't dismiss it early)", () => {
    const { result } = renderHook(() => useToast());
    act(() => result.current.showToast("first", 1000));
    act(() => vi.advanceTimersByTime(800));
    act(() => result.current.showToast("second", 1000));
    expect(result.current.toast).toBe("second");
    // 800ms more = 1600ms since the first toast; the first timer (1000ms) would
    // have fired by now if it weren't cleared.
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.toast).toBe("second");
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.toast).toBeNull();
  });
});
