// Workshop W5c — AG-UI: The Frontend Provider
// We use @ag-ui/client directly instead of wrapping in <CopilotKit>. CopilotKit's
// `runtimeUrl` expects a GraphQL CopilotKit-Runtime endpoint, not a bare AG-UI SSE
// stream. Going AG-UI-native keeps the stack one layer thinner and avoids silent
// failures where 200 OK masked every message being dropped at the GraphQL layer.
// See memory: gotcha_copilotkit_not_agui_native.md for the full incident.

"use client";

import { HttpAgent } from "@ag-ui/client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getTeacherIdToken, subscribeToAuthState, subscribeToIdToken, type User } from "@/lib/firebase";
import { isLocalMode, LOCAL_MODE_WORKSHOP_USER } from "@/lib/localMode";

/**
 * AG-UI-native provider. Exposes one `HttpAgent` per `skillId`, targeting the
 * backend's SSE endpoint via the Next `/api/proxy` forwarder. The provider
 * rebuilds the agent when the refreshed Firebase ID token changes, so the
 * next `runAgent()` carries a fresh `Authorization: Bearer …` header that the
 * backend's `Depends(get_current_user)` can verify.
 *
 * We intentionally skip CopilotKit's `<CopilotKit>` provider here: its
 * `runtimeUrl` is a CopilotKit-Runtime GraphQL endpoint, not a bare AG-UI
 * SSE one. Going AG-UI-native with `@ag-ui/client` keeps the protocol stack
 * one layer thinner and matches the design doc's "thin client, fat protocol"
 * framing. If we later adopt `<CopilotChat>` for off-the-shelf UI polish,
 * we'll wrap it here alongside — not in place of — this context.
 */
const AGUIAgentContext = createContext<HttpAgent | null>(null);

