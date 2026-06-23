import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";

import { WorkspaceElements } from "../elementRenderers";

// Repro for the builder-preview report: with no session (sessionId=null, like
// the activity preview), editing the data table should still replot the chart.
// The only trigger in that mode is the TABLE_CHANGE_EVENT the table fires on
// commit — so this guards that path end to end (table input → chart SVG).
const TABLE = [
  {
    id: "table-1",
    title: "",
    columns: [
      { id: "col-1", label: "x", unit: "", kind: "number" as const },
      { id: "col-2", label: "y", unit: "", kind: "number" as const },
    ],
    rows: 2,
  },
];
const CHART = [{ id: "chart-1", title: "", chartKind: "scatter" as const }];

describe("WorkspaceElements — chart replots from table edits (sessionId null)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("updates the plot when the table data changes in preview mode", () => {
    render(
      <WorkspaceElements
        skillId="__activity_preview__"
        sessionId={null}
        checklist={[]}
        table={TABLE}
        chart={CHART}
        calculator={[]}
        note={[]}
      />,
    );

    // Before any data, the chart prompts to fill the table.
    expect(screen.getByText(/Udfyld datatabellen/i)).toBeInTheDocument();

    // Fill two rows of (x, y) — commit each cell on blur.
    const fill = (label: RegExp, value: string) => {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    };
    fill(/x række 1/i, "1");
    fill(/y række 1/i, "2");
    fill(/x række 2/i, "2");
    fill(/y række 2/i, "4");

    // The plot now exists (the prompt is gone, an SVG is rendered).
    expect(screen.queryByText(/Udfyld datatabellen/i)).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});
