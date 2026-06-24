import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const reportDocumentEvent = vi.fn();
vi.mock("@/lib/documentApi", () => ({
  reportDocumentEvent: (...a: unknown[]) => reportDocumentEvent(...a),
}));

import { useDocInteractionReporting } from "../useDocInteractionReporting";

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

function setSelection(text: string) {
  // jsdom getSelection().toString() — stub it for the test.
  vi.spyOn(window, "getSelection").mockReturnValue({
    toString: () => text,
  } as unknown as Selection);
}

describe("useDocInteractionReporting (1.1.45 M5 — research telemetry, not to AI)", () => {
  it("reports document.copy with the copied char count (not the text)", () => {
    setSelection("F = m a");
    const { result } = renderHook(() => useDocInteractionReporting("sess-1", "d1"));
    act(() => result.current.onCopy());
    expect(reportDocumentEvent).toHaveBeenCalledWith("sess-1", {
      kind: "document.copy",
      docId: "d1",
      detail: { chars: 7 },
    });
  });

  it("reports document.select only when something is selected", () => {
    setSelection("");
    const { result } = renderHook(() => useDocInteractionReporting("sess-1", "d1"));
    act(() => result.current.onMouseUp());
    expect(reportDocumentEvent).not.toHaveBeenCalled();

    setSelection("a passage");
    act(() => result.current.onMouseUp());
    expect(reportDocumentEvent).toHaveBeenCalledWith("sess-1", {
      kind: "document.select",
      docId: "d1",
      detail: { chars: 9 },
    });
  });

  it("debounces scroll into a single settled event with a percent", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDocInteractionReporting("sess-1", "d1"));
    const target = { scrollTop: 50, scrollHeight: 150, clientHeight: 100 } as HTMLElement;
    act(() => {
      result.current.onScroll({ currentTarget: target } as React.UIEvent<HTMLElement>);
      result.current.onScroll({ currentTarget: target } as React.UIEvent<HTMLElement>);
      result.current.onScroll({ currentTarget: target } as React.UIEvent<HTMLElement>);
    });
    expect(reportDocumentEvent).not.toHaveBeenCalled(); // still debouncing
    act(() => vi.advanceTimersByTime(800));
    expect(reportDocumentEvent).toHaveBeenCalledTimes(1);
    expect(reportDocumentEvent).toHaveBeenCalledWith("sess-1", {
      kind: "document.scroll",
      docId: "d1",
      detail: { percent: 100 }, // 50 / (150-100) = 100%
    });
  });

  it("no-ops without an open doc", () => {
    setSelection("x");
    const { result } = renderHook(() => useDocInteractionReporting("sess-1", null));
    act(() => result.current.onCopy());
    expect(reportDocumentEvent).not.toHaveBeenCalled();
  });
});
