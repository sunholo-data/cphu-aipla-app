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

// ---------------------------------------------------------------------------
// The first-paint language of an activity chat.
//
// The chat page learns `activity.language` from the config fetch, a moment
// after first paint — and until 2026-09-29 it fell back to the skill's voice
// language meanwhile, which (fetched without the activity) is Danish. On a cold
// start an English activity showed Danish chrome for several seconds, verified
// on deployed dev. The lesson picker already knows every activity's language,
// so it leaves a note here and the chat page reads it before its fetch lands.
//
// sessionStorage, because this is a per-tab convenience: the config fetch is
// still the source of truth and overwrites it. Every access is guarded —
// storage can be absent or throw (private windows, blocked site data).

const ACTIVITY_LANGUAGE_KEY = "aipla.activityLanguage";

function readActivityLanguages(): Record<string, Locale> {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(ACTIVITY_LANGUAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Locale>) : {};
  } catch {
    return {};
  }
}

/** Remember activities' languages for the next chat page's first paint. */
export function rememberActivityLanguages(entries: Array<[string, string | null | undefined]>): void {
  if (entries.length === 0) return;
  try {
    const map = readActivityLanguages();
    for (const [id, lang] of entries) map[id] = toLocale(lang);
    sessionStorage.setItem(ACTIVITY_LANGUAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable — the chat page falls back as before */
  }
}

/** The remembered language of one activity, or null when nothing is known. */
export function recallActivityLanguage(activityId: string | null | undefined): Locale | null {
  if (!activityId) return null;
  return readActivityLanguages()[activityId] ?? null;
}
