import type { Locale } from "@/i18n/locale";

// A student asking for a language IN THE CHAT ("in English", "på dansk") is
// treated as pressing the DA | EN switch (2026-09-30).
//
// Why not leave it to the tutor: on prod 29-30 Sep students typed "in English"
// in 9 of 13 sessions and the tutor drifted back to Danish on a later short
// reply. A prompt rule to "follow a requested language" held in one test run on
// test and failed in the next — the request scrolls back while everything else
// in the context stays Danish. The switch is deterministic: the screen, the
// tutor's instruction and the voice all change together and stay changed.
//
// Deliberately narrow: only a SHORT message, so a long answer that happens to
// mention "the English word for…" does not flip anything. When both languages
// are named ("I want Danish. No, I mean English."), the last one wins.

const MAX_REQUEST_CHARS = 160;
const PATTERNS: Array<[Locale, RegExp]> = [
  ["en", /\b(english|englisch|engelsk|engelska|eng)\b/gi],
  ["da", /\b(danish|dansk|danske|dänisch)\b/gi],
];

export function detectLanguageRequest(text: string): Locale | null {
  const t = text.trim();
  if (!t || t.length > MAX_REQUEST_CHARS) return null;
  let best: { locale: Locale; at: number } | null = null;
  for (const [locale, re] of PATTERNS) {
    for (const m of t.matchAll(re)) {
      if (!best || (m.index ?? 0) > best.at) best = { locale, at: m.index ?? 0 };
    }
  }
  return best?.locale ?? null;
}
