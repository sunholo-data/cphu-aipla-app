import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TABLE_CARD_DEBOUNCE_MS, WorkbenchTable, type TableElementDef } from "../WorkbenchTable";

vi.mock("@/lib/apiClient", () => ({
  fetchWithAuth: vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
}));
import { fetchWithAuth } from "@/lib/apiClient";

// Capture the human-tool-use card dispatch (the "shared with the AI" trust bit).
const dispatch = vi.fn();
vi.mock("@/hooks/useHumanToolEvents", () => ({ useHumanToolEvents: () => ({ dispatch }) }));

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
    dispatch.mockClear();
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

  it("surfaces ONE debounced 'shared with the tutor' card per editing burst, not per cell", () => {
    vi.useFakeTimers();
    try {
      render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
      const c1 = screen.getByLabelText("Målinger Tid række 1");
      fireEvent.change(c1, { target: { value: "1" } });
      fireEvent.blur(c1);
      const c2 = screen.getByLabelText("Målinger Fart række 1");
      fireEvent.change(c2, { target: { value: "2" } });
      fireEvent.blur(c2);
      // Two cells pushed, but no card yet — still inside the debounce window.
      expect(dispatch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(TABLE_CARD_DEBOUNCE_MS + 100);
      // One coalesced card naming the count, not one per cell.
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(dispatch.mock.calls[0][0].label).toMatch(/delt med vejlederen \(2 felter\)/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not card an empty edit burst (blur with no value)", () => {
    vi.useFakeTimers();
    try {
      render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
      fireEvent.blur(screen.getByLabelText("Målinger Tid række 1")); // no change
      vi.advanceTimersByTime(TABLE_CARD_DEBOUNCE_MS + 100);
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