export function AGUIProvider({
  skillId,
  sessionId,
  useTeacherAuth = false,
  children,
}: {
  skillId: string;
  /** Resume an existing chat by seeding the HttpAgent's threadId. When
   * absent, the agent generates a fresh UUID — that becomes the new
   * session id, which the page should then write to the URL. */
  sessionId?: string;
  /**
   * When true, mint the Authorization token via `getTeacherIdToken()`
   * (Firebase) instead of `useAuth().getIdToken()` (auth-context).
   * Required for teacher-only chat surfaces (`/teacher/analytics`)
   * because the dev frontend ships with
   * `NEXT_PUBLIC_AUTH_MODE=anonymous_group_id` — in that mode the
   * auth-context's `getIdToken` returns the *group* token instead of
   * the teacher's Firebase token. The group token is_teacher=False
   * and lacks the `role:teacher` group_tag, so any tagged-teacher
   * skill (analytics-chat) reads as 404 "Skill not found" via the
   * deliberate access-leak collapse. Caught 2026-06-03.
   */
  useTeacherAuth?: boolean;
  children: ReactNode;
}) {
  const groupAuth = useAuth();

  // In `useTeacherAuth` mode, `useAuth()` is the WRONG auth source: on the
  // deployed app it's the anonymous-GROUP context, and a teacher has no group
  // session → `groupAuth.user` is null. The token effect below short-circuits
  // at `if (!user)` and NEVER calls `getTeacherIdToken()`, so the agent runs
  // with no Authorization header → stream POST 401 'Missing Authorization
  // header'. (Re-found 2026-06-16 on /teacher/analytics — the 2026-06-03 fix
  // gated on `user`, but for a teacher that user comes from the group context
  // and is permanently null.) So when useTeacherAuth is set, track the Firebase
  // teacher's auth state DIRECTLY and gate on that. We can't call the
  // `useTeacherAuth()` hook here — it redirects to /teacher/sign-in as a side
  // effect, which would be wrong for the student path.
  const [teacherUser, setTeacherUser] = useState<User | null>(null);
  const [teacherLoading, setTeacherLoading] = useState<boolean>(true);
  useEffect(() => {
    if (!useTeacherAuth) return undefined;
    if (isLocalMode()) {
      setTeacherUser(LOCAL_MODE_WORKSHOP_USER as unknown as User);
      setTeacherLoading(false);
      return undefined;
    }
    return subscribeToAuthState((u) => {
      setTeacherUser(u);
      setTeacherLoading(false);
    });
  }, [useTeacherAuth]);

  const user = useTeacherAuth ? teacherUser : groupAuth.user;
  const authLoading = useTeacherAuth ? teacherLoading : groupAuth.loading;
  const getIdToken = groupAuth.getIdToken;
  const [token, setToken] = useState<string | null>(null);
  const [tokenResolved, setTokenResolved] = useState<boolean>(false);

  // Tracks whether we've EVER resolved a non-null token in this provider's
  // lifetime. Used to suppress the children-unmount cycle on token REFRESH
  // (silent ~hourly Firebase ID-token rotation + every onAuthStateChanged
  // fire). Before this ref existed, every `user`-reference change blanked
  // `tokenResolved` and the render gate below returned null — unmounting
  // the entire subtree, which destroyed `useSessionMessages`'s state and
  // forced a refetch of GET /api/sessions/{id}/messages. On AIPLA that
  // GET is ~400ms cross-region (Cloud Run europe-north1 → Vertex Agent
  // Engine europe-west1), so students saw a visible "disappear then
  // reappear" flicker of the "Earlier in this conversation" history every
  // refresh. See docs/design/aipla/v1.1.0-feedback/chat-history-flicker-on-token-refresh.md.
  const hadTokenOnceRef = useRef(false);
  if (token) hadTokenOnceRef.current = true;

  // Token effect re-runs when `user` changes — critical because
  // `getIdToken()` returns null when `auth.currentUser` hasn't been
  // hydrated yet, and `getIdToken` is a stable reference so a
  // `[getIdToken]` dep alone fires exactly once at mount. If that
  // single fire lands before Firebase's onAuthStateChanged populates
  // `currentUser`, token stays null forever — and any consumer that
  // submits sees backend 401 'Missing Authorization header'. Caught
  // 2026-06-03 on /teacher/analytics: stream POSTs 401'd with 11ms
  // latency (pre-auth-check fast-fail). Gating on `user` makes the
  // effect re-run as soon as auth hydrates.
  useEffect(() => {
    let cancelled = false;
    if (authLoading) {
      // Wait for auth to finish hydrating before deciding anything.
      // First-load-only gate: don't blank the subtree mid-conversation
      // if we already have a working agent.
      if (!hadTokenOnceRef.current) setTokenResolved(false);
      return () => undefined;
    }
    if (!user) {
      // Signed-out path: let downstream consumers render their sign-in
      // branches. Mark resolved so the gate below lifts. Reset the
      // had-token-once flag so the NEXT sign-in correctly gates on the
      // first-load path (subtree blanks while we mint the first token
      // for the new identity, preventing the 2026-06-03 cross-tab
      // identity-switch race from sending a message with the old token).
      setToken(null);
      setTokenResolved(true);
      hadTokenOnceRef.current = false;
      return () => undefined;
    }
    // First-load gate only. On subsequent token refreshes the OLD agent's
    // in-flight requests still carry the OLD token (Firebase grants
    // ~60s of grace on rotated tokens); NEW requests issued AFTER the
    // useMemo([skillId, token, sessionId]) swap below carry the NEW
    // token. So no request goes out unauthenticated, and we don't need
    // to unmount children to enforce that — the atomic agent swap is
    // sufficient. The original 2026-06-03 race ("cross-tab identity
    // switch sends a message with the old token") is handled by the
    // sign-out branch above resetting hadTokenOnceRef — the next
    // sign-in gates on the first-load path again.
    if (!hadTokenOnceRef.current) setTokenResolved(false);
    const fetchToken = useTeacherAuth ? getTeacherIdToken : getIdToken;
    void fetchToken()
      .then((t) => {
        if (!cancelled) setToken(t);
      })
      .finally(() => {
        if (!cancelled) setTokenResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, getIdToken, useTeacherAuth]);

  // Keep the AG-UI stream's token fresh across Firebase's silent ~hourly
  // ID-token rotation. The teacherUser subscription above uses
  // onAuthStateChanged, which does NOT fire on rotation — so the token effect
  // never re-runs and the HttpAgent keeps the token minted at mount. A session
  // that crosses the ~1h expiry then sends an expired token → stream POST 401
  // "Token expired", and the agent run fails with no recovery (seen 2026-06-27
  // on the activity co-pilot after the page was open ~1h; other requests use
  // fetchWithTeacherAuth, which mints fresh per call, so only the stream broke).
  // onIdTokenChanged fires on rotation with a fresh token; re-minting `token`
  // rebuilds the HttpAgent (useMemo dep) so subsequent runs carry it. Teacher
  // (Firebase) path only — the group/student token has its own source/lifecycle;
  // LOCAL_MODE uses a non-expiring stub.
  useEffect(() => {
    if (!useTeacherAuth || isLocalMode()) return undefined;
    return subscribeToIdToken((fresh) => {
      if (fresh) setToken(fresh);
    });
  }, [useTeacherAuth]);

  const agent = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return new HttpAgent({
      url: `/api/proxy/api/skill/${encodeURIComponent(skillId)}/stream`,
      headers,
      threadId: sessionId,
    });
  }, [skillId, token, sessionId]);

  // First-load-only gate: only blank the subtree before we've ever
  // resolved a token for this provider's lifetime. Subsequent token
  // refreshes keep children mounted; the atomic HttpAgent swap above
  // is sufficient to enforce auth correctness.
  if (!tokenResolved && !hadTokenOnceRef.current) {
    return null;
  }

  return (
    <AGUIAgentContext.Provider value={agent}>
      {children}
    </AGUIAgentContext.Provider>
  );
}

export function useAGUIAgent(): HttpAgent {
  const agent = useContext(AGUIAgentContext);
  if (!agent) {
    throw new Error("useAGUIAgent must be used within an AGUIProvider");
  }
  return agent;
}
