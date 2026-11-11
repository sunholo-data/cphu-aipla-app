import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both auth-fetch helpers are spied: the privacy claim is "no request carries a
// name", and a request made through either helper is still a request.
const fetchWithAuth = vi.fn(async () => new Response("{}"));
const fetchWithTeacherAuth = vi.fn(async () => new Response("{}"));
vi.mock("@/lib/apiClient", () => ({ fetchWithAuth, fetchWithTeacherAuth }));

const downloadXlsxSpy = vi.fn();
vi.mock("@/lib/xlsx", async (orig) => ({
  ...(await orig<typeof import("@/lib/xlsx")>()),
  downloadXlsx: (...args: unknown[]) => downloadXlsxSpy(...args),
}));

import { classListStorageKey, mergeImportedRows } from "@/app/teacher/classes/[id]/_ClassListSheet";
import { GroupsTable, type GroupsTableProps } from "@/app/teacher/classes/[id]/_GroupsTable";
import { buildXlsx } from "@/lib/xlsx";
import { toCsv } from "@/lib/download";
import { LocaleProvider } from "@/i18n";

// 1.1.137 → UI sweep 2026-11: the names left their own "Class list" section and
// became a column of the class page's ONE groups table. These are the class
// list's privacy assertions, FOLLOWING the names into that table (M's open
// question 2: merging puts browser-only names beside server data, so the
// guard has to cover the merged component). The row actions are now in the
// same component as the names, so they are exercised here too.

// 1.1.108 M2 — these tests assert the English copy; the teacher UI defaults to
// Danish (the teacher's own DA | EN choice), so render inside an English locale.
function EnglishLocale({ children }: { children: React.ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}
const render = ((ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: EnglishLocale, ...options })) as typeof rtlRender;

const CLASS_ID = "class-7b";
const ORIGIN = "https://aipla.example";
const NAME = "Søren Kierkegaard-Testesen";

let fetchSpy: ReturnType<typeof vi.fn>;
const callbacks = {
  onNewGroup: vi.fn(),
  onCopyLink: vi.fn(),
  onCopyCode: vi.fn(),
  onReset: vi.fn(),
  onRevoke: vi.fn(),
};

// An in-memory localStorage: the runner's is not reliably present (Node's own
// global shadows jsdom's without --localstorage-file). Same shape as
// _GettingStartedCard.test.tsx.
const store = new Map<string, string>();
function installStorage(overrides: Partial<Storage> = {}) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      ...overrides,
    },
  });
}

function table(codes = ["still-violin-61", "bright-fox-12"], extra: Partial<GroupsTableProps> = {}) {
  return (
    <GroupsTable
      classId={CLASS_ID}
      className="Physics 7B"
      liveCodes={codes}
      retiredCodes={[]}
      joinOrigin={ORIGIN}
      description=""
      live={null}
      liveError={false}
      latestByGroup={new Map()}
      timeLocale="en"
      minting={false}
      {...callbacks}
      {...extra}
    />
  );
}

/** Every argument of every call, serialised — URL, body and headers alike. */
function everythingSent(): string {
  const calls = [...fetchSpy.mock.calls, ...fetchWithAuth.mock.calls, ...fetchWithTeacherAuth.mock.calls];
  return calls
    .map((args) =>
      (args as unknown[])
        .map((a) => {
          if (a && typeof a === "object" && "headers" in (a as object)) {
            const init = a as RequestInit;
            const h = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : init.headers;
            return JSON.stringify({ ...init, headers: h, body: String(init.body ?? "") });
          }
          return typeof a === "string" ? a : JSON.stringify(a);
        })
        .join(" "),
    )
    .join("\n");
}

/** Open a Radix menu by keyboard and return its items. */
async function openMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.findAllByRole("menuitem");
}

