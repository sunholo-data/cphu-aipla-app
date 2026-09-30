import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  buildStoredZip,
  buildXlsx,
  columnLetter,
  crc32,
  readXlsxRows,
  readZip,
  xmlEscape,
} from "@/lib/xlsx";

const enc = new TextEncoder();
const dec = new TextDecoder();

/** An INDEPENDENT walk of the archive — local headers front to back, then the
 *  central directory — so the writer is not only checked against its own reader. */
function walkZip(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const locals: { name: string; crc: number; size: number; offset: number; data: Uint8Array }[] = [];
  let p = 0;
  while (v.getUint32(p, true) === 0x04034b50) {
    const crc = v.getUint32(p + 14, true);
    const comp = v.getUint32(p + 18, true);
    const size = v.getUint32(p + 22, true);
    expect(comp).toBe(size); // stored
    expect(v.getUint16(p + 8, true)).toBe(0); // method STORED
    const nameLen = v.getUint16(p + 26, true);
    const extra = v.getUint16(p + 28, true);
    const name = dec.decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extra;
    locals.push({ name, crc, size, offset: p, data: bytes.subarray(start, start + size) });
    p = start + size;
  }
  const cdStart = p;
  const central: { name: string; crc: number; offset: number }[] = [];
  while (v.getUint32(p, true) === 0x02014b50) {
    const nameLen = v.getUint16(p + 28, true);
    central.push({
      crc: v.getUint32(p + 16, true),
      offset: v.getUint32(p + 42, true),
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  expect(v.getUint32(p, true)).toBe(0x06054b50);
  expect(v.getUint16(p + 10, true)).toBe(locals.length);
  expect(v.getUint32(p + 12, true)).toBe(p - cdStart); // cd size
  expect(v.getUint32(p + 16, true)).toBe(cdStart); // cd offset
  expect(p + 22).toBe(bytes.length);
  return { locals, central };
}

/** A DEFLATE zip built the way Excel writes one, to exercise the import path. */
function deflatedZip(parts: [string, string][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, xml] of parts) {
    const raw = enc.encode(xml);
    const comp = new Uint8Array(deflateRawSync(raw));
    const n = enc.encode(name);
    const h = new Uint8Array(30 + n.length);
    const hv = new DataView(h.buffer);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(8, 8, true);
    hv.setUint32(14, crc32(raw), true);
    hv.setUint32(18, comp.length, true);
    hv.setUint32(22, raw.length, true);
    hv.setUint16(26, n.length, true);
    h.set(n, 30);
    const c = new Uint8Array(46 + n.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    c.set(n, 46);
    chunks.push(h, comp);
    central.push(c);
    offset += h.length + comp.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, eocd];
  const bytes = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    bytes.set(c, p);
    p += c.length;
  }
  return bytes;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("buildStoredZip", () => {
  it("writes consistent local headers, central directory and CRCs", () => {
    const bytes = buildStoredZip([
      { name: "a.txt", data: enc.encode("hello") },
      { name: "dir/b.xml", data: enc.encode("<x>æøå</x>") },
    ]);
    const { locals, central } = walkZip(bytes);
    expect(locals.map((l) => l.name)).toEqual(["a.txt", "dir/b.xml"]);
    expect(central.map((c) => c.name)).toEqual(["a.txt", "dir/b.xml"]);
    locals.forEach((l, i) => {
      expect(l.crc).toBe(crc32(l.data));
      expect(central[i].crc).toBe(l.crc);
      expect(central[i].offset).toBe(l.offset);
    });
    expect(dec.decode(locals[1].data)).toBe("<x>æøå</x>");
  });
});

describe("buildXlsx", () => {
  it("contains exactly the minimal parts, with inline strings", () => {
    const bytes = buildXlsx([["Code", "Names"], ["still-violin-61", "Søren & Åse <3"]], { sheetName: "Klasseliste" });
    const { locals } = walkZip(bytes);
    expect(locals.map((l) => l.name)).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/worksheets/sheet1.xml",
    ]);
    const sheet = dec.decode(locals[4].data);
    expect(sheet).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">Søren &amp; Åse &lt;3</t></is></c>',
    );
    expect(dec.decode(locals[2].data)).toContain('name="Klasseliste"');
    // Every part is well-formed XML.
    for (const l of locals) {
      const doc = new DOMParser().parseFromString(dec.decode(l.data), "application/xml");
      expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    }
  });

  it("round-trips through the reader, including blank rows and æøå", async () => {
    const rows = [
      ["Class list: 7B (2026-09-29)"],
      [],
      ["Code", "Join link", "Names", "Note"],
      ["a-b-1", "https://x/group?code=a-b-1", "Anna, Bø", ""],
    ];
    const back = await readXlsxRows(buildXlsx(rows));
    expect(back[0]).toEqual(["Class list: 7B (2026-09-29)"]);
    expect(back[1]).toEqual([]);
    expect(back[3].slice(0, 3)).toEqual(["a-b-1", "https://x/group?code=a-b-1", "Anna, Bø"]);
  });
});

describe("readXlsxRows — a file re-saved by Excel", () => {
  it("inflates deflated entries and resolves shared strings, incl. rich text", async () => {
    const bytes = deflatedZip([
      [
        "xl/sharedStrings.xml",
        '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Code</t></si><si><t>Names</t></si><si><r><t>Anna, </t></r><r><t>Bø</t></r></si></sst>',
      ],
      [
        "xl/worksheets/sheet1.xml",
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="3"><c r="A3" t="s"><v>0</v></c><c r="C3" t="s"><v>1</v></c></row><row r="4"><c r="A4" t="str"><v>a-b-1</v></c><c r="C4" t="s"><v>2</v></c></row></sheetData></worksheet>',
      ],
    ]);
    const files = await readZip(bytes);
    expect(files.size).toBe(2);
    const rows = await readXlsxRows(bytes);
    expect(rows[2]).toEqual(["Code", "", "Names"]);
    expect(rows[3]).toEqual(["a-b-1", "", "Anna, Bø"]);
  });
});

describe("helpers", () => {
  it("column letters", () => {
    expect([0, 1, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(["A", "B", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
  it("xmlEscape strips forbidden control characters", () => {
    expect(xmlEscape('a\u0001b"<')).toBe("ab&quot;&lt;");
  });
});
