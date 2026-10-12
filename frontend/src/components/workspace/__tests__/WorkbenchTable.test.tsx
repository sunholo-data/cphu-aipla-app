import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbenchChart, type ChartElementDef } from "../WorkbenchChart";
import { TABLE_CARD_DEBOUNCE_MS, WorkbenchTable, type TableElementDef } from "../WorkbenchTable";
import { plotFromCells } from "@/components/shared/work/chartPlot";
import { resolveChartBinding } from "@/lib/resolveChartBinding";

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
    // clear(), not removeItem(KEY): activity mounts buffer under a per-activity
    // key (`aipla.table:skill-1:act-1`), which would otherwise carry a reading
    // from one test into the next.
    window.sessionStorage.clear();
    vi.mocked(fetchWithAuth).mockClear();
    dispatch.mockClear();
  });

  it("renders the title, column headers with units, and rows×cols inputs", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} />);
    expect(screen.getByText("Målinger")).toBeInTheDocument();
    expect(screen.getByText("Tid")).toBeInTheDocument();
    expect(screen.getByText("(s)")).toBeInTheDocument();
    expect(screen.getByText("(m/s)")).toBeInTheDocument();
    // 3 rows × 2 number columns = 6 inputs. Text inputs with a decimal keypad,
    // not spinbuttons — a type="number" input drops a Danish "3,42" (1.1.136).
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(inputs).toHaveLength(6);
    for (const input of inputs) {
      expect(input.type).toBe("text");
      expect(input.inputMode).toBe("decimal");
    }
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

  // 1.1.120 — the progress endpoints are ACTIVITY-store-only. A bare-skill mount
  // (no activityId) that still called /activities/{skillId}/table is the
  // 2026-09-14 prod bug: the teacher got the 404 loop, the PUT got 403'd. The
  // component's contract is to degrade to local state instead.
  it("makes no progress call when there is no activityId — the grid still works locally", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} />);
    const cell = screen.getByLabelText("Målinger Tid række 1") as HTMLInputElement;
    // No GET on mount…
    expect(fetchWithAuth).not.toHaveBeenCalled();
    // …and no PUT on commit — the edit stays in local state.
    fireEvent.change(cell, { target: { value: "3.0" } });
    fireEvent.blur(cell);
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(cell.value).toBe("3.0");
  });

  it("loads the group's grid only when an activityId is present", async () => {
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL) => {
      if (String(url).includes("/table")) {
        return Promise.resolve(new Response(JSON.stringify({ cells: {}, revision: 0 }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    render(<WorkbenchTable skillId="skill-1" activityId="act-9" tables={[TABLE]} />);
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(fetchWithAuth).mock.calls[0][0])).toContain("/activities/act-9/table");
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

/**
 * 1.1.136 — the decimal comma. A type="number" input hands the page "" for
 * "3,42" in most browsers, so a Danish reading never reached the store. The
 * cells are now text inputs; the value is kept EXACTLY as typed, and only the
 * chart parses it.
 */
describe("WorkbenchTable — decimal comma", () => {
  // A fresh in-memory sessionStorage per test, so no reading leaks between
  // tests (or from the describe above) through the offline buffer.
  let store: Map<string, string>;
  const realStorage = window.sessionStorage;
  beforeEach(() => {
    store = new Map();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    });
    vi.mocked(fetchWithAuth).mockReset();
    vi.mocked(fetchWithAuth).mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    dispatch.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: realStorage });
  });

  it.each(["3,42", "3.42"])("accepts %s and stores it exactly as typed", (typed) => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
    const cell = screen.getByLabelText("Målinger Tid række 1") as HTMLInputElement;
    fireEvent.change(cell, { target: { value: typed } });
    fireEvent.blur(cell);
    expect(cell.value).toBe(typed);
    expect(JSON.parse(store.get(KEY) || "{}")["t1::0::t"]).toBe(typed);
    // The tutor gets the student's own string, not a normalised one.
    const body = JSON.parse((vi.mocked(fetchWithAuth).mock.calls[0][1] as RequestInit).body as string);
    expect(body.structuredContent.tables[0].data[0].t).toBe(typed);
    expect(screen.queryByText(/ikke tal/i)).not.toBeInTheDocument();
  });

  it("saves a comma reading to the group store verbatim", async () => {
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
      if (String(url).includes("/table") && opts?.method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ cells: { "t1::0::t": "3,42" }, revision: 1 }), { status: 200 }),
        );
      }
      if (String(url).includes("/table")) {
        return Promise.resolve(new Response(JSON.stringify({ cells: {}, revision: 0 }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    render(<WorkbenchTable skillId="skill-1" activityId="act-1" tables={[TABLE]} />);
    const cell = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(cell, { target: { value: "3,42" } });
    fireEvent.blur(cell);
    const put = await vi.waitFor(() => {
      const call = vi.mocked(fetchWithAuth).mock.calls.find(([, o]) => (o as RequestInit)?.method === "PUT");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(JSON.parse((put[1] as RequestInit).body as string).cells["t1::0::t"]).toBe("3,42");
  });

  it("the chart plots a typed '3,42' at 3.42", () => {
    const CHART: ChartElementDef = { id: "c1", title: "Fart-tid", chartKind: "scatter" };
    render(
      <>
        <WorkbenchTable skillId="skill-1" tables={[TABLE]} />
        <WorkbenchChart skillId="skill-1" charts={[CHART]} tables={[TABLE]} />
      </>,
    );
    const x = screen.getByLabelText("Målinger Tid række 1");
    fireEvent.change(x, { target: { value: "3,42" } });
    fireEvent.blur(x);
    const y = screen.getByLabelText("Målinger Fart række 1");
    fireEvent.change(y, { target: { value: "1,5" } });
    fireEvent.blur(y);
    // The rendered chart left its empty state…
    expect(screen.queryByText(/udfyld datatabellen/i)).not.toBeInTheDocument();
    // …and what it plots from the stored cells is 3.42, not 3.
    const binding = resolveChartBinding(CHART, [TABLE])!;
    const plotted = plotFromCells(binding, JSON.parse(store.get(KEY) || "{}"));
    expect(plotted.points).toEqual([{ x: 3.42, y: 1.5 }]);
  });

  it("hints softly at a non-numeric entry in a number column, and keeps it", () => {
    render(<WorkbenchTable skillId="skill-1" tables={[TABLE]} sessionId="sess-1" />);
    const cell = screen.getByLabelText("Målinger Tid række 1") as HTMLInputElement;
    fireEvent.focus(cell);
    fireEvent.change(cell, { target: { value: "ca. 3" } });
    // Not while typing…
    expect(screen.queryByText(/ikke tal/i)).not.toBeInTheDocument();
    fireEvent.blur(cell);
    // …but once the student leaves the cell.
    const hint = screen.getByText(/ikke tal/i);
    expect(cell).toHaveAttribute("aria-invalid", "true");
    expect(cell.getAttribute("aria-describedby")).toBe(hint.id);
    // A hint, not a block: the value is kept, stored and shared as typed.
    expect(cell.value).toBe("ca. 3");
    expect(JSON.parse(store.get(KEY) || "{}")["t1::0::t"]).toBe("ca. 3");
    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    // Fixing it clears the hint.
    fireEvent.change(cell, { target: { value: "3" } });
    expect(screen.queryByText(/ikke tal/i)).not.toBeInTheDocument();
    expect(cell).not.toHaveAttribute("aria-invalid");
  });

  it("does not hint on a text column", () => {
    const withText: TableElementDef = {
      ...TABLE,
      columns: [...TABLE.columns, { id: "n", label: "Note", kind: "text" }],
    };
    render(<WorkbenchTable skillId="skill-1" tables={[withText]} />);
    const note = screen.getByLabelText("Målinger Note række 1") as HTMLInputElement;
    expect(note.inputMode).toBe("text");
    fireEvent.change(note, { target: { value: "skred lidt" } });
    fireEvent.blur(note);
    expect(screen.queryByText(/ikke tal/i)).not.toBeInTheDocument();
    expect(note).not.toHaveAttribute("aria-invalid");
  });
});

/**
 * Cross-activity investigation (2026-10-08). Every activity in a class runs on the
 * same base skill, and builder-minted element ids repeat across activities
 * (`table-k1`, `col-k4`). The offline buffer was keyed by skill alone, so a tab
 * that moved from one activity to the next seeded the second grid with the first
 * one's readings and pushed them to the second activity's tutor. Prod 2026-10-05,
 * late-lynx-27: *Den hoppende bold* "Forsøg 2 = 72" (cm) arrived in
 * *Faseovergange* as "Vandets starttemperatur = 72" (°C), with no commit of its own.
 */
describe("WorkbenchTable — one tab, two activities on the same skill", () => {
  let store: Map<string, string>;
  const realStorage = window.sessionStorage;
  // Both activities' tables carry the SAME element ids, as the prod pair did.
  const BOLD: TableElementDef = {
    id: "table-k1",
    title: "Slip A (150 cm)",
    columns: [{ id: "col-k4", label: "Forsøg 2", unit: "cm", kind: "number" }],
    rows: 1,
  };
  const FASE: TableElementDef = {
    id: "table-k1",
    title: "Målte værdier",
    columns: [
      { id: "col-k3", label: "Isens masse", unit: "kg", kind: "number" },
      { id: "col-k4", label: "Vandets starttemperatur", unit: "C", kind: "number" },
    ],
    rows: 1,
  };
  // A per-activity group store, as the backend keeps it ({group}:{activity}).
  let server: Record<string, Record<string, string>>;

  beforeEach(() => {
    store = new Map();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
      },
    });
    server = {};
    vi.mocked(fetchWithAuth).mockReset();
    vi.mocked(fetchWithAuth).mockImplementation((url: RequestInfo | URL, opts?: RequestInit) => {
      const m = String(url).match(/\/activities\/([^/]+)\/table/);
      if (m) {
        const act = decodeURIComponent(m[1]);
        server[act] = server[act] ?? {};
        if (opts?.method === "PUT") {
          Object.assign(server[act], JSON.parse(opts.body as string).cells);
        }
        return Promise.resolve(
          new Response(JSON.stringify({ cells: { ...server[act] }, revision: 1 }), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    dispatch.mockClear();
  });
  afterEach(() => {
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: realStorage });
  });

  const pushedSnapshots = () =>
    vi
      .mocked(fetchWithAuth)
      .mock.calls.filter(([u]) => String(u).includes("/iframe-context"))
      .map(([u, o]) => ({ url: String(u), body: JSON.parse((o as RequestInit).body as string) }));

  it("does not carry one activity's readings into the next activity's grid or its tutor", async () => {
    // Activity A (the bouncing ball): the student enters 72 cm and commits.
    const a = render(
      <WorkbenchTable skillId="skill-1" activityId="act-bold" tables={[BOLD]} sessionId="sess-bold" />,
    );
    const bounce = screen.getByLabelText("Slip A (150 cm) Forsøg 2 række 1");
    fireEvent.change(bounce, { target: { value: "72" } });
    fireEvent.blur(bounce);
    await vi.waitFor(() => expect(server["act-bold"]?.["table-k1::0::col-k4"]).toBe("72"));
    a.unmount();
    vi.mocked(fetchWithAuth).mockClear();

    // Same tab, activity B (phase change): a different session, a fresh store.
    render(<WorkbenchTable skillId="skill-1" activityId="act-fase" tables={[FASE]} sessionId="sess-fase" />);
    const temp = screen.getByLabelText("Målte værdier Vandets starttemperatur række 1") as HTMLInputElement;
    await vi.waitFor(() =>
      expect(vi.mocked(fetchWithAuth).mock.calls.some(([u]) => String(u).includes("/act-fase/table"))).toBe(true),
    );
    expect(temp.value).toBe("");

    // The student's first reading in B: the push must carry that and nothing else.
    const ice = screen.getByLabelText("Målte værdier Isens masse række 1");
    fireEvent.change(ice, { target: { value: "0,1" } });
    fireEvent.blur(ice);
    await vi.waitFor(() => expect(pushedSnapshots().length).toBeGreaterThan(0));
    for (const { url, body } of pushedSnapshots()) {
      expect(url).toContain("/sessions/sess-fase/");
      expect(body.structuredContent.tables[0].data[0]["col-k4"]).toBe("");
      expect(JSON.stringify(body)).not.toContain('"72"');
    }
    expect(server["act-fase"]).toEqual({ "table-k1::0::col-k3": "0,1" });
  });

  it("still restores an activity's OWN buffer when the tab comes back to it", async () => {
    const a = render(<WorkbenchTable skillId="skill-1" activityId="act-bold" tables={[BOLD]} />);
    const bounce = screen.getByLabelText("Slip A (150 cm) Forsøg 2 række 1");
    fireEvent.change(bounce, { target: { value: "72" } });
    fireEvent.blur(bounce);
    await vi.waitFor(() => expect(server["act-bold"]?.["table-k1::0::col-k4"]).toBe("72"));
    a.unmount();
    server = {}; // the store answers empty: only this activity's buffer can restore it
    render(<WorkbenchTable skillId="skill-1" activityId="act-bold" tables={[BOLD]} />);
    const again = screen.getByLabelText("Slip A (150 cm) Forsøg 2 række 1") as HTMLInputElement;
    await vi.waitFor(() => expect(again.value).toBe("72"));
  });
});
