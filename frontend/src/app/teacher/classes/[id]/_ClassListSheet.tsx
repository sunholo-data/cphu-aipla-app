"use client";

/** The class list — names against join codes, kept ONLY on this device
 *  (1.1.137, CLASSVISIT-1 lane C). Since the 2026-11 UI sweep the names are a
 *  column of the class page's one groups table (`_GroupsTable.tsx`); this file
 *  is the storage, the Excel round trip and the `useClassList` hook behind it.
 *
 *  ⚠️ PRIVACY BOUNDARY — read before changing anything here.
 *  ADR-001 (`docs/design/aipla/_scoping-snapshot/architecture.qmd`) promises
 *  that AIPLA collects no student identity data at all, and UCPH IT was told
 *  the personal-data category is "empty by construction". A names ↔ codes
 *  table on the server IS the identity map ADR-001 removed. So:
 *
 *    - names and notes live in `localStorage` under `aipla.classlist.{classId}`
 *      and in the hook's own state — NOTHING ELSE;
 *    - this file and `_GroupsTable.tsx` import no API client, no fetch helper,
 *      no analytics hook (the table hands its row actions a CODE, never a name);
 *    - the Excel download is built in memory (`lib/xlsx.ts`) and the import is
 *      parsed in the browser — no upload.
 *
 *  `__tests__/_ClassListSheet.test.tsx` spies on `fetch` and both auth-fetch
 *  helpers while a name is typed, downloaded and imported in the groups table,
 *  and while every row action runs, and fails if any request URL, body, header
 *  or callback argument carries it. Do not pass these values to a callback
 *  prop, a toast that is logged, an error reporter, or the co-pilot.
 */

import { useCallback, useEffect, useState } from "react";

import { parseCsv, slugify } from "@/lib/download";
import { XlsxUnsupportedError, downloadXlsx, readXlsxRows } from "@/lib/xlsx";
import { translate, useLocaleMode, useT } from "@/i18n";

export type ClassListLocale = "da" | "en";

// Copy lives in messages/{da,en}/teacher-classes.json (namespace ClassListSheet,
// 1.1.108 M2). The list follows the teacher's own language; `locale` pins it.

// ── storage ──────────────────────────────────────────────────────────────────

export interface ClassListEntry {
  names: string;
  note: string;
}
export type ClassListEntries = Record<string, ClassListEntry>;

export function classListStorageKey(classId: string): string {
  return `aipla.classlist.${classId}`;
}

/** Returns null when storage cannot be used at all (private window, blocked
 *  site data) — distinct from an empty list, so the page can say so. */
