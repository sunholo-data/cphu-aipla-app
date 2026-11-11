/**
 * The class page's three views (UI sweep 2026-11, approved by M 2026-11-11):
 * Lektion (in class now), Efter lektionen (reading it back), Opsætning (setup).
 * Kept in the URL as `?tab=` so refresh, Back and a shared link land there.
 */

export const CLASS_TABS = ["lesson", "after", "setup"] as const;
export type ClassTab = (typeof CLASS_TABS)[number];

/** Mirrors `LIVE_WINDOW_S` in backend/analytics/live_class.py (90 min): a group
 *  quiet longer than this is a past session, not "live now". The same window
 *  the live view and its summary already use, so "open on Lektion" and "this
 *  group shows a live status" can never disagree. */
export const LIVE_WINDOW_MS = 90 * 60 * 1000;

/**
 * Which view a teacher lands on when the link names none.
 *
 *   - a group active in the last 90 min → Lektion (the lesson is on now);
 *   - otherwise, the class has had a lesson → Efter lektionen;
 *   - otherwise → Opsætning (a new class: there is nothing to read yet).
 *
 * `sessions` null means the read FAILED. That is not "no lesson": open on
 * Lektion, which lists every group from the class itself and does not depend
 * on the failed read, rather than on Opsætning as if the class were new.
 */
export function pickDefaultClassTab({
  now,
  sessions,
  liveGroupCount = 0,
}: {
  now: number;
  sessions: ReadonlyArray<{ lastMessageAt: string }> | null;
  liveGroupCount?: number;
}): ClassTab {
  if (liveGroupCount > 0) return "lesson";
  if (sessions === null) return "lesson";
  const recent = sessions.some((s) => {
    const at = Date.parse(s.lastMessageAt);
    return !Number.isNaN(at) && now - at <= LIVE_WINDOW_MS;
  });
  if (recent) return "lesson";
  if (sessions.length > 0) return "after";
  return "setup";
}
