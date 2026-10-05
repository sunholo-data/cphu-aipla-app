import { describe, expect, it } from "vitest";

import { languageHint } from "@/lib/builderHints";

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
