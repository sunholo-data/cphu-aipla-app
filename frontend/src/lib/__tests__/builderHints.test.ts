import { describe, expect, it } from "vitest";

import { languageHint, tableHints } from "@/lib/builderHints";

// 1.1.151 F9 — "hvorfor står der forsøg to gange under slip A?"
describe("tableHints", () => {
  const col = (label: string) => ({ label });

  it("flags a duplicate column label within one table (trimmed, case-insensitive)", () => {
    expect(tableHints([{ title: "Slip A", columns: [col("Forsøg 1"), col(" forsøg 1"), col("Højde")] }])).toEqual([
      { kind: "duplicateColumns", table: "Slip A", labels: ["Forsøg 1"] },
    ]);
  });

  it("does not compare labels ACROSS tables, and ignores blank labels", () => {
    expect(
      tableHints([
        { title: "A", columns: [col("Tid"), col(""), col("")] },
        { title: "B", columns: [col("Tid")] },
      ]),
    ).toEqual([]);
  });

  it("flags untitled tables only when there is more than one table", () => {
    expect(tableHints([{ title: "", columns: [col("x")] }])).toEqual([]);
    expect(
      tableHints([
        { title: "", columns: [col("x")] },
        { title: " ", columns: [col("y")] },
        { title: "Målinger", columns: [col("z")] },
      ]),
    ).toEqual([{ kind: "untitledTables", count: 2 }]);
  });
});

// 1.1.151 F2c — two activities of a Danish class were set to English. The
// students wrote Danish; the tutor answered English every turn, as told. A hint,
// not a guard (KineBot is English for Danish students on purpose).

describe("languageHint", () => {
  it("flags an English activity whose labels are Danish (the seminar case)", () => {
    expect(
      languageHint({
        language: "en",
        title: "Termisk og kemisk energi med simulering",
        teachingGoal: "",
        labels: ["Målte værdier", "Vandets masse"],
      }),
    ).toEqual({ kind: "languageLooksDanish" });
  });

  it("flags æ/ø/å alone", () => {
    expect(languageHint({ language: "en", title: "Bølger", teachingGoal: "", labels: [] })).toEqual({
      kind: "languageLooksDanish",
    });
  });

  it("is silent for an English activity in English (KineBot)", () => {
    expect(
      languageHint({
        language: "en",
        title: "KineBot: motion graphs",
        teachingGoal: "Students explain how the velocity graph follows from the position graph.",
        labels: ["Time", "Position"],
      }),
    ).toBeNull();
  });

  it("flags a Danish activity whose text is plainly English", () => {
    expect(
      languageHint({
        language: "da",
        title: "Energy in the kettle",
        teachingGoal: "Students explain what happens to the energy and how they know.",
        labels: [],
      }),
    ).toEqual({ kind: "languageLooksEnglish" });
  });

  it("is silent for a Danish activity in Danish, and for an empty one", () => {
    expect(
      languageHint({ language: "da", title: "Den hoppende bold", teachingGoal: "Eleverne undersøger", labels: [] }),
    ).toBeNull();
    expect(languageHint({ language: "en", title: "", teachingGoal: "", labels: [] })).toBeNull();
  });
});
