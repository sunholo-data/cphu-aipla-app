import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

import {
  ClassListSheet,
  classListStorageKey,
  mergeImportedRows,
} from "@/app/teacher/classes/[id]/_ClassListSheet";
import { buildXlsx } from "@/lib/xlsx";
import { toCsv } from "@/lib/download";

const CLASS_ID = "class-7b";
const ORIGIN = "https://aipla.example";
const NAME = "Søren Kierkegaard-Testesen";

let fetchSpy: ReturnType<typeof vi.fn>;

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

function sheet(codes = ["still-violin-61", "bright-fox-12"]) {
  return (
    <ClassListSheet classId={CLASS_ID} className="Physics 7B" codes={codes} joinOrigin={ORIGIN} />
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

beforeEach(() => {
  store.clear();
  installStorage();
  fetchSpy = vi.fn(async () => new Response("{}"));
  vi.stubGlobal("fetch", fetchSpy);
  fetchWithAuth.mockClear();
  fetchWithTeacherAuth.mockClear();
  downloadXlsxSpy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClassListSheet — names stay on this device (ADR-001)", () => {
  it("typing, downloading and importing names never produces a request carrying them", async () => {
    render(sheet());
    fireEvent.change(screen.getByLabelText("Names for still-violin-61"), { target: { value: NAME } });
    fireEvent.change(screen.getByLabelText("Note for still-violin-61"), { target: { value: `${NAME} note` } });
    fireEvent.click(screen.getByRole("button", { name: /download as excel/i }));

    const file = new File([toCsv([["Code", "Join link", "Names", "Note"], ["bright-fox-12", "", NAME, ""]])], "list.csv", {
      type: "text/csv",
    });
    fireEvent.change(screen.getByTestId("class-list-import"), { target: { files: [file] } });
    await screen.findByText(/imported names for 1 code/i);

    // It went to localStorage — and nowhere else.
    expect(window.localStorage.getItem(classListStorageKey(CLASS_ID))).toContain(NAME);
    expect(everythingSent()).not.toContain("Kierkegaard");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fetchWithAuth).not.toHaveBeenCalled();
    expect(fetchWithTeacherAuth).not.toHaveBeenCalled();
  });

  it("names survive a remount (a reload)", async () => {
    const { unmount } = render(sheet());
    fireEvent.change(screen.getByLabelText("Names for bright-fox-12"), { target: { value: "Anna, Bo" } });
    unmount();
    render(sheet());
    await waitFor(() => expect(screen.getByLabelText("Names for bright-fox-12")).toHaveValue("Anna, Bo"));
  });

  it("says so plainly — the list is only in this browser", () => {
    render(sheet());
    expect(screen.getByText("Names (only on this device)")).toBeInTheDocument();
    expect(screen.getByText(/kept only in this browser/i)).toBeInTheDocument();
  });

  it("warns when storage is unavailable instead of silently showing blanks", async () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    installStorage({ getItem: blocked, setItem: blocked });
    render(sheet());
    expect(await screen.findByRole("alert")).toHaveTextContent(/not letting AIPLA save/i);
  });
});

describe("ClassListSheet — revoked codes", () => {
  it("drops a revoked code from the table, the export and the device", async () => {
    window.localStorage.setItem(
      classListStorageKey(CLASS_ID),
      JSON.stringify({ v: 1, rows: { "gone-code-99": { names: "Revoked Person", note: "" }, "bright-fox-12": { names: "Eva", note: "" } } }),
    );
    // The page passes cls.groupCodes, which no longer holds a revoked code.
    render(sheet(["bright-fox-12"]));
    await waitFor(() => expect(screen.getByLabelText("Names for bright-fox-12")).toHaveValue("Eva"));
    expect(screen.queryByText("gone-code-99")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /download as excel/i }));
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
});

describe("ClassListSheet — import (M2)", () => {
  it("imports our own .xlsx, matched on Code, in the browser", async () => {
    render(sheet());
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
    render(sheet());
    const file = new File([toCsv([["Code", "Names"], ["nope-nope-1", "X"]])], "x.csv");
    fireEvent.change(screen.getByTestId("class-list-import"), { target: { files: [file] } });
    await screen.findByText(/no rows matched/i);
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