export function loadClassList(classId: string): ClassListEntries | null {
  try {
    const raw = window.localStorage.getItem(classListStorageKey(classId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { rows?: unknown };
    const rows = parsed && typeof parsed === "object" ? parsed.rows : null;
    if (!rows || typeof rows !== "object") return {};
    const out: ClassListEntries = {};
    for (const [code, v] of Object.entries(rows as Record<string, unknown>)) {
      const e = v as Partial<ClassListEntry> | null;
      out[code] = {
        names: typeof e?.names === "string" ? e.names : "",
        note: typeof e?.note === "string" ? e.note : "",
      };
    }
    return out;
  } catch {
    return null;
  }
}

/** Write the list. Returns false if storage refused (quota, private mode). */
export function saveClassList(classId: string, entries: ClassListEntries): boolean {
  try {
    const rows: ClassListEntries = {};
    for (const [code, e] of Object.entries(entries)) {
      if (e.names || e.note) rows[code] = e;
    }
    window.localStorage.setItem(classListStorageKey(classId), JSON.stringify({ v: 1, rows }));
    return true;
  } catch {
    return false;
  }
}

function storageUsable(): boolean {
  try {
    const probe = "aipla.classlist.__probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// ── export / import ──────────────────────────────────────────────────────────

export function joinLinkFor(origin: string, code: string): string {
  return `${origin}/group?code=${encodeURIComponent(code)}`;
}

/** The sheet as written to Excel: title row, blank row, header, one row per
 *  LIVE code. Revoked codes are not in `codes`, so they never reach the file. */
export function buildClassListRows(opts: {
  className: string;
  date: string;
  codes: ReadonlyArray<string>;
  entries: ClassListEntries;
  origin: string;
  locale: ClassListLocale;
}): string[][] {
  const t = translate(opts.locale, "ClassListSheet");
  return [
    [t("sheetHeading", { title: t("sheetTitle"), className: opts.className, date: opts.date })],
    [],
    [t("colCode"), t("colLink"), t("colNames"), t("colNote")],
    ...opts.codes.map((code) => [
      code,
      joinLinkFor(opts.origin, code),
      opts.entries[code]?.names ?? "",
      opts.entries[code]?.note ?? "",
    ]),
  ];
}

const HEADER_CODE = new Set(["code", "kode"]);
const isNamesHeader = (h: string) => h.startsWith("names") || h.startsWith("navne");
const isNoteHeader = (h: string) => h === "note" || h.startsWith("note ") || h.startsWith("notat");

/** Merge an imported grid into `entries`, matched on Code. Only live codes are
 *  taken; a non-empty imported cell overwrites, an empty one keeps what is
 *  already on this device. Finds the header row in either language, so a file
 *  exported in English imports on a Danish page and vice versa; with no header
 *  row it assumes our own column order. */
export function mergeImportedRows(
  grid: ReadonlyArray<ReadonlyArray<string>>,
  liveCodes: ReadonlyArray<string>,
  entries: ClassListEntries,
): { entries: ClassListEntries; matched: number; skipped: number } {
  const live = new Set(liveCodes);
  let headerIdx = -1;
  let codeCol = 0;
  let namesCol = 2;
  let noteCol = 3;
  for (let r = 0; r < grid.length; r++) {
    const norm = grid[r].map((v) => (v ?? "").trim().toLowerCase());
    const ci = norm.findIndex((v) => HEADER_CODE.has(v));
    if (ci >= 0) {
      headerIdx = r;
      codeCol = ci;
      const ni = norm.findIndex(isNamesHeader);
      const oi = norm.findIndex(isNoteHeader);
      namesCol = ni >= 0 ? ni : -1;
      noteCol = oi >= 0 ? oi : -1;
      break;
    }
  }

  const next: ClassListEntries = { ...entries };
  let matched = 0;
  let skipped = 0;
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const code = (row[codeCol] ?? "").trim();
    if (!code) continue;
    if (!live.has(code)) {
      // A title row or a revoked/foreign code: count only things that look
      // like codes, so the title line does not read as a "skipped row".
      if (/^[a-z0-9]+(-[a-z0-9]+)+$/i.test(code)) skipped++;
      continue;
    }
    const names = namesCol >= 0 ? (row[namesCol] ?? "").trim() : "";
    const note = noteCol >= 0 ? (row[noteCol] ?? "").trim() : "";
    const cur = next[code] ?? { names: "", note: "" };
    next[code] = { names: names || cur.names, note: note || cur.note };
    matched++;
  }
  return { entries: next, matched, skipped };
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Read an uploaded file into a grid — IN THE BROWSER. xlsx by magic bytes
 *  (so a renamed file still works), otherwise CSV text. */
export async function readClassListFile(file: File): Promise<string[][]> {
  const bytes = await readFileBytes(file);
  if (looksLikeZip(bytes)) return readXlsxRows(bytes);
  return parseCsv(new TextDecoder().decode(bytes));
}

// ── hook ─────────────────────────────────────────────────────────────────────

export interface UseClassListOptions {
  classId: string;
  className: string;
  /** LIVE codes only — the page's `activeGroupCodes(cls)`. Only these are
   *  exported to Excel and matched on import. */
  codes: ReadonlyArray<string>;
  /** 1.1.146 — revoked codes whose names this device keeps. Revoke ends
   *  access, not evidence: their sessions stay reviewable, and the teacher's
   *  own note of who was in the group is what makes those sessions readable.
   *  Kept in storage and shown read-only beside the revoked code; never
   *  exported. */
  retainedCodes?: ReadonlyArray<string>;
  /** `window.location.origin` as the page read it; the link carries the env. */
  joinOrigin: string;
  /** Pins the list's language; defaults to the teacher's own (1.1.108 M2). */
  locale?: ClassListLocale;
}

export interface ClassListState {
  entries: ClassListEntries;
  /** null until read after mount; false when the browser refuses storage. */
  storageOk: boolean | null;
  importMsg: { tone: "ok" | "warn"; text: string } | null;
  update: (code: string, field: keyof ClassListEntry, value: string) => void;
  download: () => void;
  importFile: (file: File | undefined) => Promise<void>;
}

/** Names and notes per code, in this browser only. Everything a caller can do
 *  with them stays inside this hook: localStorage, an in-memory xlsx, and a
 *  file read in the browser. */
export function useClassList({
  classId,
  className,
  codes,
  retainedCodes,
  joinOrigin,
  locale: pinned,
}: UseClassListOptions): ClassListState {
  const mode = useLocaleMode();
  const locale: ClassListLocale = pinned ?? (mode === "bilingual" ? "da" : mode);
  const t = useT("ClassListSheet", locale);
  const [entries, setEntries] = useState<ClassListEntries>({});
  const [storageOk, setStorageOk] = useState<boolean | null>(null);
  const [importMsg, setImportMsg] = useState<ClassListState["importMsg"]>(null);

  // Read after mount: the server render has no window.
  useEffect(() => {
    const loaded = loadClassList(classId);
    setEntries(loaded ?? {});
    setStorageOk(loaded !== null && storageUsable());
  }, [classId]);

  const persist = useCallback(
    (next: ClassListEntries) => {
      // Keep live codes, plus the revoked codes the page asks us to retain
      // (1.1.146). Anything else — a code this class never had — is dropped.
      const kept: ClassListEntries = {};
      for (const code of [...codes, ...(retainedCodes ?? [])]) if (next[code]) kept[code] = next[code];
      if (!saveClassList(classId, kept)) setStorageOk(false);
    },
    [classId, codes, retainedCodes],
  );

  function update(code: string, field: keyof ClassListEntry, value: string) {
    const cur = entries[code] ?? { names: "", note: "" };
    const next = { ...entries, [code]: { ...cur, [field]: value } };
    setEntries(next);
    persist(next);
  }

  function download() {
    const date = new Date().toISOString().slice(0, 10);
    const rows = buildClassListRows({ className, date, codes, entries, origin: joinOrigin, locale });
    const stem = slugify(className) || "class";
    downloadXlsx(`${slugify(t("sheetTitle"))}-${stem}-${date}.xlsx`, rows, {
      sheetName: t("sheetName"),
      columnWidths: [20, 48, 40, 30],
    });
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setImportMsg(null);
    try {
      const grid = await readClassListFile(file);
      const result = mergeImportedRows(grid, codes, entries);
      if (result.matched === 0) {
        setImportMsg({ tone: "warn", text: t("importNoMatch") });
        return;
      }
      setEntries(result.entries);
      persist(result.entries);
      setImportMsg({
        tone: "ok",
        text: result.skipped
          ? t("importDoneSkipped", { matched: result.matched, skipped: result.skipped })
          : t("importDone", { matched: result.matched }),
      });
    } catch (err) {
      setImportMsg({
        tone: "warn",
        text: err instanceof XlsxUnsupportedError ? t("importNeedsCsv") : t("importFailed"),
      });
    }
  }

  return { entries, storageOk, importMsg, update, download, importFile };
}
