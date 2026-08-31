import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MAX_TABLES, TableEditor, type TableEditorValue } from "../TableEditor";

const VALUE: TableEditorValue = {
  key: 1,
  title: "Målinger",
  columns: [{ key: 2, label: "Tid", unit: "s", kind: "number" }],
  rows: 5,
};

/** A monotonic key minter, standing in for the builder's `nextElementKey`. */
function keyer(start = 100) {
  let n = start;
  return () => n++;
}

function table(key: number, title: string): TableEditorValue {
  return {
    key,
    title,
    columns: [{ key: key * 10, label: "Tid", unit: "s", kind: "number" }],
    rows: 5,
  };
}

describe("TableEditor", () => {
  it("offers an 'Add data table' affordance when empty and seeds one column", () => {
    const onChange = vi.fn();
    render(<TableEditor value={[]} onChange={onChange} nextKey={keyer()} />);
    fireEvent.click(screen.getByRole("button", { name: /add data table/i }));
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next).toHaveLength(1);
    expect(next[0].columns).toHaveLength(1);
    expect(next[0].rows).toBe(5);
  });

  it("renders the title + columns when a table exists", () => {
    render(<TableEditor value={[VALUE]} onChange={vi.fn()} nextKey={keyer()} />);
    expect(screen.getByDisplayValue("Målinger")).toBeInTheDocument();
    expect(screen.getByLabelText("Målinger column 1 label")).toHaveValue("Tid");
    expect(screen.getByLabelText("Målinger column 1 unit")).toHaveValue("s");
  });

  it("adds a column", () => {
    const onChange = vi.fn();
    render(<TableEditor value={[VALUE]} onChange={onChange} nextKey={keyer()} />);
    fireEvent.click(screen.getByRole("button", { name: /add column/i }));
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next[0].columns).toHaveLength(2);
  });

  it("removes a column", () => {
    const onChange = vi.fn();
    render(<TableEditor value={[VALUE]} onChange={onChange} nextKey={keyer()} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Målinger column 1" }));
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next[0].columns).toHaveLength(0);
  });

  it("removes the whole table (back to an empty list)", () => {
    const onChange = vi.fn();
    render(<TableEditor value={[VALUE]} onChange={onChange} nextKey={keyer()} />);
    // The accessible name carries the table's own label, so several Remove
    // buttons stay distinguishable to a screen reader.
    fireEvent.click(screen.getByRole("button", { name: "Remove Målinger" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("clamps the row count to the 1-50 bound", () => {
    const onChange = vi.fn();
    render(<TableEditor value={[VALUE]} onChange={onChange} nextKey={keyer()} />);
    fireEvent.change(screen.getByLabelText(/row count/i), { target: { value: "99" } });
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next[0].rows).toBe(50);
  });

  // --- 1.1.71: several tables ----------------------------------------------

  it("renders every table, not just the first", () => {
    render(
      <TableEditor value={[table(1, "Faldforsøg"), table(2, "Kast")]} onChange={vi.fn()} nextKey={keyer()} />,
    );
    expect(screen.getByDisplayValue("Faldforsøg")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kast")).toBeInTheDocument();
  });

  it("appends a table rather than replacing the existing one", () => {
    const onChange = vi.fn();
    render(<TableEditor value={[table(1, "Faldforsøg")]} onChange={onChange} nextKey={keyer()} />);
    fireEvent.click(screen.getByRole("button", { name: /add data table/i }));
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next).toHaveLength(2);
    expect(next[0].title).toBe("Faldforsøg");
  });

  it("removes only the table asked for, leaving the others' keys untouched", () => {
    // The heart of 1.1.71: deleting a table must not disturb the identity of
    // any other, because chart bindings are keyed on it.
    const onChange = vi.fn();
    const tables = [table(1, "Første"), table(2, "Anden"), table(3, "Tredje")];
    render(<TableEditor value={tables} onChange={onChange} nextKey={keyer()} />);
    // Exact name: "Remove Første" would also substring-match
    // "Remove Første column 1".
    fireEvent.click(screen.getByRole("button", { name: "Remove Første" }));
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next.map((t) => t.key)).toEqual([2, 3]);
    expect(next.map((t) => t.title)).toEqual(["Anden", "Tredje"]);
  });

  it("disables Add at the cap AND says why", () => {
    // A disabled control with no reason reads as a bug rather than a limit.
    const onChange = vi.fn();
    const full = Array.from({ length: MAX_TABLES }, (_, i) => table(i + 1, `T${i + 1}`));
    render(<TableEditor value={full} onChange={onChange} nextKey={keyer()} />);
    const add = screen.getByRole("button", { name: /add data table/i });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute("title", expect.stringContaining(String(MAX_TABLES)));
    expect(screen.getByText(new RegExp(`Maximum ${MAX_TABLES} tables`, "i"))).toBeInTheDocument();
  });

  it("gives an untitled table a positional label so several stay distinguishable", () => {
    render(<TableEditor value={[table(1, ""), table(2, "")]} onChange={vi.fn()} nextKey={keyer()} />);
    expect(screen.getByLabelText("Table 1 column 1 label")).toBeInTheDocument();
    expect(screen.getByLabelText("Table 2 column 1 label")).toBeInTheDocument();
  });

  it("takes new keys from the injected minter, never a local counter", () => {
    // Two counters eventually mint the same element id, which is the exact
    // class of bug stable ids exist to remove.
    const onChange = vi.fn();
    render(<TableEditor value={[]} onChange={onChange} nextKey={keyer(500)} />);
    fireEvent.click(screen.getByRole("button", { name: /add data table/i }));
    const next = onChange.mock.calls[0][0] as TableEditorValue[];
    expect(next[0].key).toBe(500);
    expect(next[0].columns[0].key).toBe(501);
  });
});
