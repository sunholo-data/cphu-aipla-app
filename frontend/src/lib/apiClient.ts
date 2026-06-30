/**
 * CHOOSING BETWEEN THE TWO HELPERS (we get this wrong a lot — see CLAUDE.md
 * "Anonymous-Group Auth"):
 *   - `fetchWithAuth`        → STUDENT / anonymous-group token (`getIdToken`).
 *                              Use in student-facing surfaces (workspace, lessons, chat).
 *   - `fetchWithTeacherAuth` → TEACHER Firebase token (`getTeacherIdToken`).
 *                              Use in teacher-only surfaces (teacher/*).
 * A student calling `fetchWithTeacherAuth` sends a NULL token → backend 401.
 * For a DUAL-audience endpoint, let the caller pick — don't hardwire one.
 *
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

import { isAnonymousGroupAuthMode } from "@/lib/anonymousGroupAuth";
import { getIdToken, getTeacherIdToken } from "@/lib/firebase";
import { refreshGroupSession } from "@/lib/groupTokenClient";

function sendWithToken(
  input: RequestInfo | URL,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers, cache: "no-store" });
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getIdToken();
  const resp = await sendWithToken(input, init, token);
  // Reactive recovery for the anonymous-group (student) token: a 401 means the
  // token lapsed (or was rejected for clock skew) — trade it for a fresh one
  // and retry ONCE. If the refresh is terminal (code revoked/expired) it
  // returns no new token and we surface the original 401, which flips the
  // provider to `expired` (re-join UI). Prevents the lapsed-token 401 storm.
  // See groupTokenClient + the anonymous-group corner-case memory.
  if (resp.status === 401 && isAnonymousGroupAuthMode()) {
    const refreshed = await refreshGroupSession();
    if (refreshed?.token && refreshed.token !== token) {
      return sendWithToken(input, init, refreshed.token);
    }
  }
  return resp;
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
