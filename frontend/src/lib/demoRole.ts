/**
 * Demo-role helper (1.A teacher-mock-auth follow-up, 2026-05-26).
 *
 * The backend `AIPLA_TEACHER_MOCK_AUTH=1` bypass injects `is_teacher=True`
 * and the `role:teacher` group tag for every anon-group visitor — so
 * the lesson catalogue + access checks ALL behave as if the visitor
 * were a teacher. But visitors can choose between Student / Teacher
 * roles on the post-join role picker; the student view needs to scope
 * its UI to what a real anon-group student would see (no teacher-only
 * skills like `manage-class`).
 *
 * Solution: the role picker writes the chosen role to sessionStorage,
 * and the student/teacher surfaces read it to scope what they display.
 * The backend always returns the full teacher-tagged catalogue (because
 * the bypass is unconditional); the frontend filters client-side based
 * on this signal.
 *
 * Production (no bypass) doesn't use this helper meaningfully — the
 * backend's AccessControl evaluator does the gating, and the helper's
 * absence-of-stored-role just falls through to "show everything".
 */

const STORAGE_KEY = "aipla_demo_role";

export type DemoRole = "student" | "teacher";

/** Read the demo role chosen on the post-join picker. ``null`` when
 *  the user hasn't picked, or when sessionStorage is unavailable
 *  (server-side render). */
export function getDemoRole(): DemoRole | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    return v === "student" || v === "teacher" ? v : null;
  } catch {
    return null;
  }
}

/** Persist the demo role choice. Survives navigation across the same
 *  tab; cleared when the tab closes (sessionStorage semantics). */
export function setDemoRole(role: DemoRole): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, role);
  } catch {
    // sessionStorage blocked (incognito + 3rd-party cookies blocked
    // is the typical case). Fall back to in-memory; the user just
    // re-picks on reload.
  }
}
