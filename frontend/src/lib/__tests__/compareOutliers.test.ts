import { describe, expect, it } from "vitest";

import { fittedSlope, slopeOutliers } from "@/lib/compareOutliers";

describe("fittedSlope (1.1.99 M1)", () => {
  it("fits a least-squares line", () => {
    expect(fittedSlope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }])).toBeCloseTo(2);
  });

  it("is undefined for fewer than two points or no x spread", () => {
    expect(fittedSlope([])).toBeNull();
    expect(fittedSlope([{ x: 1, y: 1 }])).toBeNull();
    expect(fittedSlope([{ x: 1, y: 1 }, { x: 1, y: 4 }])).toBeNull();
  });
});

describe("slopeOutliers", () => {
  it("flags a slope far from the class median, and one of the opposite sign", () => {
    const { median, outliers } = slopeOutliers({ a: 9.7, b: 9.9, c: 9.8, d: 4.9, e: -9.8, f: null });
    expect(median).toBeCloseTo(9.7);
    expect([...outliers].sort()).toEqual(["d", "e"]);
  });

  it("flags nobody with fewer than three fitted groups", () => {
    expect(slopeOutliers({ a: 1, b: 100, c: null }).outliers.size).toBe(0);
  });

  it("does not guess around a zero median", () => {
    expect(slopeOutliers({ a: 0, b: 0, c: 5 }).outliers.size).toBe(0);
  });
});
