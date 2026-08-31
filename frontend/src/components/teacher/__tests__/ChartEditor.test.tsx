import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChartEditor } from "../ChartEditor";
import type { TableEditorValue } from "../TableEditor";

/**
 * 1.1.64 — ChartEditor became a LIST editor with axis pickers.
 *
 * Aswin, 2026-08-06: "option to add more than one chart … students can draw
 * multiple graphs with different variables." The backend already allowed five
 * charts and the renderer already took an array; this editor was the singleton,
 * and a chart auto-plotted the first two numeric columns — so five charts were
 * the same graph five times. The axis pickers are the actual feature.
 */
const TABLE: TableEditorValue = {
  key: 10,
  title: "Faldforsøg",
  rows: 5,
  columns: [
    { key: 1, label: "højde", unit: "m", kind: "number" },
    { key: 2, label: "tid", unit: "s", kind: "number" },
    { key: 3, label: "noter", unit: "", kind: "text" },
  ],
};

/** 1.1.71 — a second table, with its own columns, to bind charts against. */
const TABLE_2: TableEditorValue = {
  key: 20,
  title: "Kast",
  rows: 5,
  columns: [
    { key: 4, label: "vinkel", unit: "°", kind: "number" },
    { key: 5, label: "længde", unit: "m", kind: "number" },
  ],
};

