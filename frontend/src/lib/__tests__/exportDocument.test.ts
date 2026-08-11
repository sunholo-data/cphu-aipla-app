import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exportFilename,
  exportWriting,
  rtfEscape,
  serialiseWriting,
  toMarkdown,
  toPlainText,
  toRtf,
  type WritingExport,
} from "@/lib/exportDocument";

const DOC: WritingExport = {
  title: "Konklusion",
  activityTitle: "Bølger og resonans",
  groupCode: "sweet-bison-13",
  text: "Vi målte bølgelængden til 0,42 m.\n\nDet passer med teorien.",
  date: "2026-08-11",
};

describe("provenance header", () => {
  it("names the field, the activity, the group and the date in every format", () => {
    for (const format of ["txt", "md", "rtf"] as const) {
      const out = serialiseWriting(DOC, format);
      expect(out).toContain("Konklusion");
      expect(out).toContain("sweet-bison-13");
      expect(out).toContain("2026-08-11");
    }
  });

  it("omits the group line when there is no group code", () => {
    const out = toPlainText({ ...DOC, groupCode: "" });
    expect(out).not.toContain("Gruppe:");
    expect(out).toContain("Bølger og resonans");
  });

  it("falls back to a generic heading for an untitled field", () => {
    expect(toPlainText({ ...DOC, title: "" })).toContain("Tekst");
  });
});

describe("plain text + markdown", () => {
  it("keeps the student's text verbatim", () => {
    expect(toPlainText(DOC)).toContain(DOC.text);
    expect(toMarkdown(DOC)).toContain(DOC.text);
  });

  it("markdown uses a real heading so it renders as a document", () => {
    expect(toMarkdown(DOC)).toContain("# Konklusion");
  });
});

describe("RTF", () => {
  it("is well-formed: a version header and balanced braces", () => {
    const rtf = toRtf(DOC);
    expect(rtf.startsWith("{\\rtf1\\ansi")).toBe(true);
    expect(rtf.trimEnd().endsWith("}")).toBe(true);
    const opens = (rtf.match(/(?<!\\)\{/g) || []).length;
    const closes = (rtf.match(/(?<!\\)\}/g) || []).length;
    expect(opens).toBe(closes);
  });

  it("escapes Danish characters as signed UTF-16 with an ASCII fallback", () => {
    // The case that matters, and the one that turns into mojibake in Word if
    // the signedness is wrong. æ=230, ø=248, å=229 — all below 32767, so they
    // stay positive.
    expect(rtfEscape("æ")).toBe("\\u230?");
    expect(rtfEscape("ø")).toBe("\\u248?");
    expect(rtfEscape("å")).toBe("\\u229?");
    expect(rtfEscape("Æ Ø Å")).toBe("\\u198? \\u216? \\u197?");
  });

  it("escapes the three RTF control characters", () => {
    expect(rtfEscape("a\\b{c}d")).toBe("a\\\\b\\{c\\}d");
  });

  it("turns newlines into paragraph breaks, and drops CR", () => {
    expect(rtfEscape("a\nb")).toBe("a\\par\nb");
    expect(rtfEscape("a\r\nb")).toBe("a\\par\nb");
  });

  it("leaves ASCII alone", () => {
    expect(rtfEscape("Plain ASCII 123 .,!?")).toBe("Plain ASCII 123 .,!?");
  });

  it("emits both halves of a surrogate pair rather than one bad escape", () => {
    // An emoji is not expected in a physics conclusion, but a paste from a
    // phone can carry one, and a malformed escape corrupts the REST of the
    // document — not just the character.
    expect(rtfEscape("😀")).toBe("\\u-10179?\\u-8704?");
  });

  it("carries the student's Danish text through the whole document", () => {
    const rtf = toRtf({ ...DOC, text: "Vi målte bølgelængden" });
    expect(rtf).toContain("\\u229?"); // å in "målte"
    expect(rtf).toContain("\\u248?"); // ø in "bølgelængden"
    expect(rtf).not.toContain("å"); // nothing raw non-ASCII survives
  });
});

describe("filenames", () => {
  it("is recognisable in a downloads folder", () => {
    expect(exportFilename(DOC, "rtf")).toBe("bolger-og-resonans-konklusion-2026-08-11.rtf");
  });

  it("transliterates Danish rather than punching holes in the name", () => {
    // Collapsing æøå to separators would give "b-lger-og-resonans" — in a
    // product whose students write Danish.
    expect(exportFilename({ ...DOC, title: "Målinger", activityTitle: "Æblefald" }, "txt")).toBe(
      "aeblefald-malinger-2026-08-11.txt",
    );
  });

  it("still names the file when nothing is titled", () => {
    expect(exportFilename({ ...DOC, title: "", activityTitle: "" }, "txt")).toBe("2026-08-11.txt");
  });
});

describe("exportWriting", () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:stub");
    URL.revokeObjectURL = vi.fn();
  });

  it("downloads a blob with the format's MIME type", () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const created: Blob[] = [];
    vi.mocked(URL.createObjectURL).mockImplementation((b) => {
      created.push(b as Blob);
      return "blob:stub";
    });

    exportWriting(DOC, "rtf");

    expect(click).toHaveBeenCalledTimes(1);
    expect(created[0].type).toBe("application/rtf");
    click.mockRestore();
  });
});
