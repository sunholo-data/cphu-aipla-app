import { redirect } from "next/navigation";

/**
 * /teacher/insights — not a page of its own any more (UI sweep 2026-11-11).
 *
 * Insights opens on Lessons: the tabs put it first because a teacher's first
 * question after a lesson is "what did the class get?", and the main nav lands
 * there too. The cross-class table that used to live at this URL ("Overview")
 * is now "All classes" at `/teacher/insights/classes`.
 *
 * Old links keep working: a bare `/teacher/insights` goes to Lessons, and a
 * link that carried the Overview's own state (`?since=` / `?scope=`) was
 * plainly a link to the table, so it goes to All classes with that state.
 */
export default async function InsightsIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const keep = new URLSearchParams();
  for (const key of ["since", "scope"]) {
    const value = params[key];
    if (typeof value === "string" && value) keep.set(key, value);
  }
  const query = keep.toString();
  redirect(query ? `/teacher/insights/classes?${query}` : "/teacher/insights/lessons");
}
