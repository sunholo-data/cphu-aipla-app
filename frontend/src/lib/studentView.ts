/**
 * Student view (2026-11-09) — how the student's screen is arranged for an
 * activity. The teacher picks it in the activity editor; the student page reads
 * it from `/api/activity-configs/active`. Same content in every view; only the
 * arrangement changes.
 *
 *   chat      — today's layout: the tutor conversation leads, the workspace
 *               beside it on the right. The default, so every activity saved
 *               before the field existed renders exactly as it did.
 *   workbench — the work leads: the workspace on the left at about two thirds,
 *               the tutor in a narrower column on the right; on a phone the
 *               work tab opens first.
 *   photo     — for work done off-screen: one large take-or-choose-a-photo
 *               button above the composer and a large preview before sending.
 *               Switches the camera on even for a tutor whose skill does not
 *               opt into images (backend: `adk.multimodal.activity_takes_photos`).
 *
 * Mirrors `StudentView` in backend/db/models/activity_config.py. Lives here, not
 * in teacherApi, because the student page must not import the teacher client.
 */
export type StudentView = "chat" | "workbench" | "photo";

export const STUDENT_VIEWS: readonly StudentView[] = ["chat", "workbench", "photo"];

/** Anything the server sends that is not a known view reads as today's layout. */
export function parseStudentView(value: unknown): StudentView {
  return STUDENT_VIEWS.includes(value as StudentView) ? (value as StudentView) : "chat";
}

const VIEW_PREFIX = "aipla.studentView:";
const TAB_CHOSEN_PREFIX = "aipla.mobileTabChosen:";

/** The view this browser last saw for an activity, so a reload paints in it
 *  instead of jumping from today's layout once the config arrives. A
 *  convenience only: the server's answer always wins. */
export function recallStudentView(activityId: string | null | undefined): StudentView {
  if (!activityId) return "chat";
  try {
    return parseStudentView(window.sessionStorage.getItem(VIEW_PREFIX + activityId));
  } catch {
    return "chat"; // storage blocked / SSR
  }
}

export function rememberStudentView(activityId: string | null | undefined, view: StudentView): void {
  if (!activityId) return;
  try {
    window.sessionStorage.setItem(VIEW_PREFIX + activityId, view);
  } catch {
    // Remembering is a convenience; the layout still follows the server.
  }
}

/** Did the student pick a phone tab themselves? The work-first view opens on
 *  the work tab, but never takes the chat away from a student who chose it. */
export function studentChoseMobileTab(key: string): boolean {
  try {
    return window.sessionStorage.getItem(TAB_CHOSEN_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export function markMobileTabChosen(key: string): void {
  try {
    window.sessionStorage.setItem(TAB_CHOSEN_PREFIX + key, "1");
  } catch {
    // Not remembered; the tab still switches.
  }
}
