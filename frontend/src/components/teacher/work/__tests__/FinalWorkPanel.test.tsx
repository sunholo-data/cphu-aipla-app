import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "@/i18n";

vi.mock("@/lib/teacherApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teacherApi")>("@/lib/teacherApi");
  return { ...actual, fetchActivity: vi.fn(), fetchGroupFinalWork: vi.fn() };
});

import { FinalWorkPanel } from "@/components/teacher/work/FinalWorkPanel";
import { type ActivityPayload, fetchActivity, fetchGroupFinalWork } from "@/lib/teacherApi";

const activitySpy = vi.mocked(fetchActivity);
const workSpy = vi.mocked(fetchGroupFinalWork);

function render(ui: ReactElement) {
  return rtlRender(<LocaleProvider locale="en">{ui}</LocaleProvider>);
}

/** A falling-ball lab: one table (with units), a chart bound to it, a second
 *  table nobody touched, two writing prompts (one empty), a checklist, a photo. */
const ACTIVITY = {
  activityId: "act-ball",
  table: [
    {
      id: "t1",
      title: "Drop readings",
      rows: 5,
      columns: [
        { id: "h", label: "Height", unit: "m", kind: "number" },
        { id: "t", label: "Time", unit: "s", kind: "number" },
      ],
    },
    { id: "t2", title: "Spare table", rows: 3, columns: [{ id: "a", label: "A" }] },
  ],
  chart: [{ id: "c1", title: "Height vs time", chartKind: "scatter", tableId: "t1", xColumn: "t", yColumn: "h" }],
  writing: [
    { id: "w1", title: "Conclusion" },
    { id: "w2", title: "Sources of error" },
  ],
  checklist: [
    { id: "i1", label: "Measure three drops" },
    { id: "i2", label: "Plot the data" },
    { id: "i3", label: "Explain the slope" },
  ],
  solution: [{ id: "s1", prompt: "Photograph your working" }],
} as unknown as ActivityPayload;

beforeEach(() => {
  activitySpy.mockReset();
  workSpy.mockReset();
});

describe("FinalWorkPanel (1.1.136 M2)", () => {
  it("renders the table with units, the re-rendered chart, the full writing and the ticks", async () => {
    activitySpy.mockResolvedValue(ACTIVITY);
    workSpy.mockResolvedValue({
      cells: {
        "t1::0::h": "1.0",
        "t1::0::t": "0.45",
        "t1::1::h": "2.0",
        "t1::1::t": "0.64",
      },
      docs: { w1: { text: "The ball accelerates.\nSo g is about 9.8." }, w2: { text: "   " } },
      itemStates: { i1: { done: true, by: "student" }, i2: { done: true, by: "ai" } },
      nodeStates: {},
    });

    const { container } = render(<FinalWorkPanel activityId="act-ball" groupCode="g-1" classId="cls-1" />);

    expect(await screen.findByText("Drop readings")).toBeInTheDocument();
    // Units in the headers.
    expect(screen.getByText("(m)")).toBeInTheDocument();
    expect(screen.getByText("(s)")).toBeInTheDocument();
    expect(screen.getByText("0.64")).toBeInTheDocument();
    // Trailing empty rows (the teacher's spare capacity) are not the group's work.
    const table = container.querySelector("table")!;
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);

    // The chart, re-rendered from the table with the activity's own binding
    // (x = time, y = height) through the student's SVG.
    expect(screen.getByText("Height vs time")).toBeInTheDocument();
    const svg = screen.getByRole("img", { name: /time.*vs.*height/i });
    expect(svg.querySelectorAll("circle")).toHaveLength(2);

    // The FULL writing, line breaks kept.
    expect(screen.getByText(/The ball accelerates\.\s+So g is about 9\.8\./)).toBeInTheDocument();

    // Checklist: count, each item's state, and who ticked it.
    expect(screen.getByText("Checklist — 2 of 3 ticked")).toBeInTheDocument();
    const items = container.querySelectorAll("li[data-done]");
    expect(Array.from(items).map((li) => li.getAttribute("data-done"))).toEqual(["true", "true", "false"]);
    expect(screen.getByText(/Plot the data \(ticked by the tutor\)/)).toBeInTheDocument();

    // Photos are never shown; the panel says why.
    expect(screen.getByText("Photos shared with the tutor are not kept.")).toBeInTheDocument();
    expect(workSpy).toHaveBeenCalledWith("act-ball", "g-1", "cls-1");
  });

  it("omits empty elements: an untouched table, blank writing, an unticked checklist, a chart with no points", async () => {
    activitySpy.mockResolvedValue(ACTIVITY);
    workSpy.mockResolvedValue({
      cells: { "t1::0::h": "1.0" }, // half a row: a table cell, but no chart point
      docs: { w2: { text: "Reaction time." } },
      itemStates: { i1: { done: false, by: "student" } },
      nodeStates: {},
    });

    render(<FinalWorkPanel activityId="act-ball" groupCode="g-1" />);

    expect(await screen.findByText("Reaction time.")).toBeInTheDocument();
    expect(screen.getByText("Drop readings")).toBeInTheDocument();
    expect(screen.queryByText("Spare table")).not.toBeInTheDocument();
    expect(screen.queryByText("Height vs time")).not.toBeInTheDocument();
    expect(screen.queryByText("Conclusion")).not.toBeInTheDocument();
    expect(screen.queryByText(/ticked/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing saved/)).not.toBeInTheDocument();
  });

  it("says nothing is saved yet when every element is empty", async () => {
    activitySpy.mockResolvedValue(ACTIVITY);
    workSpy.mockResolvedValue({ cells: {}, docs: {}, itemStates: {}, nodeStates: {} });

    render(<FinalWorkPanel activityId="act-ball" groupCode="g-1" />);
    expect(await screen.findByText("Nothing saved in the workbench yet.")).toBeInTheDocument();
  });

  it("says the work could not be read — never 'nothing saved' — when no store answered", async () => {
    activitySpy.mockResolvedValue(ACTIVITY);
    workSpy.mockResolvedValue({ cells: null, docs: null, itemStates: null, nodeStates: null });

    render(<FinalWorkPanel activityId="act-ball" groupCode="g-1" />);
    expect(await screen.findByText(/could not be read — this does NOT mean they did none/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing saved/)).not.toBeInTheDocument();
  });

  it("renders nothing, and reads no work, for an activity without workbench elements", async () => {
    activitySpy.mockResolvedValue({ activityId: "act-chat", note: [{ id: "n", body: "Read this" }] } as unknown as ActivityPayload);

    const { container } = render(<FinalWorkPanel activityId="act-chat" groupCode="g-1" />);
    await waitFor(() => expect(activitySpy).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[data-testid=final-work-panel]")).toBeNull());
    expect(workSpy).not.toHaveBeenCalled();
  });

  it("renders nothing when the activity cannot be read (a legacy skill-keyed activity)", async () => {
    activitySpy.mockRejectedValue(new Error("404"));

    const { container } = render(<FinalWorkPanel activityId="concept-dialogue" groupCode="g-1" />);
    await waitFor(() => expect(container.querySelector("[data-testid=final-work-panel]")).toBeNull());
    expect(workSpy).not.toHaveBeenCalled();
  });
});
