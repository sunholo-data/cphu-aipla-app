import { describe, expect, it } from "vitest";

import { UTF8_BOM, parseCsv, toCsv } from "@/lib/download";

describe("toCsv (1.1.137 M0 — Danish Excel)", () => {
  it("starts with a UTF-8 BOM so æøå survive Excel's default decoding", () => {
    const csv = toCsv([["name"], ["Søren"]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe(`${UTF8_BOM}name\r\nSøren`);
    const bytes = new TextEncoder().encode(csv);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("still quotes per RFC 4180", () => {
    expect(toCsv([["a,b", 'say "hi"', null]])).toBe(`${UTF8_BOM}"a,b","say ""hi""",`);
  });
});

describe("parseCsv", () => {
  it("round-trips toCsv output, BOM stripped", () => {
    const rows = [
      ["Code", "Names"],
      ["a-b-1", "Anna, Bo"],
      ["c-d-2", 'He said "ok"\nnext line'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it("detects the semicolon separator Danish Excel writes, despite commas in names", () => {
    const text =
      "Klasseliste: 7B\r\n\r\nKode;Link;Navne;Note\r\na-b-1;x;Anna, Bo, Carl, Dan;\r\nc-d-2;y;Eva;hej\r\n";
    const rows = parseCsv(text);
    expect(rows[2]).toEqual(["Kode", "Link", "Navne", "Note"]);
    expect(rows[3]).toEqual(["a-b-1", "x", "Anna, Bo, Carl, Dan", ""]);
    expect(rows[4]).toEqual(["c-d-2", "y", "Eva", "hej"]);
  });

  it("reads tab-separated text", () => {
    expect(parseCsv("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });
});
