import { fireEvent, render, screen } from "@testing-library/react";
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
  title: "Faldforsøg",
  rows: 5,
  columns: [
    { key: 1, label: "højde", unit: "m", kind: "number" },
    { key: 2, label: "tid", unit: "s", kind: "number" },
    { key: 3, label: "noter", unit: "", kind: "text" },
  ],
};

describe("ChartEditor", () => {
  it("adds a chart, defaulting to the first two numeric columns", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={[]} onChange={onChange} table={TABLE} />);
    fireEvent.click(screen.getByRole("button", { name: /tilføj graf/i }));
    // Defaults match what auto-bind would have chosen, so adding a chart and
    // changing nothing behaves exactly as it did before axis pickers existed.
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ chartKind: "scatter", xColumn: "col-1", yColumn: "col-2" }),
    ]);
  });

  it("keeps existing charts when adding another", () => {
    const onChange = vi.fn();
    render(
      <ChartEditor value={[{ id: "chart-1", title: "First", chartKind: "line" }]} onChange={onChange} table={TABLE} />,
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
          { id: "chart-1", title: "A", chartKind: "scatter", xColumn: "col-1", yColumn: "col-2" },
          { id: "chart-2", title: "B", chartKind: "line", xColumn: "col-1", yColumn: "col-2" },
        ]}
        onChange={onChange}
        table={TABLE}
      />,
    );
    fireEvent.change(screen.getByLabelText(/y-akse for graf 2/i), { target: { value: "col-1" } });
    expect(onChange.mock.calls[0][0][1].yColumn).toBe("col-1");
    expect(onChange.mock.calls[0][0][0].yColumn).toBe("col-2");
  });

  it("offers ONLY numeric columns on an axis", () => {
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={vi.fn()} table={TABLE} />);
    const options = Array.from(screen.getByLabelText(/x-akse/i).querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toEqual(["højde (m)", "tid (s)"]);
    expect(options).not.toContain("noter");
  });

  it("changes the chart type", () => {
    const onChange = vi.fn();
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={onChange} table={TABLE} />);
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
        table={TABLE}
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
    render(<ChartEditor value={charts} onChange={vi.fn()} table={TABLE} />);
    expect(screen.getByRole("button", { name: /tilføj graf/i })).toBeDisabled();
    expect(screen.getByText(/højst 5 grafer/i)).toBeInTheDocument();
  });

  it("explains that axes need a table with two numeric columns", () => {
    const thin: TableEditorValue = {
      title: "T",
      rows: 3,
      columns: [{ key: 1, label: "a", unit: "", kind: "number" }],
    };
    render(<ChartEditor value={[{ id: "c1", title: "", chartKind: "scatter" }]} onChange={vi.fn()} table={thin} />);
    expect(screen.getByText(/mindst to talkolonner/i)).toBeInTheDocument();
  });

  it("renders with no table at all rather than crashing", () => {
    render(<ChartEditor value={[]} onChange={vi.fn()} table={null} />);
    expect(screen.getByRole("button", { name: /tilføj graf/i })).toBeInTheDocument();
  });
});
