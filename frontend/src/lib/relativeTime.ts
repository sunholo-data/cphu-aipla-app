/**
 * Human-friendly timestamps. Used for chat-message times (and reusable for the
 * insights strips, which currently each roll their own `formatRelative`).
 *
 * `formatRelativeTime` reads naturally and disambiguates across days — "just
 * now", "3 minutes ago", "yesterday", "3 days ago" — falling back to an
 * absolute short date past a week (so an old message shows "13 Jun", not "6
 * weeks ago"). Pair it with `formatAbsoluteTime` as a tooltip so the exact
 * moment is always one hover away.
 *
 * 1.1.108 (rule M4.3): the language is an ARGUMENT, never the browser's.
 * `Intl.*Format(undefined)` used the browser locale, so a Danish activity on an
 * English laptop said "3 hours ago" beside Danish chrome. Student surfaces pass
 * the activity's locale (`useLocaleMode()`); the default is the platform's.
 */

import { DEFAULT_LOCALE, type Locale } from "@/i18n/locale";

/** BCP-47 tag per product locale. en-GB, not en-US: day-before-month ("13 Jun")
 *  is what the English UI already showed and what a European reader expects. */
const INTL_TAG: Record<Locale, string> = { da: "da-DK", en: "en-GB" };

const JUST_NOW: Record<Locale, string> = { da: "lige nu", en: "just now" };

/** Normalise a Date | ISO string | epoch-ms | epoch-seconds value to epoch
 *  milliseconds. Epoch seconds (~1.7e9 today) are auto-scaled; ms (~1.7e12)
 *  pass through; ISO strings are parsed (most callers store ISO timestamps). */
function toMillis(input: Date | number | string): number {
  if (input instanceof Date) return input.getTime();
  if (typeof input === "string") return new Date(input).getTime();
  return input < 1e12 ? input * 1000 : input;
}

export function formatRelativeTime(
  input: Date | number | string,
  now: number = Date.now(),
  locale: Locale = DEFAULT_LOCALE,
): string {
  const ms = toMillis(input);
  if (Number.isNaN(ms)) return "";
  const diffSec = Math.round((now - ms) / 1000);

  // Future or sub-minute (incl. minor clock skew) → "just now".
  if (diffSec < 45) return JUST_NOW[locale];

  const rtf = new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: "auto" });
  const min = Math.round(diffSec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 7) return rtf.format(-day, "day"); // "yesterday" / "3 days ago"

  // Older than a week: an absolute short date is more useful than "6 weeks ago".
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(ms);
}

/** Compact relative time for tight surfaces (chat session lists): "just now",
 *  "5m ago", "3h ago", "2d ago". No >1-week absolute fallback — these lists
 *  only ever show recent sessions, and the column is narrow.
 *
 *  locale: en-only, by decision (1.1.108 rule M4.2) — its only callers are the
 *  document-UI session lists, which students never see (`showDocumentUI` is off
 *  in anonymous-group mode). Give it a locale when a student surface needs it. */
export function formatRelativeTimeCompact(
  input: Date | number | string,
  now: number = Date.now(),
): string {
  const ms = toMillis(input);
  if (Number.isNaN(ms)) return "";
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Full, unambiguous timestamp for a tooltip — e.g. "13 Jun 2026, 15:42". */
export function formatAbsoluteTime(input: Date | number | string, locale: Locale = DEFAULT_LOCALE): string {
  const ms = toMillis(input);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(INTL_TAG[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}
