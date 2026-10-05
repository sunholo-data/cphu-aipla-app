"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveGroupSession, type GroupSession } from "@/lib/groupSessionApi";

export interface UseGroupSessionReturn {
  /** The server-decided session, or null while resolving / disabled. */
  session: GroupSession | null;
  /** True once every automatic attempt has failed — the page offers a retry. */
  failed: boolean;
  retry: () => void;
}

/** Delays between automatic attempts. A student cannot chat without the shared
 *  session, and the old fallback (mint a private UUID) is exactly the V2 bug, so
 *  a blip is retried before the page shows "try again". */
const RETRY_DELAYS_MS = [600, 1500, 3000];

/**
 * Resolve the group's shared session for this activity before the chat builds
 * its agent (1.1.145 D2 / M1). Disabled (returns `session: null`, never fetches)
 * for anyone not on a group code — teachers keep their own session list.
 */
export function useGroupSession(
  enabled: boolean,
  skillId: string,
  activityId: string,
): UseGroupSessionReturn {
  // Remembered with the scope it was resolved for, so moving to another
  // activity never hands back the previous activity's session for a render.
  const key = `${skillId}::${activityId}`;
  const [resolved, setResolved] = useState<{ key: string; session: GroupSession } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setFailed(false);

    const run = (n: number) => {
      resolveGroupSession(skillId, activityId)
        .then((s) => {
          if (!cancelled) setResolved({ key, session: s });
        })
        .catch(() => {
          if (cancelled) return;
          if (n < RETRY_DELAYS_MS.length) {
            timer = setTimeout(() => run(n + 1), RETRY_DELAYS_MS[n]);
          } else {
            setFailed(true);
          }
        });
    };
    run(0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, key, skillId, activityId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const session = enabled && resolved?.key === key ? resolved.session : null;
  return { session, failed, retry };
}
