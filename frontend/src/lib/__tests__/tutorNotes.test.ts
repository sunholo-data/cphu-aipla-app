import { describe, expect, it } from "vitest";

import { appendTutorNotes, formatNotesTimestamp, notesToPlainText } from "../tutorNotes";

describe("appendTutorNotes (1.1.151 F6)", () => {
  it("keeps the student's text and puts the notes after it, under the heading", () => {
    expect(appendTutorNotes("Min tekst.\n\n", "Noter fra tutoren", "Opsummering")).toBe(
      "Min tekst.\n\nNoter fra tutoren\nOpsummering",
    );
  });

  it("starts an empty document with the heading", () => {
    expect(appendTutorNotes("", "Noter", " Opsummering ")).toBe("Noter\nOpsummering");
  });

  it("never rewrites what the student wrote", () => {
    const own = "  Indrykket start *med stjerner* [og klammer](x)";
    expect(appendTutorNotes(own, "H", "n").startsWith(own)).toBe(true);
  });
});

describe("notesToPlainText", () => {
  it("turns tutor Markdown into prose a textarea can hold", () => {
    const md = "## Opsummering\n\n* **Energi** er _bevaret_\n+ Se [læreplanen](aitana://doc/d1/block/0)\n\n\n\nBrug `E = m g h`.";
    expect(notesToPlainText(md)).toBe("Opsummering\n\n- Energi er _bevaret_\n- Se læreplanen\n\nBrug E = m g h.");
  });

  it("leaves maths as written", () => {
    expect(notesToPlainText("Farten er $v = \\frac{s}{t}$.")).toBe("Farten er $v = \\frac{s}{t}$.");
  });

  it("keeps a single-asterisk emphasis's words", () => {
    expect(notesToPlainText("det er *vigtigt* her")).toBe("det er vigtigt her");
  });
});

describe("formatNotesTimestamp", () => {
  it("does not depend on the browser's locale", () => {
    expect(formatNotesTimestamp(new Date(2026, 9, 8, 9, 5))).toBe("08.10.2026 09:05");
  });
});
