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
    // 1.1.88 M2 / 1.1.71 — an ARRAY of every table on the activity, matched by
    // id, like the calculator and writing elements. It used to be one snapshot
    // in a shared slot, so a second table reported EMPTY whenever the student
    // was editing the first.
    expect(body.structuredContent.tables).toHaveLength(1);
    expect(body.structuredContent.tables[0].tableId).toBe("t1");
    expect(body.structuredContent.tables[0].filledCells).toBe(1);
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

  // --- 1.1.88: the group's store, not the tab's -----------------------------

  it("loads the GROUP's cells on mount, including a member's this tab never typed", async () => {
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL) => {
      if (String(url).includes("/table")) {
        return Promise.resolve(
          new Response(JSON.stringify({ cells: { "t1::1::t": "0.54" }, revision: 3 }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    render(<WorkbenchTable skillId="skill-1" activityId="act-1" tables={[TABLE]} />);

    // Row 2's "Tid" was entered by the other student, on another device.
    const cell = (await screen.findByLabelText("Målinger Tid række 2")) as HTMLInputElement;
    await vi.waitFor(() => expect(cell.value).toBe("0.54"));
  });

  it("saves ONLY the changed cell, so a partner's row is not overwritten", async () => {
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL) => {
      if (String(url).includes("/table")) {
        return Promise.resolve(
          new Response(JSON.stringify({ cells: { "t1::0::t": "1.5", "t1::1::t": "0.54" }, revision: 4 }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    render(<WorkbenchTable skillId="skill-1" activityId="act-1" tables={[TABLE]} />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);

    const put = await vi.waitFor(() => {
      const call = vi
        .mocked(fetchWithAuth)
        .mock.calls.find(([, o]) => (o as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    const body = JSON.parse((put[1] as RequestInit).body as string);
    // The PATCH carries one cell — not the whole grid, which would re-assert
    // this client's stale copy of the partner's row.
    expect(Object.keys(body.cells)).toEqual(["t1::0::t"]);
    expect(body.cells["t1::0::t"]).toBe("1.5");
  });

  it("adopts the merged grid the save returns, so the partner's reading appears", async () => {
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
      if (String(url).includes("/table") && opts?.method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ cells: { "t1::0::t": "1.5", "t1::2::v": "9.81" }, revision: 5 }), {
            status: 200,
          }),
        );
      }
      if (String(url).includes("/table")) {
        return Promise.resolve(new Response(JSON.stringify({ cells: {}, revision: 0 }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    render(<WorkbenchTable skillId="skill-1" activityId="act-1" tables={[TABLE]} />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);

    const partnerCell = screen.getByLabelText("Målinger Fart række 3") as HTMLInputElement;
    await vi.waitFor(() => expect(partnerCell.value).toBe("9.81"));
  });

  it("shows a visible unsaved state when the save fails, rather than a silent loss", async () => {
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
      if (String(url).includes("/table") && opts?.method === "PUT") {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      if (String(url).includes("/table")) {
        return Promise.resolve(new Response(JSON.stringify({ cells: {}, revision: 0 }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    render(<WorkbenchTable skillId="skill-1" activityId="act-1" tables={[TABLE]} />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);

    expect(await screen.findByText(/Ikke gemt/)).toBeInTheDocument();
    // And the student's own value is still on screen — a failed share is not a
    // reason to take their reading away.
    expect((cell as HTMLInputElement).value).toBe("1.5");
  });

  it("still works with no activityId (preview / legacy mount) and saves nothing", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);
    const puts = vi.mocked(fetchWithAuth).mock.calls.filter(([, o]) => (o as RequestInit)?.method === "PUT");
    expect(puts).toHaveLength(0);
    expect((cell as HTMLInputElement).value).toBe("1.5");
  });

  it("pushes EVERY table on the activity, so a second table is never reported empty", () => {
    const second: TableElementDef = { ...TABLE, id: "t2", title: "Anden" };
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE, second]} sessionId="sess-1" />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "1.5" } });
    fireEvent.blur(cell);
    const body = JSON.parse((vi.mocked(fetchWithAuth).mock.calls[0][1] as RequestInit).body as string);
    expect(body.structuredContent.tables.map((t: { tableId: string }) => t.tableId)).toEqual(["t1", "t2"]);
  });
});
