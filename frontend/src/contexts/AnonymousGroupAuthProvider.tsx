"use client";

/**
 * AnonymousGroupAuthProvider — fourth auth mode (sprint 2.11, M3).
 *
 * Mounts when `NEXT_PUBLIC_AUTH_MODE=anonymous_group_id`. Wraps the
 * short-code session-join flow:
 *
 *   1. User lands on `/group` and types a code.
 *   2. ``join(code)`` POSTs to ``/api/proxy/api/auth/group/join``.
 *   3. On success: token + uid + expires_at land in sessionStorage;
 *      provider transitions to ``joined`` state and exposes a
 *      Firebase-User-shaped object so downstream consumers
 *      (``useAuth().user``) don't have to branch on mode.
 *   4. On 401 from any downstream call (e.g. revocation),
 *      ``markExpired()`` flips to ``expired`` so the UI can offer
 *      a "ask your teacher for a new code" path.
 *
 * State machine: idle → joining → joined → expired → idle (on clear).
 *
 * Storage: ``sessionStorage`` (NOT localStorage). Closing the tab
 * discards the session — intentional for anonymous deployments.
 *
 * The provider doesn't import the platform's main ``AuthProvider``;
 * it's selected by ``AuthContext.tsx`` based on the env var. Tests
 * mount it directly.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  clearStoredGroupSession,
  normalizeGroupCode,
  type PersistedGroupSession,
  readStoredGroupSession,
  writeStoredGroupSession,
} from "@/lib/anonymousGroupAuth";
import { onGroupSessionChange } from "@/lib/groupTokenClient";

/** Renew the group token this many seconds before it expires. The token
 * lives 8h server-side; we renew ~5 min early so an in-flight request never
 * races the expiry boundary. */
const REFRESH_SKEW_SECONDS = 5 * 60;

// ─── Public types ───────────────────────────────────────────────────────────

export type GroupAuthStatus = "idle" | "joining" | "joined" | "expired";

export type GroupAuthError =
  | { kind: "unknown_or_revoked"; message: string }
  | { kind: "rate_limited"; message: string; retryAfterSeconds: number }
  | { kind: "at_capacity"; message: string }
  | { kind: "network"; message: string };

/** Shape returned to UI consumers — mirrors `useAuth().user` so the
 * chat-page render tree doesn't branch on auth mode. */
export interface GroupAuthUser {
  uid: string;
  email: ""; // explicit empty — no PII
  displayName: null;
  photoURL: null;
}

export interface AnonymousGroupAuthContextValue {
  status: GroupAuthStatus;
  /** False until the mount effect has looked in sessionStorage; true forever
   *  after, whether or not a session was found.
   *
   *  Load-bearing, not informational. `status: "idle"` cannot answer "is there
   *  a session?" because it means BOTH "not looked yet" and "looked, nothing
   *  there" — and a consumer that treats the first as the second concludes the
   *  student is signed out and acts on it. See the note on `loading` in
   *  `AuthContext`'s AnonymousGroupAuthAdapter for the bug that caused. */
  hydrated: boolean;
  user: GroupAuthUser | null;
  token: string | null;
  expiresAt: number | null;
  /** The group code the student joined with (e.g. "ABCD-1234").
   * Null for sessions stored before 2026-06-01 or before joining. */
  groupCode: string | null;
  /** Skills the group has permission to invoke. Empty array = no
   * filter (back-compat with sessions stored before 2026-05-20).
   * Consumers (e.g. useUserSkills) use this to scope UI surfaces
   * that would otherwise show the full platform marketplace. */
  skillIds: string[];
  /** Human-readable class name (e.g. "Hold 9A"). Null for unbound codes. */
  className: string | null;
  /** Firestore class_id for the bound class. Null for unbound codes. */
  classId: string | null;
  error: GroupAuthError | null;
  join: (groupCode: string) => Promise<void>;
  markExpired: () => void;
  clearStoredToken: () => void;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function userFromSession(session: PersistedGroupSession): GroupAuthUser {
  return {
    uid: session.uid,
    email: "",
    displayName: null,
    photoURL: null,
  };
}

function classifyError(status: number, body: { detail?: string } | null): GroupAuthError {
  if (status === 429) {
    const detail = body?.detail ?? "rate limit exceeded";
    // Backend includes "retry after Ns" in the detail; extract.
    const match = /retry after (\d+)\s*s/i.exec(detail);
    return {
      kind: "rate_limited",
      message: detail,
      retryAfterSeconds: match ? Number(match[1]) : 60,
    };
  }
  if (status === 503) {
    return { kind: "at_capacity", message: body?.detail ?? "group at capacity" };
  }
  if (status === 401) {
    return {
      kind: "unknown_or_revoked",
      message: body?.detail ?? "group not found or no longer active",
    };
  }
  return {
    kind: "network",
    message: body?.detail ?? `request failed (${status})`,
  };
}

// ─── Context ────────────────────────────────────────────────────────────────

const AnonymousGroupAuthContext = createContext<AnonymousGroupAuthContextValue | null>(
  null,
);

export function AnonymousGroupAuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GroupAuthStatus>("idle");
  const [session, setSession] = useState<PersistedGroupSession | null>(null);
  const [error, setError] = useState<GroupAuthError | null>(null);
  // False for the first render (server AND client, so no hydration mismatch);
  // true once the effect below has run. See the `hydrated` doc comment.
  const [hydrated, setHydrated] = useState(false);
  // Guards against overlapping refreshes (timer + visibilitychange can both
  // fire near expiry).
  const refreshingRef = useRef(false);

