import { act, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";

vi.mock("@/lib/classCompareApi", () => ({
  fetchComparableElements: vi.fn(),
  fetchClassCompare: vi.fn(),
}));
vi.mock("@/lib/apiClient", () => ({ fetchWithTeacherAuth: vi.fn() }));

import { COMPARE_POLL_MS, ClassCompareView } from "@/components/teacher/compare/ClassCompareView";
import { fetchClassCompare, fetchComparableElements, type CompareResult } from "@/lib/classCompareApi";

const pickerSpy = vi.mocked(fetchComparableElements);
const compareSpy = vi.mocked(fetchClassCompare);

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

const TABLE = {
  id: "t1",
  title: "Drop readings",
  rows: 4,
  columns: [
    { id: "t", label: "Time", unit: "s", kind: "number" as const },
    { id: "h", label: "Height", unit: "m", kind: "number" as const },
  ],
};
const CHART = { id: "c1", title: "h vs t", chartKind: "scatter" as const, tableId: "t1", xColumn: "t", yColumn: "h" };

const ACTIVITIES = [
  {
    activityId: "act-ball",
    title: "Falling ball",
    elements: [
      { kind: "table" as const, id: "t1", title: "Drop readings" },
      { kind: "chart" as const, id: "c1", title: "h vs t" },
      { kind: "writing" as const, id: "w1", title: "Conclusion" },
    ],
  },
];

/** Three rows on a line of slope `m`. */
function line(m: number): Record<string, string> {
  return Object.fromEntries(
    [1, 2, 3].flatMap((x, r) => [
      [`t1::${r}::t`, String(x)],
      [`t1::${r}::h`, String(m * x)],
    ]),
  );
}

function result(kind: CompareResult["kind"], groups: CompareResult["groups"]): CompareResult {
  return {
    classId: "cls-1",
    activityId: "act-ball",
    activityTitle: "Falling ball",
    kind,
    elementId: kind === "chart" ? "c1" : "t1",
    elements: kind === "chart" ? { chart: [CHART], table: [TABLE] } : { table: [TABLE] },
    groups,
  };
}

beforeEach(() => {
  pickerSpy.mockReset();
  compareSpy.mockReset();
  pickerSpy.mockResolvedValue(ACTIVITIES);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ClassCompareView (1.1.99 M1)", () => {
  it("shows the element for every group, with an honest empty card", async () => {
    compareSpy.mockResolvedValue(
      result("table", [
        { groupCode: "grp-a", revoked: false, updatedAt: new Date().toISOString(), data: { "t1::0::t": "0.45" } },
        { groupCode: "grp-b", revoked: true, updatedAt: null, data: null },
      ]),
    );
    render(<ClassCompareView classId="cls-1" />);

    const cards = await screen.findAllByTestId("compare-card");
    expect(cards.map((c) => c.getAttribute("data-group"))).toEqual(["grp-a", "grp-b"]);
    expect(screen.getByText("0.45")).toBeInTheDocument();
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByText("Code revoked")).toBeInTheDocument();
    expect(screen.getByText(/^Updated/)).toBeInTheDocument();
    expect(compareSpy).toHaveBeenCalledWith("cls-1", "act-ball", "table", "t1");
  });

  it("a failed read says so — never a grid of empty cards", async () => {
    compareSpy.mockRejectedValue(new Error("503"));
    render(<ClassCompareView classId="cls-1" />);
    expect(await screen.findByText(/does not mean they have done nothing/)).toBeInTheDocument();
    expect(screen.queryByTestId("compare-card")).toBeNull();
  });

  it("switching element re-reads that element", async () => {
    compareSpy.mockResolvedValue(result("table", []));
    render(<ClassCompareView classId="cls-1" />);
    await screen.findByText("This class has no groups yet.");
    fireEvent.change(screen.getByLabelText("Element"), { target: { value: "writing:w1" } });
    await waitFor(() => expect(compareSpy).toHaveBeenLastCalledWith("cls-1", "act-ball", "writing", "w1"));
  });

  it("draws a chart per group and highlights the slope that differs", async () => {
    compareSpy.mockResolvedValue(
      result("chart", [
        { groupCode: "g1", revoked: false, updatedAt: null, data: line(9.8) },
        { groupCode: "g2", revoked: false, updatedAt: null, data: line(9.7) },
        { groupCode: "g3", revoked: false, updatedAt: null, data: line(9.9) },
        { groupCode: "g4", revoked: false, updatedAt: null, data: line(4.9) },
      ]),
    );
    const { container } = render(<ClassCompareView classId="cls-1" />);
    fireEvent.change(await screen.findByLabelText("Element"), { target: { value: "chart:c1" } });

    await waitFor(() => expect(container.querySelectorAll("[data-testid=compare-card] svg")).toHaveLength(4));
    const flagged = screen
      .getAllByTestId("compare-card")
      .filter((c) => c.getAttribute("data-outlier") === "true")
      .map((c) => c.getAttribute("data-group"));
    expect(flagged).toEqual(["g4"]);
    expect(screen.getByText(/worth a look, not a verdict/)).toBeInTheDocument();
  });

  it("polls every 30 seconds and keeps the last read up when a refresh fails", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    compareSpy.mockResolvedValueOnce(
      result("table", [{ groupCode: "grp-a", revoked: false, updatedAt: null, data: { "t1::0::t": "1.5" } }]),
    );
    render(<ClassCompareView classId="cls-1" />);
    expect(await screen.findByText("1.5")).toBeInTheDocument();

    compareSpy.mockRejectedValueOnce(new Error("blip"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPARE_POLL_MS);
    });
    expect(compareSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.getByText(/last refresh failed/)).toBeInTheDocument();
  });

  it("says so when the class has nothing to compare", async () => {
    pickerSpy.mockResolvedValue([]);
    render(<ClassCompareView classId="cls-1" />);
    expect(await screen.findByText(/no activity with a table/)).toBeInTheDocument();
    expect(compareSpy).not.toHaveBeenCalled();
  });
});
