import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TableEditor, type TableEditorValue } from "../TableEditor";

const VALUE: TableEditorValue = {
  title: "Målinger",
  columns: [{ key: 1, label: "Tid", unit: "s", kind: "number" }],
  rows: 5,
};

describe("TableEditor", () => {
  it("offers an 'Add data table' affordance when empty and seeds one column", () => {
    const onChange = vi.fn();
    render(<TableEditor value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add data table/i }));
    const next = onChange.mock.calls[0][0] as TableEditorValue;
    expect(next.columns).toHaveLength(1);
    expect(next.rows).toBe(5);
  });

  it("renders the title + columns when a table exists", () => {
    render(<TableEditor value={VALUE} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue("Målinger")).toBeInTheDocument();
    expect(screen.getByLabelText("Column 1 label")).toHaveValue("Tid");
    expect(screen.getByLabelText("Column 1 unit")).toHaveValue("s");
  });

  it("adds a column", () => {
    const onChange = vi.fn();
    render(<TableEditor value={VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    expect((onChange.mock.calls[0][0] as TableEditorValue).columns).toHaveLength(2);
  });

  it("removes a column", () => {
    const onChange = vi.fn();
    render(<TableEditor value={VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove column 1/i }));
    expect((onChange.mock.calls[0][0] as TableEditorValue).columns).toHaveLength(0);
  });

  it("removes the whole table (back to null)", () => {
    const onChange = vi.fn();
    render(<TableEditor value={VALUE} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove table/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clamps the row count to the 1-50 bound", () => {
    const onChange = vi.fn();
    render(<TableEditor value={VALUE} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/empty rows/i), { target: { value: "99" } });
    expect((onChange.mock.calls[0][0] as TableEditorValue).rows).toBe(50);
  });
});