beforeEach(() => {
  store.clear();
  installStorage();
  fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  fetchWithAuth.mockClear();
  fetchWithTeacherAuth.mockClear();
  downloadXlsxSpy.mockClear();
  for (const cb of Object.values(callbacks)) cb.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GroupsTable names — stay on this device (ADR-001)", () => {
  it("typing, downloading, importing and every row action never carry a name anywhere", async () => {
    render(table());
    fireEvent.change(screen.getByLabelText("Names for still-violin-61"), { target: { value: NAME } });
    fireEvent.change(screen.getByLabelText("Note for still-violin-61"), { target: { value: `${NAME} note` } });

    // Excel ▾ → Download.
    fireEvent.click((await openMenu(/names: excel/i))[0]);
    expect(downloadXlsxSpy).toHaveBeenCalledTimes(1);

    const file = new File([toCsv([["Code", "Join link", "Names", "Note"], ["bright-fox-12", "", NAME, ""]])], "list.csv", {
      type: "text/csv",
    });
    fireEvent.change(screen.getByTestId("class-list-import"), { target: { files: [file] } });
    await screen.findByText(/imported names for 1 code/i);

    // Every row action, on the row whose names were just typed.
    fireEvent.click(screen.getByRole("button", { name: "Copy join link for still-violin-61" }));
    for (const i of [0, 1, 2]) {
      fireEvent.click((await openMenu("More actions for still-violin-61"))[i]);
    }
    fireEvent.click(screen.getByRole("button", { name: /new group/i }));
    expect(callbacks.onCopyLink).toHaveBeenCalledWith("still-violin-61");
    expect(callbacks.onCopyCode).toHaveBeenCalledWith("still-violin-61");
    expect(callbacks.onReset).toHaveBeenCalledWith("still-violin-61");
    expect(callbacks.onRevoke).toHaveBeenCalledWith("still-violin-61");

    // It went to localStorage — and nowhere else: no request, no callback.
    expect(window.localStorage.getItem(classListStorageKey(CLASS_ID))).toContain(NAME);
    expect(everythingSent()).not.toContain("Kierkegaard");
    expect(JSON.stringify(Object.values(callbacks).map((cb) => cb.mock.calls))).not.toContain("Kierkegaard");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(fetchWithTeacherAuth).not.toHaveBeenCalled();
  });

  it("names survive a remount (a reload)", async () => {
    const { unmount } = render(table());
    fireEvent.change(screen.getByLabelText("Names for bright-fox-12"), { target: { value: "Anna, Bo" } });
    unmount();
    render(table());
    await waitFor(() => expect(screen.getByLabelText("Names for bright-fox-12")).toHaveValue("Anna, Bo"));
  });

  it("says so plainly — the names are only in this browser", () => {
    render(table());
    expect(screen.getByRole("columnheader", { name: "Names · only in your browser" })).toBeInTheDocument();
    expect(screen.getByText(/kept only in this browser/i)).toBeInTheDocument();
  });

  it("warns when storage is unavailable instead of silently showing blanks", async () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    installStorage({ getItem: blocked, setItem: blocked });
    render(table());
    expect(await screen.findByRole("alert")).toHaveTextContent(/not letting AIPLA save/i);
  });
});

