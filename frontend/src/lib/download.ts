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

/** Filename-safe stem from a human title: ASCII-lowercase, non-alphanumerics
 *  collapsed to `-`, trimmed, capped at 40 chars.
 *
 *  **Danish transliterates rather than collapsing** (`æ`→`ae`, `ø`→`o`, `å`→`a`,
 *  then NFKD-strip the remaining accents). Without it, "Bølger og resonans"
 *  becomes `b-lger-og-resonans` — which is what a Danish student would find in
 *  their downloads folder, for a product whose users write Danish. Matches
 *  `slugifyProjectHeading` (`lib/projectHeadings.ts`), which already made this
 *  call for the project site's anchors. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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

/** UTF-8 byte-order mark. Without it, Danish-locale Excel reads a CSV as
 *  Windows-1252 and `Søren` opens as `SÃ¸ren` (1.1.137 M0). */
export const UTF8_BOM = "\uFEFF";

/** Serialize a 2D array (header row + body rows) as CSV text, BOM first.
 *  CRLF line endings for Excel compatibility. Split out of `downloadCsv` so
 *  the exact bytes are testable without a Blob round-trip. */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return UTF8_BOM + rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n");
}

/** Serialize a 2D array as CSV and trigger a download.
 *
 *  ⚠️ The BOM fixes the ENCODING (æøå) in every Excel. It does not fix the
 *  SEPARATOR: Danish-locale Excel splits on `;`, so double-clicking a comma
 *  CSV there may still land each row in column A (Data → From Text/CSV reads it
 *  correctly). A `sep=,` hint line would fix that but makes Excel ignore the
 *  BOM, trading one breakage for the other — which is why the class list
 *  (M1) writes a real .xlsx (`lib/xlsx.ts`) instead. */
export function downloadCsv(filename: string, rows: ReadonlyArray<ReadonlyArray<unknown>>): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}

/** Pick the CSV separator: the candidate that splits the most lines into the
 *  SAME number of cells. Consistency beats raw count because Danish Excel
 *  writes `;` files whose names cells are full of unquoted commas
 *  ("Anna, Bo, Carl") — commas vary per row, the real separator does not. */
function detectSeparator(src: string): string {
  const sample = src.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let sep = ",";
  let bestScore = -1;
  let bestCount = -1;
  for (const cand of [",", ";", "\t"]) {
    const freq = new Map<number, number>();
    for (const l of sample) {
      const n = l.split(cand).length - 1;
      if (n > 0) freq.set(n, (freq.get(n) ?? 0) + 1);
    }
    let score = 0;
    let count = 0;
    for (const [n, f] of freq) {
      if (f > score || (f === score && n > count)) {
        score = f;
        count = n;
      }
    }
    if (score > bestScore || (score === bestScore && count > bestCount)) {
      bestScore = score;
      bestCount = count;
      sep = cand;
    }
  }
  return sep;
}

/** Parse CSV text into rows (RFC 4180 quoting). Strips a leading BOM and
 *  auto-detects the separator — `,`, `;` (what Danish Excel writes on
 *  "Save as CSV") or tab. */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(UTF8_BOM) ? text.slice(1) : text;
  const sep = detectSeparator(src);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Pretty-print `data` as JSON and trigger a download. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  triggerDownload(blob, filename);
}
