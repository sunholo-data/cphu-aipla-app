/** Client-side file download helpers.
 *
 *  Every helper builds a Blob in memory, creates a temporary object URL,
 *  clicks a synthesized anchor, then revokes the URL. No backend round-trip —
 *  which is also why there is no server-side file-generation surface to secure.
 *
 *  Started as teacher report exports (CSV/JSON); `triggerDownload` and
 *  `slugify` are now shared with the STUDENT surfaces (1.1.73 — the writing
 *  element's txt/md/rtf export and the whiteboard's PNG). `slugify` used to
 *  live in `app/teacher/classes/[id]/_exportHelpers.ts`; it moved here so a
 *  student component never has to import a teacher route module (the eslint
 *  surface fence in `.eslintrc.json` would be right to object).
 */

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filename-safe stem from a human title. ASCII-lowercase, non-alphanumerics
 *  collapsed to `-`, trimmed, capped at 40 chars. Danish `æøå` are not in
 *  `a-z`, so they collapse to separators — deliberate: this is a filename, and
 *  a transliteration table is a different (and lossier) decision than a stem
 *  that is guaranteed portable across the filesystems a student's phone,
 *  laptop and school Windows box present. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Escape a single CSV cell per RFC 4180: wrap in quotes if the value
 *  contains a comma, quote, CR, or LF, and double any inner quotes. */
function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize a 2D array (header row + body rows) as CSV and trigger a
 *  download. Uses CRLF line endings for Excel compatibility. */
export function downloadCsv(filename: string, rows: ReadonlyArray<ReadonlyArray<unknown>>): void {
  const body = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}

/** Pretty-print `data` as JSON and trigger a download. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  triggerDownload(blob, filename);
}
