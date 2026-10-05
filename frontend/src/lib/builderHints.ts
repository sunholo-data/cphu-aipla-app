// 1.1.151 — soft, non-blocking hints for the activity builder.
//
// Each check is deterministic and pure (no spellchecking, no model call): it
// looks at what the teacher typed and says when something is plainly worth a
// second look. A hint never blocks a save.

import type { Language } from "@/lib/teacherApi";

/** A hint the builder renders. `key` names the copy in `BuilderHints`. */
export type BuilderHint =
  | { kind: "languageLooksDanish" }
  | { kind: "languageLooksEnglish" }
  /** F9 — one table has two or more columns with the same label. `table` is
   *  its title ("" when it has none). */
  | { kind: "duplicateColumns"; table: string; labels: string[] }
  /** F9 — `count` tables have no title while the activity has more than one. */
  | { kind: "untitledTables"; count: number };

/** The slice of a table the F9 checks read. */
export interface TableHintInput {
  title: string;
  columns: { label: string }[];
}

/**
 * F9 — "hvorfor står der forsøg to gange under slip A?": a table had
 * "Forsøg 1" twice. Duplicate column labels within one table (compared
 * trimmed and case-insensitively; blanks ignored), and untitled tables when
 * there is more than one — the students' screen, and the tutor, cannot tell
 * them apart. Deterministic; no spellchecking.
 */
export function tableHints(tables: TableHintInput[]): BuilderHint[] {
  const hints: BuilderHint[] = [];
  for (const table of tables) {
    const seen = new Map<string, { label: string; n: number }>();
    for (const col of table.columns) {
      const label = col.label.trim();
      if (!label) continue;
      const key = label.toLocaleLowerCase();
      const entry = seen.get(key);
      if (entry) entry.n += 1;
      else seen.set(key, { label, n: 1 });
    }
    const dupes = Array.from(seen.values()).filter((e) => e.n > 1).map((e) => e.label);
    if (dupes.length) hints.push({ kind: "duplicateColumns", table: table.title.trim(), labels: dupes });
  }
  if (tables.length > 1) {
    const untitled = tables.filter((t) => !t.title.trim()).length;
    if (untitled) hints.push({ kind: "untitledTables", count: untitled });
  }
  return hints;
}

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
