"use client";

/** The class list — names against join codes, kept ONLY on this device
 *  (1.1.137, CLASSVISIT-1 lane C).
 *
 *  ⚠️ PRIVACY BOUNDARY — read before changing anything here.
 *  ADR-001 (`docs/design/aipla/_scoping-snapshot/architecture.qmd`) promises
 *  that AIPLA collects no student identity data at all, and UCPH IT was told
 *  the personal-data category is "empty by construction". A names ↔ codes
 *  table on the server IS the identity map ADR-001 removed. So:
 *
 *    - names and notes live in `localStorage` under `aipla.classlist.{classId}`
 *      and in this component's own state — NOTHING ELSE;
 *    - this file imports no API client, no fetch helper, no analytics hook;
 *    - the Excel download is built in memory (`lib/xlsx.ts`) and the import is
 *      parsed in the browser — no upload.
 *
 *  `__tests__/_ClassListSheet.test.tsx` spies on `fetch` and both auth-fetch
 *  helpers while a name is typed, downloaded and imported, and fails if any
 *  request URL, body or header carries it. Do not pass these values to a
 *  callback prop, a toast that is logged, an error reporter, or the co-pilot.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";

import { parseCsv, slugify } from "@/lib/download";
import { XlsxUnsupportedError, downloadXlsx, readXlsxRows } from "@/lib/xlsx";
import { translate, useLocaleMode, useT } from "@/i18n";

export type ClassListLocale = "da" | "en";

// Copy lives in messages/{da,en}/teacher-classes.json (namespace ClassListSheet,
// 1.1.108 M2). The sheet follows the teacher's own language; `locale` pins it.

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

// ── component ────────────────────────────────────────────────────────────────

export interface ClassListSheetProps {
  classId: string;
  className: string;
  /** LIVE codes only — the page's `cls.groupCodes`, which drops a code the
   *  moment it is revoked. */
  codes: ReadonlyArray<string>;
  /** `window.location.origin` as the page read it; the link carries the env. */
  joinOrigin: string;
  /** Pins the sheet's language; defaults to the teacher's own (1.1.108 M2). */
  locale?: ClassListLocale;
}

export function ClassListSheet({ classId, className, codes, joinOrigin, locale: pinned }: ClassListSheetProps) {
  const mode = useLocaleMode();
  const locale: ClassListLocale = pinned ?? (mode === "bilingual" ? "da" : mode);
  const t = useT("ClassListSheet", locale);
  const [entries, setEntries] = useState<ClassListEntries>({});
  const [storageOk, setStorageOk] = useState<boolean | null>(null);
  const [importMsg, setImportMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importHelpId = useId();

  // Read after mount: the server render has no window.
  useEffect(() => {
    const loaded = loadClassList(classId);
    setEntries(loaded ?? {});
    setStorageOk(loaded !== null && storageUsable());
  }, [classId]);

  const persist = useCallback(
    (next: ClassListEntries) => {
      // Keep only live codes — a revoked code's names are dropped from the
      // device too, not merely hidden.
      const liveOnly: ClassListEntries = {};
      for (const code of codes) if (next[code]) liveOnly[code] = next[code];
      if (!saveClassList(classId, liveOnly)) setStorageOk(false);
    },
    [classId, codes],
  );

  function update(code: string, field: keyof ClassListEntry, value: string) {
    const cur = entries[code] ?? { names: "", note: "" };
    const next = { ...entries, [code]: { ...cur, [field]: value } };
    setEntries(next);
    persist(next);
  }

  function handleDownload() {
    const date = new Date().toISOString().slice(0, 10);
    const rows = buildClassListRows({ className, date, codes, entries, origin: joinOrigin, locale });
    const stem = slugify(className) || "class";
    downloadXlsx(`${slugify(t("sheetTitle"))}-${stem}-${date}.xlsx`, rows, {
      sheetName: t("sheetName"),
      columnWidths: [20, 48, 40, 30],
    });
  }

  async function handleImport(file: File | undefined) {
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
      setImportMsg({ tone: "warn", text: err instanceof XlsxUnsupportedError ? t("importNeedsCsv") : t("importFailed") });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="class-list-sheet">
      {storageOk === false ? (
        <p role="alert" className="rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {t("storageUnavailable")}
        </p>
      ) : null}

      {codes.length === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{t("noCodes")}</p>
      ) : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{t("colCode")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("colLink")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("colNames")}</th>
                <th scope="col" className="px-3 py-2 font-medium">{t("colNote")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {codes.map((code) => {
                const link = joinLinkFor(joinOrigin, code);
                return (
                  <tr key={code}>
                    <td className="px-3 py-2 align-top">
                      <code className="font-mono text-xs">{code}</code>
                    </td>
                    <td className="max-w-[16rem] px-3 py-2 align-top">
                      <span className="block truncate font-mono text-xs text-muted-foreground" title={link}>
                        {link}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      <input
                        type="text"
                        value={entries[code]?.names ?? ""}
                        onChange={(e) => update(code, "names", e.target.value)}
                        aria-label={t("namesLabel", { code })}
                        placeholder={t("namesPlaceholder")}
                        autoComplete="off"
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      />
                    </td>
                    <td className="px-3 py-1.5 align-top">
                      <input
                        type="text"
                        value={entries[code]?.note ?? ""}
                        onChange={(e) => update(code, "note", e.target.value)}
                        aria-label={t("noteLabel", { code })}
                        autoComplete="off"
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("keptLocally")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleDownload}
          disabled={codes.length === 0}
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {t("download")}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={codes.length === 0}
          aria-describedby={importHelpId}
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          {t("importButton")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          data-testid="class-list-import"
          onChange={(e) => void handleImport(e.target.files?.[0])}
        />
      </div>
      <p id={importHelpId} className="text-xs text-muted-foreground">{t("importHelp")}</p>
      {importMsg ? (
        <p
          role="status"
          className={importMsg.tone === "ok" ? "text-sm text-foreground" : "text-sm text-amber-700 dark:text-amber-300"}
        >
          {importMsg.text}
        </p>
      ) : null}
    </div>
  );
}
