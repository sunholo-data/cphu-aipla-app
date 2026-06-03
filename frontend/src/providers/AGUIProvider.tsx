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
  useState,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getTeacherIdToken } from "@/lib/firebase";

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
  const { user, loading: authLoading, getIdToken } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [tokenResolved, setTokenResolved] = useState<boolean>(false);

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
      setTokenResolved(false);
      return () => undefined;
    }
    if (!user) {
      // Signed-out path: let downstream consumers render their sign-in
      // branches. Mark resolved so the gate below lifts.
      setToken(null);
      setTokenResolved(true);
      return () => undefined;
    }
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

  const agent = useMemo(() => {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    return new HttpAgent({
      url: `/api/proxy/api/skill/${encodeURIComponent(skillId)}/stream`,
      headers,
      threadId: sessionId,
    });
  }, [skillId, token, sessionId]);

  // Block child render until auth has settled AND the token has been
  // attempted. Existing chat surfaces already render their own loading
  // UI for longer than this gate; new surfaces like /teacher/analytics
  // see a brief flash of nothing, then the chat appears.
  if (!tokenResolved) {
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
