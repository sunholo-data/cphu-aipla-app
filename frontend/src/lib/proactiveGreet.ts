/**
 * Proactive-tutor greet client — Phase A.
 *
 * Hooks `useProactiveGreet` into the chat surface so when the skill opts
 * in (`proactiveGreet: true`) and the session is brand-new (no historical
 * messages), the frontend POSTs to `/api/sessions/{id}/greet`. The backend
 * fires one tutor turn server-side and returns the text; we render it as a
 * synthetic first assistant message inserted ahead of `initialMessages`.
 *
 * Idempotency:
 *  - Backend endpoint short-circuits when `turn_count > 0`, so calling it
 *    twice is cheap (no model cost on the second call).
 *  - This hook uses a ref guard to suppress React StrictMode double-fire
 *    inside a single mount.
 *
 * Failure mode:
 *  - On any error the hook logs and returns `greetMessage = null`. The
 *    chat surface falls back to today's behaviour (static initialMessage
 *    banner only).
 *
 * Phase B (idle heartbeat) will add a parallel `useIdleHeartbeat` hook
 * that posts to `/heartbeat-nudge` after JB sign-off on default timing.
 */

import { useEffect, useRef, useState } from "react";

import { fetchWithAuth } from "@/lib/apiClient";
import type { SkillMessage } from "@/hooks/useSkillAgent";

interface GreetResponseBody {
  skipped: boolean;
  reason?: string;
  text?: string;
  sessionId?: string;
}

let _greetSeq = 0;

function nextGreetId(): string {
  return `greet-${++_greetSeq}`;
}

export async function fetchProactiveGreet(
  sessionId: string,
  skillId: string,
): Promise<string | null> {
  const resp = await fetchWithAuth(
    `/api/proxy/api/sessions/${encodeURIComponent(sessionId)}/greet`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId }),
    },
  );
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`greet failed: ${resp.status} ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as GreetResponseBody;
  if (data.skipped || !data.text) {
    return null;
  }
  return data.text;
}

export interface ProactiveGreetState {
  /** Synthetic assistant message to splice into `initialMessages`, or
   *  null when there's no greet to render (skill opted out, error,
   *  session already has prior turns, or still loading). */
  greetMessage: SkillMessage | null;
  /** True while the greet POST is in flight. The chat surface can show
   *  a small "thinking" affordance during this window. */
  loading: boolean;
}

/**
 * Fires the proactive-greet endpoint once when the conditions are met,
 * and exposes the resulting assistant turn as a `SkillMessage` the chat
 * surface can prepend to its rendered history.
 *
 * Args:
 *   sessionId — current chat session id; pass null/empty to defer
 *   skillId — required for the POST body
 *   enabled — gate set by the chat page (true only when proactiveGreet
 *     is true AND no existing messages are loaded)
 */
export function useProactiveGreet({
  sessionId,
  skillId,
  enabled,
}: {
  sessionId: string | null | undefined;
  skillId: string;
  enabled: boolean;
}): ProactiveGreetState {
  const [greetMessage, setGreetMessage] = useState<SkillMessage | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const firedRef = useRef<string | null>(null);

  useEffect(() => {
    // Never strand the "thinking" affordance. When we're not in a state where
    // a greet should be pending, force `loading` false. This is load-bearing
    // when `enabled` flips false mid-flight: the per-activity active-session
    // resume (ALS-1) pins `?session=` asynchronously while a greet POST is
    // still in flight, which changes this effect's deps (`enabled`/`sessionId`)
    // and supersedes the run that set `loading=true`. Without this explicit
    // clear, `greetLoading` sticks true forever and the chat shows a permanent
    // "thinking" indicator even though the greet already returned 200. The slow
    // path (a Vertex "Server disconnected" retry stretching the greet to ~6s)
    // widens the race window. See proactiveGreet.test.ts.
    if (!enabled || !sessionId) {
      setLoading(false);
      return;
    }
    // Guard against React StrictMode double-effects: the ref pins the
    // (sessionId, skillId) tuple we've already fired for.
    const fireKey = `${sessionId}::${skillId}`;
    if (firedRef.current === fireKey) return;
    firedRef.current = fireKey;

    let superseded = false;
    setLoading(true);
    fetchProactiveGreet(sessionId, skillId)
      .then((text) => {
        // Don't render a greet that belongs to a superseded tuple.
        if (superseded) return;
        if (text) {
          setGreetMessage({
            id: nextGreetId(),
            role: "assistant",
            content: text,
          });
        }
      })
      .catch((err) => {
        // Non-fatal: chat surface still loads, just without the greet.
        // The static `initialMessage` banner remains visible.
        console.warn("[proactive-greet] fetch failed:", err);
      })
      .finally(() => {
        // Always clear the spinner for this run — unless a newer run for a
        // DIFFERENT tuple has taken over (it set its own `loading=true` and
        // owns the clear). Note we intentionally do NOT guard this on the
        // supersede flag: a dep change within the same mount must still clear
        // the spinner, or it stays stuck — the activity-chat "stuck thinking"
        // bug this whole block exists to prevent.
        if (firedRef.current === fireKey) setLoading(false);
      });

    return () => {
      superseded = true;
    };
  }, [sessionId, skillId, enabled]);

  return { greetMessage, loading };
}
