import type { Locale } from "@/i18n/locale";

const INTL_TAG: Record<Locale, string> = { da: "da-DK", en: "en-GB" };

/**
 * A lesson's day ("YYYY-MM-DD", a Copenhagen calendar day) as "onsdag 11. nov."
 * / "Wednesday 11 Nov" — teachers recall lessons by weekday, not by ISO date
 * (UI sweep 2026-11-11).
 *
 * Built from the parts, not `new Date(iso)`: that parses a bare date as UTC
 * midnight, which is the previous day anywhere west of UTC. Anything that is
 * not a bare date comes back unchanged rather than as "Invalid Date".
 */
export function formatLessonDay(date: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Intl.DateTimeFormat(INTL_TAG[locale], { weekday: "long", day: "numeric", month: "short" }).format(day);
}
