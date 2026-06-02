/**
 * `fetchWithAuth` — thin wrapper around `fetch` that attaches the current
 * Firebase ID token as `Authorization: Bearer <jwt>` so the backend's
 * `Depends(get_current_user)` can verify it.
 *
 * Callers should pass paths relative to the Next app (e.g. `/api/proxy/api/
 * skills`), not absolute backend URLs — the Next catch-all at
 * `app/api/proxy/[...path]/route.ts` then forwards to the sidecar with the
 * header preserved.
 *
 * If no user is signed in, the request is still sent (without the header);
 * the backend decides whether the route is public. This keeps callers simple
 * — they don't need to branch on "am I signed in yet?" before every request.
 */

import { getIdToken, getTeacherIdToken } from "@/lib/firebase";

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getIdToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers, cache: "no-store" });
}

/**
 * Like `fetchWithAuth` but always uses the Firebase teacher token.
 * Use this for all `/api/classes/*` and other teacher-only API calls so
 * the request carries a real Firebase ID token rather than the student's
 * anonymous-group token (which would fail the backend's `is_teacher` gate).
 */
export async function fetchWithTeacherAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getTeacherIdToken();
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers, cache: "no-store" });
}
