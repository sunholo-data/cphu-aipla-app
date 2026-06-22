import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchTable, type TableElementDef } from "../WorkbenchTable";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

const TABLE: TableElementDef = {
  id: "t1",
  title: "Målinger",
  columns: [
    { id: "t", label: "Tid", unit: "s", kind: "number" },
    { id: "v", label: "Fart", unit: "m/s", kind: "number" },
  ],
  rows: 3,
};
const KEY = "aipla.table:skill-1";

describe("WorkbenchTable", () => {
  beforeEach(() => {
    window.sessionStorage.removeItem(KEY);
    vi.mocked(fetchWithAuth).mockClear();
  });

  it("renders the title, column headers with units, and rows×cols inputs", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} />);
    expect(screen.getByText("Målinger")).toBeInTheDocument();
    expect(screen.getByText("Tid")).toBeInTheDocument();
    expect(screen.getByText("(s)")).toBeInTheDocument();
    expect(screen.getByText("(m/s)")).toBeInTheDocument();
    // 3 rows × 2 number columns = 6 numeric inputs.
    expect(screen.getAllByRole("spinbutton")).toHaveLength(6);
  });

  it("lets the student enter a value", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} />);
    const cell = screen.getByLabelText("Målinger Tid række 1") as HTMLInputElement;
    fireEvent.change(cell, { target: { value: "1.5" } });
    expect(cell.value).toBe("1.5");
  });

  it("pushes the grid to iframe-context on commit when a session exists", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, opts] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toContain("/sessions/sess-1/iframe-context");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.serverId).toBe("table");
    expect(body.structuredContent.tableId).toBe("t1");
    expect(body.structuredContent.filledCells).toBe(1);
    expect(body.structuredContent.lastEvent).toBe("table.commit");
  });

  it("does not push when there is no session yet", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId={null} />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("does not push when a cell is blurred without a change", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
    fireEvent.blur(screen.getByLabelText("Målinger Tid række 1"));
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });

  it("persists entered values to sessionStorage", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "2.0" } });
    fireEvent.blur(cell);
    const stored = JSON.parse(window.sessionStorage.getItem(KEY) || "{}");
    expect(stored["t1::0::t"]).toBe("2.0");
  });
});
