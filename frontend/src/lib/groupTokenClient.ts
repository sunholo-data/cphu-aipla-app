/**
 * Group (anonymous-student) token reactive refresh — the recovery layer the
 * group JWT was missing (log triage 2026-06-30; 8th instance of the
 * anonymous-group corner case).
 *
 * The group token has its OWN lifecycle (a custom 8h JWT in sessionStorage),
 * separate from Firebase. Before this module, recovery was proactive-only (a
 * timer in `AnonymousGroupAuthProvider` at expiry−5min): if that timer missed
 * (laptop sleep / suspended tab), the token lapsed and EVERY request 401'd with
 * nothing to recover it — and the call-teacher poller hammered `/group/signal`
 * ~6×/min forever. Per-request Firebase fetchers don't have this problem
 * because they re-mint each call; the group token needed the equivalent.
 *
 * This module is the single, framework-agnostic refresh primitive used by:
 *   - `getIdToken()`   — proactively, when the stored token is at/near expiry,
 *                        so no request goes out with a dead token.
 *   - `fetchWithAuth()`— reactively, retrying once after a 401.
 *   - `AnonymousGroupAuthProvider` — subscribes via `onGroupSessionChange` to
 *                        keep its React state (and the `expired` re-join UI) in
 *                        sync with refreshes initiated outside React.
 *
 * It uses raw `fetch` (NOT `fetchWithAuth`) on purpose — `fetchWithAuth` calls
 * back into here on a 401, so routing through it would recurse.
 */

import {
  clearStoredGroupSession,
  isAnonymousGroupAuthMode,
  type PersistedGroupSession,
  readStoredGroupSessionRaw,
  writeStoredGroupSession,
} from "@/lib/anonymousGroupAuth";

const REFRESH_ENDPOINT = "/api/proxy/api/auth/group/refresh";

/**
 * Treat a token as "needs refresh" this many seconds before its hard expiry,
 * so `getIdToken` never hands out a token that dies mid-flight.
 */
export const GROUP_REFRESH_SKEW_SECONDS = 60;

type Listener = (session: PersistedGroupSession | null) => void;
const listeners = new Set<Listener>();

/**
 * Subscribe to group-session changes initiated by this module (a successful
 * refresh → the new session; a terminal failure → null). Returns an
 * unsubscribe fn. The provider uses this so refreshes triggered from the lib
 * layer still update React state + flip the UI to `expired` when terminal.
 */
export function onGroupSessionChange(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(session: PersistedGroupSession | null): void {
  for (const cb of [...listeners]) {
    try {
      cb(session);
    } catch {
      // A listener throwing must never break the refresh itself.
    }
  }
}

let inFlight: Promise<PersistedGroupSession | null> | null = null;

/**
 * Trade the stored (possibly expired) group token for a fresh one.
 *
 * - Concurrent callers share ONE network round-trip (in-flight dedup) — a wall
 *   of 401ing requests collapses into a single refresh.
 * - **200** → persist + notify listeners + return the new session.
 * - **401** → terminal (code revoked / 30-day code TTL elapsed): clear storage,
 *   notify `null`, return `null`. Only a fresh code recovers.
 * - **transient** (5xx / network error) → keep the existing session and return
 *   it unchanged, so a later trigger can retry.
 * - **no stored token** / not anon-group mode → `null` without a network call.
 */
export function refreshGroupSession(): Promise<PersistedGroupSession | null> {
  if (!isAnonymousGroupAuthMode()) return Promise.resolve(null);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const current = readStoredGroupSessionRaw();
    if (!current?.token) return null;
    try {
      const resp = await fetch(REFRESH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: current.token }),
        cache: "no-store",
      });
      if (resp.status === 401) {
        clearStoredGroupSession();
        emit(null);
        return null;
      }
      if (!resp.ok) return current; // transient — keep the token, retry later
      const data = (await resp.json()) as PersistedGroupSession;
      // Merge: server fields win, but client-only fields the refresh response
      // doesn't echo (group_code, class_name, class_id, skill_ids,
      // resumedSessionId) carry forward from the existing session.
      const next: PersistedGroupSession = { ...current, ...data };
      writeStoredGroupSession(next);
      emit(next);
      return next;
    } catch {
      return current; // network error — leave the session intact
    }
  })();

  return inFlight.finally(() => {
    inFlight = null;
  });
}
