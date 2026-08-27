/**
 * The plot carries numbers you can read a value off — 1.1.84 M1.
 *
 * Teacher feedback 2026-08-21, items 4 and 7, from two teachers and two
 * different activities. Until this shipped, `WorkbenchChart` drew two axis
 * lines and two labels and not one tick, so a student could see the shape of
 * their data and nothing else — in a course whose point is reading quantities
 * off a plot.
 *
 * Rendered assertions rather than pure ones: the tick MATHS is covered in
 * `lib/__tests__/buildAxis.test.ts`, and what these add is that the numbers
 * reach the SVG, that nothing clips, and that a bar chart keeps its zero.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkbenchChart, type ChartElementDef } from "../WorkbenchChart";
import { tableStorageKey, type TableElementDef } from "../WorkbenchTable";

const table = (rows: number): TableElementDef => ({
  id: "t1",
  title: "M",
  columns: [
    { id: "x", label: "Tid", unit: "s", kind: "number" },
    { id: "y", label: "Fart", unit: "m/s", kind: "number" },
  ],
  rows,
});

const CHART: ChartElementDef = { id: "c1", title: "Fart-tid", chartKind: "scatter" };

function seed(pairs: [number, number][]) {
  const values: Record<string, string> = {};
  pairs.forEach(([x, y], r) => {
    values[`t1::${r}::x`] = String(x);
    values[`t1::${r}::y`] = String(y);
  });
  window.sessionStorage.setItem(tableStorageKey("s"), JSON.stringify(values));
}

afterEach(() => window.sessionStorage.clear());

describe("WorkbenchChart — axis ticks", () => {
  it("labels both axes with numbers", () => {
    seed([
      [1, 2],
      [2, 4],
      [3, 6],
    ]);
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[table(3)]} />);
    expect(screen.getAllByTestId("x-tick").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByTestId("y-tick").length).toBeGreaterThanOrEqual(3);
  });

  it("writes the numbers with a Danish decimal comma", () => {
    seed([
      [0, 0],
      [1, 0.5],
    ]);
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[table(2)]} />);
    const labels = screen.getAllByTestId("y-tick").map((n) => n.textContent ?? "");
    expect(labels.some((l) => l.includes(","))).toBe(true);
    expect(labels.every((l) => !l.includes("."))).toBe(true);
  });

  it("never renders float noise as a tick label", () => {
    // 0.1 accumulated ten times is 0.9999999999999999. A tick reading that is
    // the single most obvious way a hand-rolled scale embarrasses itself.
    seed([
      [0, 0],
      [1, 1],
    ]);
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[table(2)]} />);
    for (const n of [...screen.getAllByTestId("x-tick"), ...screen.getAllByTestId("y-tick")]) {
      expect(n.textContent ?? "").not.toMatch(/\d{6,}/);
    }
  });

  it("keeps a wide y label inside the plot area rather than clipping it", () => {
    // PAD_L was a fixed 36. That fits about six characters; a signed small
    // decimal ("-0,0008") is seven and ran off the left edge. Adding ticks
    // without moving the padding would have introduced a NEW defect while
    // fixing item 4 — a number the student can see part of.
    seed([
      [1, -0.0009],
      [2, 0.0009],
    ]);
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[table(2)]} />);
    // Labels are anchored "end", so each extends LEFTWARD from its x. Its left
    // edge must still be inside the viewBox. Asserting x > 0 would pass under
    // the old fixed PAD_L = 36 and prove nothing; this is the assertion that
    // fails if the padding stops tracking the label width.
    const CHAR_W = 4.6; // must match TICK_CHAR_W in the component
    const ticks = screen.getAllByTestId("y-tick");
    expect(Math.max(...ticks.map((n) => (n.textContent ?? "").length))).toBeGreaterThanOrEqual(4);
    for (const n of ticks) {
      const leftEdge = Number(n.getAttribute("x")) - (n.textContent ?? "").length * CHAR_W;
      expect(leftEdge, `"${n.textContent}" is clipped at x=${n.getAttribute("x")}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("anchors a bar chart at zero", () => {
    seed([
      [1, 20],
      [2, 50],
    ]);
    render(
      <WorkbenchChart skillId="s" charts={[{ ...CHART, chartKind: "bar" }]} tables={[table(2)]} />,
    );
    const labels = screen.getAllByTestId("y-tick").map((n) => n.textContent ?? "");
    expect(labels).toContain("0");
  });

  it("still draws ticks for a single reading", () => {
    // The commonest state of a real table mid-lesson: one row filled.
    seed([[3, 7]]);
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[table(3)]} />);
    expect(screen.getAllByTestId("x-tick").length).toBeGreaterThan(1);
    expect(screen.getAllByTestId("y-tick").length).toBeGreaterThan(1);
  });

  it("keeps the axis labels with their units", () => {
    // 1db461f put units on the labels; ticks must not displace them.
    seed([
      [1, 2],
      [2, 4],
    ]);
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[table(2)]} />);
    expect(screen.getByText("Tid (s)")).toBeInTheDocument();
    expect(screen.getByText("Fart (m/s)")).toBeInTheDocument();
  });
});