describe("ChartEditor", () => {
  it("adds a chart, defaulting to the first two numeric columns", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={[]} onChange={onChange} tables={[TABLE]} />);
    fireEvent.click(screen.getByRole("button", { name: /tilføj graf/i }));
    // Defaults match what auto-bind would have chosen, so adding a chart and
    // changing nothing behaves exactly as it did before axis pickers existed.
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ chartKind: "scatter", xColumn: "col-k1", yColumn: "col-k2" }),
    ]);
  });

  it("keeps existing charts when adding another", () => {
    const onChange = vi.fn();
    render(
      <ChartEditor value={[{ id: "chart-1", title: "First", chartKind: "line" }]} onChange={onChange} tables={[TABLE]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /tilføj graf/i }));
    expect(onChange.mock.calls[0][0]).toHaveLength(2);
    expect(onChange.mock.calls[0][0][0].title).toBe("First");
  });

  it("lets each chart plot a different variable pair", () => {
    const onChange = vi.fn();
    render(
      <ChartEditor
        value={[
          { id: "chart-1", title: "A", chartKind: "scatter", xColumn: "col-k1", yColumn: "col-k2" },
          { id: "chart-2", title: "B", chartKind: "line", xColumn: "col-k1", yColumn: "col-k2" },
        ]}
        onChange={onChange}
        tables={[TABLE]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/y-akse for graf 2/i), { target: { value: "col-k1" } });
    expect(onChange.mock.calls[0][0][1].yColumn).toBe("col-k1");
    expect(onChange.mock.calls[0][0][0].yColumn).toBe("col-k2");
  });

  it("offers ONLY numeric columns on an axis", () => {
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={vi.fn()} tables={[TABLE]} />);
    const options = Array.from(screen.getByLabelText(/x-akse/i).querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["højde (m)", "tid (s)"]);
    expect(options).not.toContain("noter");
  });

  it("changes the chart type", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={onChange} tables={[TABLE]} />);
    fireEvent.change(screen.getByLabelText(/graftype for graf 1/i), { target: { value: "line" } });
    expect(onChange.mock.calls[0][0][0].chartKind).toBe("line");
  });

  it("removes one chart without disturbing the others", () => {
    const onChange = vi.fn();
    render(
      <ChartEditor
        value={[
          { id: "c1", title: "Keep", chartKind: "scatter" },
          { id: "c2", title: "Drop", chartKind: "bar" },
        ]}
        onChange={onChange}
        tables={[TABLE]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /fjern graf 2/i }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ title: "Keep" })]);
  });

  it("disables Add at the cap WITH a reason rather than silently refusing", () => {
    const charts = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      title: "",
      chartKind: "scatter" as const,
    }));
    render(<ChartEditor value={charts} onChange={vi.fn()} tables={[TABLE]} />);
    expect(screen.getByRole("button", { name: /tilføj graf/i })).toBeDisabled();
    expect(screen.getByText(/højst 5 grafer/i)).toBeInTheDocument();
  });

  it("explains that axes need a table with two numeric columns", () => {
    const thin: TableEditorValue = {
      key: 30,
      title: "T",
      rows: 3,
      columns: [{ key: 1, label: "a", unit: "", kind: "number" }],
    };
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={vi.fn()} tables={[thin]} />);
    expect(screen.getByText(/mindst to talkolonner/i)).toBeInTheDocument();
  });

  it("renders with no table at all rather than crashing", () => {
    render(<ChartEditor value={[]} onChange={vi.fn()} tables={[]} />);
    expect(screen.getByRole("button", { name: /tilføj graf/i })).toBeInTheDocument();
  });

  // --- 1.1.71: charts say WHICH table they plot ----------------------------

  it("shows no table picker when there is only one table", () => {
    // One table should not grow a dropdown that can only say one thing.
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={vi.fn()} tables={[TABLE]} />);
    expect(screen.queryByLabelText(/tabel for graf 1/i)).not.toBeInTheDocument();
  });

  it("shows a table picker once there are two, listing both", () => {
    render(
      <ChartEditor
        value={[{ id: "c1", title: "", chartKind: "scatter" }]}
        onChange={vi.fn()}
        tables={[TABLE, TABLE_2]}
      />,
    );
    const picker = screen.getByLabelText(/tabel for graf 1/i);
    expect(picker).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Faldforsøg" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Kast" })).toBeInTheDocument();
  });

  it("offers the BOUND table's columns on the axes, not the first table's", () => {
    // Before 1.1.71 every chart was bound to a `table-1` constant, so the axis
    // pickers always offered the first table's columns whatever the chart said.
    render(
      <ChartEditor
        value={[{ id: "c1", title: "", chartKind: "scatter", tableId: "table-k20" }]}
        onChange={vi.fn()}
        tables={[TABLE, TABLE_2]}
      />,
    );
    // Scoped to the X select: the same columns also populate Y, so an unscoped
    // query legitimately finds two of each.
    const x = within(screen.getByLabelText(/x-akse for graf 1/i));
    expect(x.getByRole("option", { name: /vinkel/ })).toBeInTheDocument();
    expect(x.queryByRole("option", { name: /højde/ })).not.toBeInTheDocument();
  });

  it("re-pointing a chart to another table re-defaults its axes", () => {
    // The old column ids belong to the old table. Carrying them across would
    // either dangle or, worse, resolve against a same-positioned column on the
    // new table and silently plot the wrong variable.
    const onChange = vi.fn();
    render(
      <ChartEditor
        value={[{ id: "c1", title: "", chartKind: "scatter", tableId: "table-k10", xColumn: "col-k1", yColumn: "col-k2" }]}
        onChange={onChange}
        tables={[TABLE, TABLE_2]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/tabel for graf 1/i), { target: { value: "table-k20" } });
    const next = onChange.mock.calls[0][0][0];
    expect(next.tableId).toBe("table-k20");
    expect(next.xColumn).toBe("col-k4");
    expect(next.yColumn).toBe("col-k5");
  });

  it("falls back to the first table when a chart's table was deleted", () => {
    // Graceful degradation, matching resolveChartBinding's render-side ladder:
    // a dangling binding renders the first table with a visible note rather
    // than refusing to draw.
    render(
      <ChartEditor
        value={[{ id: "c1", title: "", chartKind: "scatter", tableId: "table-kGONE" }]}
        onChange={vi.fn()}
        tables={[TABLE]}
      />,
    );
    const x = within(screen.getByLabelText(/x-akse for graf 1/i));
    expect(x.getByRole("option", { name: /højde/ })).toBeInTheDocument();
  });
});
