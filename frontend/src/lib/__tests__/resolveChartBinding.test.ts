import { describe, expect, it } from "vitest";

import { axisLabel, resolveChartBinding } from "../resolveChartBinding";
import type { TableElement } from "@/lib/elementTypes";

const TABLE: TableElement = {
  id: "t1",
  title: "Faldforsøg",
  columns: [
    { id: "h", label: "højde", unit: "m", kind: "number" },
    { id: "t", label: "tid", unit: "s", kind: "number" },
    { id: "v", label: "hastighed", unit: "m/s", kind: "number" },
    { id: "note", label: "noter", kind: "text" },
  ],
  rows: 5,
};

/**
 * 1.1.64 — the fallback ladder.
 *
 * 1.1.38 declined per-column selection to avoid "fragile column-id coupling
 * between the chart and table at author time". The coupling is now here, and
 * the risk is answered rather than avoided: a dangling reference degrades
 * LOUDLY (auto-bind plus a visible note), never into the silent plotting of the
 * wrong variables.
 */
describe("resolveChartBinding", () => {
  it("plots the explicitly bound columns", () => {
    const r = resolveChartBinding({ tableId: "t1", xColumn: "t", yColumn: "v" }, [TABLE]);
    expect(r?.x.id).toBe("t");
    expect(r?.y.id).toBe("v");
    expect(r?.note).toBeUndefined();
  });

  it("lets two charts plot different variable pairs off one table", () => {
    // Aswin's actual ask — several graphs, different variables.
    const a = resolveChartBinding({ tableId: "t1", xColumn: "t", yColumn: "h" }, [TABLE]);
    const b = resolveChartBinding({ tableId: "t1", xColumn: "t", yColumn: "v" }, [TABLE]);
    expect([a?.x.id, a?.y.id]).toEqual(["t", "h"]);
    expect([b?.x.id, b?.y.id]).toEqual(["t", "v"]);
  });

  it("auto-binds an unbound chart to the first two NUMERIC columns", () => {
    // The 1.1.38 path. No note — this is not a degradation.
    const r = resolveChartBinding({}, [TABLE]);
    expect([r?.x.id, r?.y.id]).toEqual(["h", "t"]);
    expect(r?.note).toBeUndefined();
  });

  it("falls back WITH A NOTE when a bound column no longer exists", () => {
    const r = resolveChartBinding({ tableId: "t1", xColumn: "gone", yColumn: "h" }, [TABLE]);
    expect(r).not.toBeNull();
    expect(r?.note).toMatch(/findes ikke længere/);
    // Fell back to auto-bind rather than plotting something arbitrary.
    expect([r?.x.id, r?.y.id]).toEqual(["h", "t"]);
  });

  it("falls back WITH A NOTE when the bound table no longer exists", () => {
    const r = resolveChartBinding({ tableId: "gone", xColumn: "t", yColumn: "h" }, [TABLE]);
    expect(r?.note).toMatch(/Tabellen findes ikke længere/);
  });

  it("never silently plots the wrong variables", () => {
    // The property that matters: any resolution that is NOT what was asked for
    // must carry a note.
    const r = resolveChartBinding({ tableId: "t1", xColumn: "gone", yColumn: "h" }, [TABLE]);
    const askedFor = r?.x.id === "gone" && r?.y.id === "h";
    expect(askedFor || !!r?.note).toBe(true);
  });

  it("returns null when there is no table at all", () => {
    expect(resolveChartBinding({ tableId: "t1", xColumn: "t", yColumn: "h" }, [])).toBeNull();
  });

  it("returns null when the table has fewer than two numeric columns", () => {
    const thin: TableElement = {
      id: "t1",
      title: "Thin",
      columns: [
        { id: "a", label: "A", kind: "number" },
        { id: "n", label: "N", kind: "text" },
      ],
      rows: 3,
    };
    expect(resolveChartBinding({}, [thin])).toBeNull();
  });

  it("treats a column with no explicit kind as numeric (legacy rows)", () => {
    const legacy: TableElement = {
      id: "t1",
      title: "Legacy",
      columns: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      rows: 3,
    } as TableElement;
    expect(resolveChartBinding({}, [legacy])?.x.id).toBe("a");
  });

  it("never resolves a text column onto an axis", () => {
    const r = resolveChartBinding({ tableId: "t1", xColumn: "note", yColumn: "h" }, [TABLE]);
    expect(r?.x.id).not.toBe("note");
    expect(r?.note).toBeTruthy();
  });
});

describe("axisLabel", () => {
  it("appends the unit", () => {
    expect(axisLabel({ id: "t", label: "tid", unit: "s", kind: "number" })).toBe("tid (s)");
  });

  it("omits empty units cleanly", () => {
    expect(axisLabel({ id: "n", label: "antal", kind: "number" })).toBe("antal");
  });
});
