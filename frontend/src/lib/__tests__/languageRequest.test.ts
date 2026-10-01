import { describe, expect, it } from "vitest";

import { detectLanguageRequest } from "@/lib/languageRequest";

// The requests are real student messages from prod, 29-30 Sep 2026.
describe("detectLanguageRequest", () => {
  it.each([
    "Can you repeat that in English?",
    "ENGLISH MOTHERFUCKER",
    "In english",
    "In english please",
    "please to it in English",
    "Can you write it in englisch?",
    "Please keep the language in English.",
    "I want to speak in Danish. No, I want, I mean, I want to speak in English.",
  ])("hears English in %j", (msg) => {
    expect(detectLanguageRequest(msg)).toBe("en");
  });

  it.each(["Kan du skrive på dansk?", "på dansk tak", "Danish please"])("hears Danish in %j", (msg) => {
    expect(detectLanguageRequest(msg)).toBe("da");
  });

  it.each([
    "I don't know",
    "ok",
    "It goes somewhere else",
    "Måske g - den har den højeste a-værdi!",
    // `eng` inside a word is not a request.
    "the length of the string matters",
  ])("hears nothing in %j", (msg) => {
    expect(detectLanguageRequest(msg)).toBeNull();
  });

  it("ignores a long answer that merely names a language", () => {
    const long =
      "The period depends on the length because a longer string means the bob travels further each swing, " +
      "and I looked up the English word for svingningstid which is period, so T grows with L.";
    expect(detectLanguageRequest(long)).toBeNull();
  });
});
