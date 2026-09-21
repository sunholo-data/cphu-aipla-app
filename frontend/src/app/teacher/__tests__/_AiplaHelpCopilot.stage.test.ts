import { describe, expect, it } from "vitest";

import { stripStagePrefix } from "@/app/teacher/_AiplaHelpCopilot";

/** 1.1.124 M3 — the stage rides along as hidden context and never reaches the bubble. */
describe("stripStagePrefix", () => {
  it("removes the stage block and the whitespace after it", () => {
    expect(stripStagePrefix('[[stage]]{"stage":"demo_only","nextStep":"Create the class"}[[/stage]]\nHow do I start?')).toBe(
      "How do I start?",
    );
  });
  it("leaves an ordinary message alone", () => {
    expect(stripStagePrefix("Hvordan laver jeg en klasse?")).toBe("Hvordan laver jeg en klasse?");
  });
});