  // Re-hydrate from sessionStorage on first mount (e.g. page refresh in
  // the same tab — token is still valid until expires_at).
  useEffect(() => {
    const stored = readStoredGroupSession();
    if (stored) {
      setSession(stored);
      setStatus("joined");
    }
    // Unconditional: "we looked" is the fact consumers need, and it is just as
    // true when the drawer was empty. Setting it only in the `stored` branch
    // would leave a genuinely-signed-out student permanently "still loading".
    setHydrated(true);
  }, []);

  // Stay in sync with refreshes initiated OUTSIDE React — the lib layer
  // (`getIdToken` / `fetchWithAuth` via `groupTokenClient.refreshGroupSession`)
  // can mint a fresh token or discover the code is terminally revoked. A new
  // session → reflect it (resets the proactive-refresh timer below); null →
  // flip to `expired` so the re-join UI shows. This is what wires the
  // long-documented "joined → expired on a 401 from any downstream fetch".
  useEffect(() => {
    return onGroupSessionChange((next) => {
      if (next) {
        setSession(next);
        setStatus("joined");
      } else {
        setStatus("expired");
      }
    });
  }, []);

  const join = useCallback(async (groupCode: string) => {
    const code = normalizeGroupCode(groupCode);
    if (!code) {
      const e: GroupAuthError = {
        kind: "unknown_or_revoked",
        message: "Please enter a group code.",
      };
      setError(e);
      throw new Error(e.message);
    }
    setStatus("joining");
    setError(null);
    try {
      const resp = await fetch("/api/proxy/api/auth/group/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group_id: code }),
      });
      if (!resp.ok) {
        let body: { detail?: string } | null = null;
        try {
          body = (await resp.json()) as { detail?: string };
        } catch {
          // Body wasn't JSON — fall through with null.
        }
        const e = classifyError(resp.status, body);
        setError(e);
        setStatus("idle");
        throw new Error(e.message);
      }
      const data = (await resp.json()) as PersistedGroupSession;
      const sessionWithCode: PersistedGroupSession = { ...data, group_code: code };
      writeStoredGroupSession(sessionWithCode);
      setSession(sessionWithCode);
      setStatus("joined");
    } catch (err) {
      if (status === "joining") {
        // network-level failure — surface generically.
        const e: GroupAuthError =
          error ?? {
            kind: "network",
            message: err instanceof Error ? err.message : String(err),
          };
        setError(e);
        setStatus("idle");
      }
      throw err;
    }
  }, [status, error]);

  const markExpired = useCallback(() => {
    setStatus("expired");
  }, []);

  // Silent token renewal. Trades the current (possibly already-expired) token
  // for a fresh one via the stored group code's still-valid backend record —
  // no re-join, no new identity (the group uid is deterministic). This is the
  // fix for "student leaves a tab open across a laptop sleep, token goes stale,
  // every call 401s". See backend refresh_group_token.
  const refresh = useCallback(async (): Promise<void> => {
    const current = session;
    if (!current?.token || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const resp = await fetch("/api/proxy/api/auth/group/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: current.token }),
      });
      if (resp.status === 401) {
        // The code itself is revoked/expired — only a fresh code recovers.
        setStatus("expired");
        return;
      }
      if (!resp.ok) return; // transient (5xx) — keep the old token, retry later
      const data = (await resp.json()) as PersistedGroupSession;
      // The refresh response doesn't echo group_code; carry it forward (it's
      // the durable credential the UI shows + we re-use).
      const next: PersistedGroupSession = {
        ...data,
        group_code: current.group_code ?? null,
      };
      writeStoredGroupSession(next);
      setSession(next);
    } catch {
      // Network error — leave the session intact; a later trigger retries.
    } finally {
      refreshingRef.current = false;
    }
  }, [session]);

  // Proactively renew before expiry. Two triggers because a setTimeout alone
  // is unreliable across a laptop sleep (suspended timers fire late or not at
  // all): (1) a timer ~5 min before expiry for the always-awake case; (2) tab
  // regaining visibility, which re-checks the skew window on wake.
  useEffect(() => {
    if (status !== "joined" || !session?.expires_at) return;

    const fireAt = session.expires_at * 1000 - REFRESH_SKEW_SECONDS * 1000;
    const timer = setTimeout(() => void refresh(), Math.max(0, fireAt - Date.now()));

    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() >= fireAt) {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, session?.expires_at, refresh]);

  const clearStoredToken = useCallback(() => {
    clearStoredGroupSession();
    setSession(null);
    setError(null);
    setStatus("idle");
  }, []);

  const value: AnonymousGroupAuthContextValue = {
    status,
    hydrated,
    user: session ? userFromSession(session) : null,
    token: session?.token ?? null,
    expiresAt: session?.expires_at ?? null,
    groupCode: session?.group_code ?? null,
    skillIds: session?.skill_ids ?? [],
    className: session?.class_name ?? null,
    classId: session?.class_id ?? null,
    error,
    join,
    markExpired,
    clearStoredToken,
  };

  return (
    <AnonymousGroupAuthContext.Provider value={value}>
      {children}
    </AnonymousGroupAuthContext.Provider>
  );
}

export function useAnonymousGroupAuth(): AnonymousGroupAuthContextValue {
  const ctx = useContext(AnonymousGroupAuthContext);
  if (!ctx) {
    throw new Error(
      "useAnonymousGroupAuth must be used within an AnonymousGroupAuthProvider",
    );
  }
  return ctx;
}
