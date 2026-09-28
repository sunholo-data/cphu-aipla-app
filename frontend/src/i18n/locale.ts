// 1.1.108 — the locale vocabulary. Plain module (no React) so server code,
// tests and label helpers can use it without a client boundary.
//
// Language is DATA (rule M4.3): student surfaces take it from
// `activity.language`, never from `navigator.language`. There is no browser
// inference anywhere in this module, on purpose.

export const LOCALES = ["da", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Same default as the backend's `DEFAULT_ACTIVITY_LANGUAGE` — every existing
 *  activity is Danish unless a teacher said otherwise. */
export const DEFAULT_LOCALE: Locale = "da";

/** A surface that renders before any activity is known (the join page, a lesson
 *  picker whose activities disagree) shows both languages rather than guessing. */
export type LocaleMode = Locale | "bilingual";

/** Normalise whatever a payload carries (`"en"`, `"en-GB"`, `null`) to a Locale.
 *  Unknown or missing → the default, never an error. */
export function toLocale(lang: string | null | undefined): Locale {
  const l = lang?.toLowerCase() ?? "";
  if (l.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

/** The lesson picker's rule (1.1.108 audit item 2): one shared language → that
 *  language; mixed or empty → both. */
export function localeForActivities(langs: Array<string | null | undefined>): LocaleMode {
  if (langs.length === 0) return "bilingual";
  const set = new Set(langs.map(toLocale));
  return set.size === 1 ? [...set][0] : "bilingual";
}
