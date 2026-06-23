import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkbenchChart, type ChartElementDef } from "../WorkbenchChart";
import { tableStorageKey, type TableElementDef } from "../WorkbenchTable";

const TABLE: TableElementDef = {
  id: "t1",
  title: "M",
  columns: [
    { id: "x", label: "Tid", unit: "s", kind: "number" },
    { id: "y", label: "Fart", unit: "m/s", kind: "number" },
  ],
  rows: 3,
};
const CHART: ChartElementDef = { id: "c1", title: "Fart-tid", chartKind: "scatter" };

afterEach(() => window.sessionStorage.clear());

describe("WorkbenchChart", () => {
  it("hints to fill the table when there is no data yet", () => {
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[TABLE]} />);
    expect(screen.getByText(/udfyld datatabellen/i)).toBeInTheDocument();
  });

  it("hints that a data table is required when none is bound", () => {
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[]} />);
    expect(screen.getByText(/kræver en datatabel/i)).toBeInTheDocument();
  });

  it("plots the first two numeric columns when data is present", () => {
    window.sessionStorage.setItem(
      tableStorageKey("s"),
      JSON.stringify({ "t1::0::x": "1", "t1::0::y": "2", "t1::1::x": "2", "t1::1::y": "4" }),
    );
    render(<WorkbenchChart skillId="s" charts={[CHART]} tables={[TABLE]} />);
    expect(screen.queryByText(/udfyld datatabellen/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /tid.*fart/i })).toBeInTheDocument();
  });
});