describe("GroupsTable names — revoked codes", () => {
  it("drops a revoked code from the table, the export and the device", async () => {
    window.localStorage.setItem(
      classListStorageKey(CLASS_ID),
      JSON.stringify({ v: 1, rows: { "gone-code-99": { names: "Revoked Person", note: "" }, "bright-fox-12": { names: "Eva", note: "" } } }),
    );
    // The page passes activeGroupCodes(cls), which no longer holds a revoked code.
    render(table(["bright-fox-12"]));
    await waitFor(() => expect(screen.getByLabelText("Names for bright-fox-12")).toHaveValue("Eva"));
    expect(screen.queryByText("gone-code-99")).not.toBeInTheDocument();

    fireEvent.click((await openMenu(/names: excel/i))[0]);
    const [filename, rows] = downloadXlsxSpy.mock.calls[0] as [string, string[][]];
    expect(filename).toMatch(/^class-list-physics-7b-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(rows[0][0]).toMatch(/^Class list: Physics 7B \(\d{4}-\d{2}-\d{2}\)$/);
    expect(rows[2]).toEqual(["Code", "Join link", "Names (only on this device)", "Note"]);
    expect(rows.slice(3)).toEqual([["bright-fox-12", `${ORIGIN}/group?code=bright-fox-12`, "Eva", ""]]);
    expect(JSON.stringify(rows)).not.toContain("Revoked Person");

    // Next edit rewrites storage with live codes only.
    fireEvent.change(screen.getByLabelText("Note for bright-fox-12"), { target: { value: "front row" } });
    expect(window.localStorage.getItem(classListStorageKey(CLASS_ID))).not.toContain("Revoked Person");
  });

  it("keeps a retained revoked code's names on the device and beside the code, but not as a row or in the export", async () => {
    // 1.1.146 — its sessions are still reviewable, so who was in the group is kept.
    window.localStorage.setItem(
      classListStorageKey(CLASS_ID),
      JSON.stringify({ v: 1, rows: { "gone-code-99": { names: "Revoked Person", note: "" }, "bright-fox-12": { names: "Eva", note: "" } } }),
    );
    render(table(["bright-fox-12"], { retiredCodes: ["gone-code-99"] }));
    await waitFor(() => expect(screen.getByLabelText("Names for bright-fox-12")).toHaveValue("Eva"));
    expect(within(screen.getByTestId("groups-table")).queryByText("gone-code-99")).toBeNull();
    expect(screen.getByTestId("revoked-codes")).toHaveTextContent("Revoked Person");

    fireEvent.click((await openMenu(/names: excel/i))[0]);
    const [, rows] = downloadXlsxSpy.mock.calls[0] as [string, string[][]];
    expect(JSON.stringify(rows)).not.toContain("Revoked Person");

    fireEvent.change(screen.getByLabelText("Note for bright-fox-12"), { target: { value: "front row" } });
    expect(window.localStorage.getItem(classListStorageKey(CLASS_ID))).toContain("Revoked Person");
  });
});

describe("GroupsTable names — import (M2)", () => {
  it("imports our own .xlsx, matched on Code, in the browser", async () => {
    render(table());
    const bytes = buildXlsx([
      ["Class list: Physics 7B (2026-09-29)"],
      [],
      ["Code", "Join link", "Names (only on this device)", "Note"],
      ["still-violin-61", "x", "Anna, Bo, Carl", "table 3"],
      ["someone-else-7", "x", "Not Ours", ""],
    ]);
    const file = new File([bytes as BlobPart], "class-list.xlsx");
    fireEvent.change(screen.getByTestId("class-list-import"), { target: { files: [file] } });
    await screen.findByText(/imported names for 1 code; 1 row skipped/i);
    expect(screen.getByLabelText("Names for still-violin-61")).toHaveValue("Anna, Bo, Carl");
    expect(screen.getByLabelText("Note for still-violin-61")).toHaveValue("table 3");
    expect(window.localStorage.getItem(classListStorageKey(CLASS_ID))).not.toContain("Not Ours");
  });

  it("says so when nothing matched", async () => {
    render(table());
    const file = new File([toCsv([["Code", "Names"], ["nope-nope-1", "X"]])], "x.csv");
    fireEvent.change(screen.getByTestId("class-list-import"), { target: { files: [file] } });
    await screen.findByText(/no rows matched/i);
  });

  it("offers import from the table header's Excel menu, saying nothing is uploaded", async () => {
    render(table());
    const items = await openMenu(/names: excel/i);
    expect(items[1]).toHaveTextContent(/Import from Excel\/CSV/);
    expect(items[1]).toHaveTextContent(/nothing is uploaded/);
  });
});

describe("mergeImportedRows", () => {
  it("reads a Danish header, keeps existing values where the import is empty", () => {
    const grid = [
      ["Klasseliste: 7B"],
      ["Kode", "Link til at deltage", "Navne (kun på denne enhed)", "Note"],
      ["a-b-1", "", "", "ny note"],
      ["c-d-2", "", "Eva", ""],
    ];
    const r = mergeImportedRows(grid, ["a-b-1", "c-d-2"], { "a-b-1": { names: "Anna", note: "old" } });
    expect(r.matched).toBe(2);
    expect(r.entries["a-b-1"]).toEqual({ names: "Anna", note: "ny note" });
    expect(r.entries["c-d-2"]).toEqual({ names: "Eva", note: "" });
  });
});
