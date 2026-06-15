"use client";

import { useEffect, useState } from "react";

/**
 * "Did this chat mount resume an existing session?" — the flag that gates
 * whether fetched history (`useSessionMessages.initialMessages`) is rendered.
 *
 * THE BUG THIS GUARDS (2026-06-15): for anonymous-group users the session is
 * adopted ASYNC after mount — the active-session fetch (and App Router's
 * late-resolving `useSearchParams`) writes `?session=` a tick after the chat
 * page mounts. A flag frozen once from the first-render `sessionId`
 * (`useState(() => sessionId !== null)`) then stays `false`, so the
 * successfully-fetched history is never passed to the message list and a fresh
 * greet shows instead — even though the turns ARE persisted. (The 2026-06-13
 * resume fix adopted the session into the URL but left this flag unflipped.)
 *
 * Fix: promote to a resume when a session id appears with NO live turn yet this
 * mount. The `liveMessageCount === 0` guard keeps the FRESH-chat URL-writeback
 * — which fires AFTER turn 1, when live messages already exist — from flipping
 * it (that would duplicate the bubbles already on screen). Explicit in-app
 * navigation still drives the flag directly via the returned setter
 * (select-thread → true, new-conversation → false).
 *
 * @param sessionId       the `?session=` id (null = fresh / not yet resolved)
 * @param liveMessageCount number of live (this-mount) turns from the agent
 */
export function useEnteredViaResume(
  sessionId: string | null,
  liveMessageCount: number,
): [boolean, (v: boolean) => void] {
  const [enteredViaResume, setEnteredViaResume] = useState<boolean>(
    () => sessionId !== null,
  );

  useEffect(() => {
    if (sessionId && !enteredViaResume && liveMessageCount === 0) {
      setEnteredViaResume(true);
    }
  }, [sessionId, enteredViaResume, liveMessageCount]);

  return [enteredViaResume, setEnteredViaResume];
}
