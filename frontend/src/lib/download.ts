/** Client-side file download helpers for teacher report exports.
 *
 *  Both helpers build a Blob in memory, create a temporary object URL,
 *  click a synthesized anchor, then revoke the URL. No backend round-trip.
 */

function triggerDownload(blob: Blob, filename: string): void {
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
