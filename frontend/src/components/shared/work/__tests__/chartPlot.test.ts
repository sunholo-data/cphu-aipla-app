import { describe, expect, it } from "vitest";

import { parseCellNumber, plotFromCells } from "@/components/shared/work/chartPlot";
import type { ResolvedChartBinding } from "@/lib/resolveChartBinding";

describe("parseCellNumber — decimal conventions (29 Sep)", () => {
  it.each([
    ["3,42", 3.42],
    ["3.42", 3.42],
    ["-0,5", -0.5],
    ["-0.5", -0.5],
    ["−0,5", -0.5], // typographic minus
    ["  9,81 ", 9.81],
    ["\t12\n", 12],
    ["0", 0],
    [",5", 0.5],
    ["1e-3", 0.001],
    ["1 234,5", 1234.5],
    ["1 234 567", 1234567],
    ["-12 345.25", -12345.25],
    // A comma is a decimal separator — never guessed to be a thousands group.
    ["1,234", 1.234],
  ])("%j → %d", (raw, expected) => {
    expect(parseCellNumber(raw)).toBeCloseTo(expected, 10);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12abc", // parseFloat read this as 12
    "3 m",
    "3,4,5",
    "1.234,5", // mixed separators: ambiguous
    "1,234.5",
    "12 34", // not a group of three
    "-",
    ",",
    "NaN",
    "Infinity",
  ])("%j stays non-numeric", (raw) => {
    expect(Number.isNaN(parseCellNumber(raw))).toBe(true);
  });

  it("treats a missing cell as non-numeric", () => {
    expect(Number.isNaN(parseCellNumber(undefined))).toBe(true);
    expect(Number.isNaN(parseCellNumber(null))).toBe(true);
  });
});

describe("plotFromCells", () => {
  const binding: ResolvedChartBinding = {
    table: {
      id: "t",
      rows: 4,
      columns: [
        { id: "x", label: "t", unit: "s" },
        { id: "y", label: "h", unit: "m" },
      ],
    },
    x: { id: "x", label: "t", unit: "s" },
    y: { id: "y", label: "h", unit: "m" },
  };

  it("plots Danish-comma readings at their real value, and skips non-numeric rows", () => {
    const plot = plotFromCells(binding, {
      "t::0::x": "0,45",
      "t::0::y": "1,0",
      "t::1::x": "0.64",
      "t::1::y": "2.0",
      "t::2::x": "abc",
      "t::2::y": "3",
      "t::3::x": "0,78",
    });
    expect(plot.points).toEqual([
      { x: 0.45, y: 1 },
      { x: 0.64, y: 2 },
    ]);
  });
});
