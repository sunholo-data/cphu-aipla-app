"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Stable threadId for AGUIProvider that survives the URL-writeback after
 * the first message of a fresh chat.
 *
 * Without this, the chat page passes ``urlSessionId ?? undefined`` straight
 * to AGUIProvider, whose ``useMemo([skillId, token, sessionId])`` rebuilds
 * the HttpAgent the moment the URL-writeback effect rewrites
 * ``?session=<id>`` after the first turn. The rebuild destroys the
 * in-memory ``agent.messages`` list — F1's agent-identity guard correctly
 * yields, but the user briefly sees an empty live area until
 * ``useSessionMessages`` GET populates ``initialMessages``. That's the
 * visible flicker described in
 * docs/design/v6.1.0/chat-history-deep-fixes-2.md as Bug A'.
 *
 * Lifecycle:
 * - Initial mount, no URL session: mint a fresh UUID.
 * - Initial mount, URL has ``?session=<id>``: adopt that id.
 * - URL gains ``?session=<id>`` and ``id`` matches the current threadId
 *   (our own writeback effect): no change.
 * - URL changes to a different ``?session=<other>`` (user clicked another
 *   thread): adopt the new id; AGUIProvider rebuilds intentionally.
 * - URL clears ``?session=`` (user clicked "+ New conversation"): mint a
 *   fresh UUID; AGUIProvider rebuilds intentionally.
 *
 * 1.1.145 M1 — anonymous-group students NEVER mint. Their session is decided by
 * the server (`POST /api/auth/group/session`, a transactional create-if-absent)
 * and passed as `serverSessionId`; it wins over the URL and is returned as-is.
 * A client-minted UUID was the V2 race: every device opening an activity at
 * once bootstrapped its own id, and the losers chatted on private sessions.
 */
export function useStableThreadId(
  urlSessionId: string | null,
  opts?: { initialSessionId?: string; serverSessionId?: string },
): string {
  const serverSessionId = opts?.serverSessionId;
  const [threadId, setThreadId] = useState<string>(
    () => serverSessionId ?? urlSessionId ?? opts?.initialSessionId ?? crypto.randomUUID(),
  );
  const prevUrlSessionIdRef = useRef<string | null>(urlSessionId);

  useEffect(() => {
    if (serverSessionId) {
      // The server decided; the URL follows it, never the other way round.
      prevUrlSessionIdRef.current = urlSessionId;
      if (threadId !== serverSessionId) setThreadId(serverSessionId);
      return;
    }
    const prev = prevUrlSessionIdRef.current;
    prevUrlSessionIdRef.current = urlSessionId;

    if (urlSessionId === null && prev !== null) {
      // URL went from ?session=X to no session — "+ New conversation".
      setThreadId(crypto.randomUUID());
    } else if (urlSessionId !== null && urlSessionId !== threadId) {
      // User clicked a different existing thread, OR initial mount with a
      // session URL we hadn't read yet.
      setThreadId(urlSessionId);
    }
    // When urlSessionId === threadId (URL writeback caught up to our id),
    // do nothing — that's the whole point of this hook.
  }, [urlSessionId, threadId, serverSessionId]);

  return serverSessionId ?? threadId;
}
