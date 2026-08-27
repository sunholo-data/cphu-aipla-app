/**
 * Axis ticks — 1.1.84 M1.
 *
 * Teacher feedback 2026-08-21, items 4 and 7, reported independently from two
 * different activities: *"We miss numbers and divisions on the axes"* and
 * *"we miss axis division in the point plot that appears when entering data"*.
 * `WorkbenchChart` drew two axis lines, two labels, and not one tick.
 *
 * The degenerate cases carry most of these tests, because a student's table is
 * half-filled far more often than it is complete, and a hand-rolled scale fails
 * on those silently: NaN in an SVG path drops the series with no error.
 */

import { describe, expect, it } from "vitest";

import { buildAxis, formatTick } from "../resolveChartBinding";

const step = (a: { ticks: number[] }) => a.ticks[1] - a.ticks[0];

describe("buildAxis — ordinary ranges", () => {
  it("covers the data and lands on round numbers", () => {
    const axis = buildAxis(2.1, 9.8);
    expect(axis.min).toBeLessThanOrEqual(2.1);
    expect(axis.max).toBeGreaterThanOrEqual(9.8);
    for (const t of axis.ticks) expect(Number.isFinite(t)).toBe(true);
    // every tick a multiple of the step, i.e. no 0.30000000000000004
    for (const t of axis.ticks) expect(Math.abs(t / step(axis) - Math.round(t / step(axis)))).toBeLessThan(1e-9);
  });

  it("produces a human number of ticks, not one and not twenty", () => {
    for (const [lo, hi] of [
      [0, 1],
      [0, 10],
      [2.1, 9.8],
      [-5, 5],
      [0, 0.004],
      [1000, 9000],
    ] as const) {
      const n = buildAxis(lo, hi).ticks.length;
      expect(n, `range ${lo}..${hi}`).toBeGreaterThanOrEqual(3);
      expect(n, `range ${lo}..${hi}`).toBeLessThanOrEqual(12);
    }
  });

  it("ticks ascend and span the domain exactly", () => {
    const axis = buildAxis(3, 47);
    expect(axis.ticks[0]).toBe(axis.min);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max);
    for (let i = 1; i < axis.ticks.length; i++) expect(axis.ticks[i]).toBeGreaterThan(axis.ticks[i - 1]);
  });
});

describe("buildAxis — the cases a half-filled table produces", () => {
  it("a single reading still gets a readable window around it", () => {
    const axis = buildAxis(5, 5);
    expect(axis.min).toBeLessThan(5);
    expect(axis.max).toBeGreaterThan(5);
    expect(axis.ticks.length).toBeGreaterThan(1);
  });

  it("all-zero data does not collapse to a zero-width axis", () => {
    const axis = buildAxis(0, 0);
    expect(axis.max).toBeGreaterThan(axis.min);
    expect(axis.ticks.every(Number.isFinite)).toBe(true);
  });

  it("non-finite input falls back rather than propagating NaN into the path", () => {
    for (const axis of [buildAxis(NaN, NaN), buildAxis(NaN, 5), buildAxis(-Infinity, Infinity)]) {
      expect(axis.ticks.length).toBeGreaterThan(0);
      expect(axis.ticks.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(axis.min)).toBe(true);
      expect(Number.isFinite(axis.max)).toBe(true);
    }
  });

  it("reversed bounds are tolerated", () => {
    const axis = buildAxis(9, 1);
    expect(axis.min).toBeLessThan(axis.max);
  });

  it("handles negative and zero-spanning ranges", () => {
    const axis = buildAxis(-3.2, 4.7);
    expect(axis.min).toBeLessThanOrEqual(-3.2);
    expect(axis.max).toBeGreaterThanOrEqual(4.7);
    expect(axis.ticks).toContain(0);
  });

  it("handles very small and very large magnitudes", () => {
    for (const [lo, hi] of [
      [0.0001, 0.0009],
      [1e6, 9e6],
    ] as const) {
      const axis = buildAxis(lo, hi);
      expect(axis.min).toBeLessThanOrEqual(lo);
      expect(axis.max).toBeGreaterThanOrEqual(hi);
      expect(axis.ticks.every(Number.isFinite)).toBe(true);
    }
  });
});

describe("buildAxis — includeZero", () => {
  it("puts the origin on the plot when asked", () => {
    // Item 5: "we wish the starting point was visible in the window from the
    // beginning". A bar chart always needs it — a bar from a floating baseline
    // misstates its own length.
    const axis = buildAxis(20, 50, 5, { includeZero: true });
    expect(axis.min).toBeLessThanOrEqual(0);
  });

  it("leaves the domain alone when not asked", () => {
    const axis = buildAxis(20, 50);
    expect(axis.min).toBeGreaterThan(0);
  });
});

describe("formatTick — Danish decimals", () => {
  it("uses a comma, because the tutor is instructed to", () => {
    // An axis reading 0.25 beside a tutor writing 0,25 is the inconsistency
    // item 18 objected to.
    expect(formatTick(0.25, 0.25)).toBe("0,25");
    expect(formatTick(9.82, 0.01)).toBe("9,82");
  });

  it("carries no more precision than the step", () => {
    expect(formatTick(4, 1)).toBe("4");
    expect(formatTick(1000, 500)).toBe("1000");
    expect(formatTick(0.5, 0.5)).toBe("0,5");
  });

  it("never renders negative zero", () => {
    expect(formatTick(-0, 1)).toBe("0");
  });

  it("formats every tick of a real axis without producing float noise", () => {
    const axis = buildAxis(0, 1);
    const labels = axis.ticks.map((t) => formatTick(t, step(axis)));
    for (const l of labels) expect(l).not.toMatch(/\d{6,}/);
  });
});
