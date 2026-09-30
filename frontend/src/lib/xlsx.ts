/** A minimal, dependency-free `.xlsx` writer — and a reader just big enough to
 *  bring a class list back (1.1.137, CLASSVISIT-1 lane C).
 *
 *  An xlsx is a ZIP of a few XML parts. Writing one needs no compression: a
 *  STORED (method 0) ZIP plus CRC-32 is a valid archive, and Excel, LibreOffice
 *  and Numbers all open it. Cells are written as INLINE strings (`t="inlineStr"`)
 *  so no `sharedStrings.xml` part is needed. This keeps a write-only feature off
 *  the `make security-check` surface: the npm `xlsx` (SheetJS) package is frozen
 *  at a version with open advisories, and nothing else was worth a dependency
 *  for ~150 lines.
 *
 *  Reading is the harder half. Our own files are stored, but the moment a
 *  teacher opens and re-saves in Excel the parts are DEFLATE-compressed and the
 *  cells move into `sharedStrings.xml`. `readXlsxRows` handles both: stored
 *  entries are sliced, deflated ones go through the browser's
 *  `DecompressionStream('deflate-raw')` (every current evergreen browser). If
 *  that is missing, it throws `XlsxUnsupportedError` and the caller asks for a
 *  CSV instead.
 *
 *  Everything here runs in the browser. Nothing is uploaded — that is the point
 *  of the feature (ADR-001: no student name ever reaches the server).
 */

import { triggerDownload } from "@/lib/download";

export type CellValue = string | number | null | undefined;

// ── CRC-32 (IEEE 802.3, the ZIP polynomial) ─────────────────────────────────

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

export function crc32(bytes: Uint8Array): number {
  const t = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── STORED ZIP writer ────────────────────────────────────────────────────────

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** DOS date/time for 1980-01-01 00:00 — a fixed stamp keeps output
 *  deterministic (and so testable byte-for-byte). */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export function buildStoredZip(entries: ReadonlyArray<ZipEntry>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new Uint8Array(30 + name.length + size);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header signature
    lv.setUint16(4, 20, true); // version needed (2.0)
    lv.setUint16(6, 0x0800, true); // flags: UTF-8 names
    lv.setUint16(8, 0, true); // method: STORED
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    local.set(e.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    // 30 extra len, 32 comment len, 34 disk, 36 internal attr, 38 external attr: 0
    cv.setUint32(42, offset, true); // local header offset
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let p = 0;
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

// ── xlsx parts ───────────────────────────────────────────────────────────────

/** XML-escape, and drop characters XML 1.0 forbids outright (a stray control
 *  character pasted from somewhere would otherwise make Excel refuse the file). */
export function xmlEscape(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(ref: string, value: CellValue): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

export interface XlsxOptions {
  sheetName?: string;
  /** Column widths in Excel character units, by column index. */
  columnWidths?: ReadonlyArray<number>;
}

function sheetXml(rows: ReadonlyArray<ReadonlyArray<CellValue>>, opts: XlsxOptions): string {
  const cols = opts.columnWidths?.length
    ? `<cols>${opts.columnWidths
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const body = rows
    .map((row, r) => {
      const cells = row.map((v, c) => cellXml(`${columnLetter(c)}${r + 1}`, v)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${cols}<sheetData>${body}</sheetData></worksheet>`
  );
}

/** Build the bytes of a one-sheet `.xlsx` workbook. */
export function buildXlsx(
  rows: ReadonlyArray<ReadonlyArray<CellValue>>,
  opts: XlsxOptions = {},
): Uint8Array {
  // Sheet names: max 31 chars, none of []:*?/\
  const sheetName = (opts.sheetName || "Sheet1").replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1";
  const enc = new TextEncoder();
  const X = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  const parts: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        X +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        X +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        X +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        X +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`,
      ),
    },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheetXml(rows, opts)) },
  ];
  return buildStoredZip(parts);
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Build a one-sheet workbook from `rows` and trigger a browser download. */
export function downloadXlsx(
  filename: string,
  rows: ReadonlyArray<ReadonlyArray<CellValue>>,
  opts: XlsxOptions = {},
): void {
  const bytes = buildXlsx(rows, opts);
  triggerDownload(new Blob([bytes as BlobPart], { type: XLSX_MIME }), filename);
}

// ── reader ───────────────────────────────────────────────────────────────────

/** The file is compressed and this browser cannot inflate it — ask for CSV. */
export class XlsxUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxUnsupportedError";
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) {
    throw new XlsxUnsupportedError("This browser cannot read compressed Excel files.");
  }
  let ds: DecompressionStream;
  try {
    ds = new DS("deflate-raw" as CompressionFormat);
  } catch {
    throw new XlsxUnsupportedError("This browser cannot read compressed Excel files.");
  }
  // Write and read concurrently — awaiting the write first can deadlock on
  // backpressure once the output exceeds the stream's queue.
  const writer = ds.writable.getWriter();
  const written = writer.write(data as unknown as BufferSource).then(() => writer.close());
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Read every entry of a ZIP through its central directory. Supports STORED
 *  and DEFLATE entries; anything else throws. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localOff, true) !== 0x04034b50) throw new Error("Corrupt ZIP local header.");
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new XlsxUnsupportedError(`Unsupported ZIP compression method ${method}.`);
  }
  return out;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(el: Element): string {
  // Rich-text runs (<r><t>…</t></r>) split one cell across several <t>.
  return Array.from(el.getElementsByTagNameNS("*", "t"))
    .map((t) => t.textContent ?? "")
    .join("");
}

/** Read the FIRST worksheet of an .xlsx as a grid of strings. Handles our own
 *  stored files and files re-saved by Excel (deflate + shared strings). */
export async function readXlsxRows(bytes: Uint8Array): Promise<string[][]> {
  const files = await readZip(bytes);
  const dec = new TextDecoder();
  const parser = new DOMParser();

  const shared: string[] = [];
  const ss = files.get("xl/sharedStrings.xml");
  if (ss) {
    const doc = parser.parseFromString(dec.decode(ss), "application/xml");
    for (const si of Array.from(doc.getElementsByTagNameNS("*", "si"))) shared.push(textOf(si));
  }

  const sheetName =
    files.has("xl/worksheets/sheet1.xml")
      ? "xl/worksheets/sheet1.xml"
      : [...files.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k)).sort()[0];
  const sheet = sheetName ? files.get(sheetName) : undefined;
  if (!sheet) throw new Error("No worksheet found in this file.");

  const doc = parser.parseFromString(dec.decode(sheet), "application/xml");
  const rows: string[][] = [];
  for (const rowEl of Array.from(doc.getElementsByTagNameNS("*", "row"))) {
    const rAttr = Number(rowEl.getAttribute("r"));
    const rowIdx = Number.isFinite(rAttr) && rAttr > 0 ? rAttr - 1 : rows.length;
    const row: string[] = [];
    let next = 0;
    for (const c of Array.from(rowEl.getElementsByTagNameNS("*", "c"))) {
      const ref = c.getAttribute("r");
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const t = c.getAttribute("t");
      let value = "";
      if (t === "inlineStr") {
        const is = c.getElementsByTagNameNS("*", "is")[0];
        value = is ? textOf(is) : "";
      } else {
        const v = c.getElementsByTagNameNS("*", "v")[0]?.textContent ?? "";
        value = t === "s" ? (shared[Number(v)] ?? "") : v;
      }
      while (row.length < col) row.push("");
      row[col] = value;
    }
    while (rows.length < rowIdx) rows.push([]);
    rows[rowIdx] = row;
  }
  return rows;
}
