/**
 * Human-friendly timestamps. Used for chat-message times (and reusable for the
 * insights strips, which currently each roll their own `formatRelative`).
 *
 * `formatRelativeTime` reads naturally and disambiguates across days — "just
 * now", "3 minutes ago", "yesterday", "3 days ago" — falling back to an
 * absolute short date past a week (so an old message shows "13 Jun", not "6
 * weeks ago"). Pair it with `formatAbsoluteTime` as a tooltip so the exact
 * moment is always one hover away.
 */

/** Normalise a Date | epoch-ms | epoch-seconds value to epoch milliseconds.
 *  Epoch seconds (~1.7e9 today) are auto-scaled; ms (~1.7e12) pass through. */
function toMillis(input: Date | number): number {
  if (input instanceof Date) return input.getTime();
  return input < 1e12 ? input * 1000 : input;
}

export function formatRelativeTime(input: Date | number, now: number = Date.now()): string {
  const ms = toMillis(input);
  if (Number.isNaN(ms)) return "";
  const diffSec = Math.round((now - ms) / 1000);

  // Future or sub-minute (incl. minor clock skew) → "just now".
  if (diffSec < 45) return "just now";

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const min = Math.round(diffSec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (day < 7) return rtf.format(-day, "day"); // "yesterday" / "3 days ago"

  // Older than a week: an absolute short date is more useful than "6 weeks ago".
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(ms);
}

/** Full, unambiguous timestamp for a tooltip — e.g. "13 Jun 2026, 15:42". */
export function formatAbsoluteTime(input: Date | number): string {
  const ms = toMillis(input);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(ms);
}
