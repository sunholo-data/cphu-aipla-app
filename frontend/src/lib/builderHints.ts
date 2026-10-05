// 1.1.151 — soft, non-blocking hints for the activity builder.
//
// Each check is deterministic and pure (no spellchecking, no model call): it
// looks at what the teacher typed and says when something is plainly worth a
// second look. A hint never blocks a save.

import type { Language } from "@/lib/teacherApi";

/** A hint the builder renders. `key` names the copy in `BuilderHints`. */
export type BuilderHint =
  | { kind: "languageLooksDanish" }
  | { kind: "languageLooksEnglish" };

/** What the language check reads. Kept structural so a test can pass a literal. */
export interface LanguageHintInput {
  language: Language;
  title: string;
  teachingGoal: string;
  /** Element labels the students see: table titles + column labels, checklist
   *  items, writing prompts — whatever carries the activity's own words. */
  labels: string[];
}

// Written as escapes so this file carries no Danish letters of its own.
const DANISH_LETTERS = /[æøåÆØÅ]/;
// Function words that are plainly one language and not the other. "en", "i",
// "man", "for" are deliberately absent: they are words in both.
const DANISH_WORDS = new Set([
  "og", "med", "er", "af", "til", "det", "ikke", "hvad", "hvordan", "hvorfor",
  "eleverne", "skal", "kan", "som", "der", "jeres", "deres", "vi", "jeg", "du", "fra", "om",
]);
const ENGLISH_WORDS = new Set([
  "the", "and", "of", "is", "are", "what", "how", "why", "with", "students",
  "your", "you", "this", "that", "will", "from", "which", "they",
]);

function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
}

function distinctHits(tokens: string[], vocabulary: Set<string>): number {
  return new Set(tokens.filter((w) => vocabulary.has(w))).size;
}

/**
 * F2c — the students' language looks wrong for the activity's own words.
 *
 * `en` with Danish words → "the title is in Danish, but students get an English
 * tutor". `da` with plainly English text → the reverse. A hint, not a guard:
 * KineBot is English for Danish students on purpose, and the activity's
 * language outranks the student's (1.1.63) — this only makes the value visible.
 */
export function languageHint(input: LanguageHintInput): BuilderHint | null {
  const text = [input.title, input.teachingGoal, ...input.labels].join(" ");
  if (!text.trim()) return null;
  const tokens = words(text);
  const danish = DANISH_LETTERS.test(text) || distinctHits(tokens, DANISH_WORDS) >= 2;
  if (input.language === "en") {
    return danish ? { kind: "languageLooksDanish" } : null;
  }
  const english = !DANISH_LETTERS.test(text) && distinctHits(tokens, DANISH_WORDS) === 0 && distinctHits(tokens, ENGLISH_WORDS) >= 3;
  return english ? { kind: "languageLooksEnglish" } : null;
}
