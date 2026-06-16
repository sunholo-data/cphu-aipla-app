"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SkillMessage } from "@/hooks/useSkillAgent";
import type { HumanToolEvent } from "@/hooks/useHumanToolEvents";
import { fetchWithAuth } from "@/lib/apiClient";
import { isProactiveSentinel } from "@/lib/proactiveSentinels";

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface SessionInteraction {
  label: string;
  timestamp: number;
  server_id: string | null;
  tool_name: string | null;
}

interface GetSessionMessagesResponse {
  messages: SessionMessage[];
  session_id: string;
  // 1.1.34 — persisted MCP-app interactions, for transcript restore.
  interactions?: SessionInteraction[];
  interactions_truncated?: boolean;
}

interface UseSessionMessagesReturn {
  initialMessages: SkillMessage[];
  /** 1.1.34 — restored MCP-app interaction cards, positioned in the
   *  restored-history index space (afterMessageIndex counts restored
   *  messages, NOT live ones). Seed into HumanToolEventsProvider on resume. */
  initialInteractions: HumanToolEvent[];
  /** True when older interactions were dropped by the backend cap. */
  interactionsTruncated: boolean;
  isLoadingHistory: boolean;
  historyError: string | null;
  sessionGone: boolean;
}

const NO_INTERACTIONS: HumanToolEvent[] = [];

/** Map persisted interactions into restored cards. `afterMessageIndex` is
 *  the count of restored messages at or before the interaction's timestamp,
 *  so the card renders just before the tutor turn it preceded. The `<=`
 *  tie-break keeps a card after a message sharing its exact timestamp. */
function buildRestoredInteractions(
  messages: SessionMessage[],
  interactions: SessionInteraction[],
): HumanToolEvent[] {
  if (interactions.length === 0) return NO_INTERACTIONS;
  return interactions.map((it, n) => ({
    id: `htu-restored-${n}`,
    label: it.label,
    status: "confirmed" as const,
    t: it.timestamp,
    afterMessageIndex: messages.filter((m) => m.timestamp <= it.timestamp).length,
    restored: true,
  }));
}

// Stranded-session-prevention (1.23) Option 1: distinguishes
// "session truly does not exist" (404) from transient errors (5xx,
// network). The chat page reads sessionGone and auto-redirects to a
// fresh URL via handleNewSession.
class SessionNotFoundError extends Error {
  constructor() {
    super("session not found");
    this.name = "SessionNotFoundError";
  }
}

let _msgCounter = 0;
function nextId(): string {
  return `hist-${++_msgCounter}`;
}

function toSkillMessage(m: SessionMessage): SkillMessage {
  return { id: nextId(), role: m.role, content: m.content, timestamp: m.timestamp };
}

export function useSessionMessages(sessionId: string | null): UseSessionMessagesReturn {
  const [initialMessages, setInitialMessages] = useState<SkillMessage[]>([]);
  const [initialInteractions, setInitialInteractions] = useState<HumanToolEvent[]>(NO_INTERACTIONS);
  const [interactionsTruncated, setInteractionsTruncated] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sessionGone, setSessionGone] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastSessionId = useRef<string | null>(null);

  const fetch_ = useCallback(
    (sid: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoadingHistory(true);
      setHistoryError(null);
      setSessionGone(false);

      fetchWithAuth(`/api/proxy/api/sessions/${encodeURIComponent(sid)}/messages`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (res.status === 404) throw new SessionNotFoundError();
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<GetSessionMessagesResponse>;
        })
        .then((data) => {
          // Drop proactive-trigger sentinels ([session_start],
          // [event_reactive:*]) from restored history — they're synthetic
          // system markers used to kick off a tutor turn, NOT real student
          // messages, and would otherwise render as a literal "[session_start]"
          // bubble. The live path (useSkillAgent.toSkillMessage) already
          // filters these; this keeps the resumed transcript consistent.
          const filtered = data.messages.filter((m) => !isProactiveSentinel(m.content));
          setInitialMessages(filtered.map(toSkillMessage));
          // 1.1.34 — restored MCP-app interaction cards, indexed against the
          // SAME filtered history that renders. The reactive sentinel (the
          // trigger) is filtered above; the interaction (the card) is restored
          // here — distinct events, never conflated.
          setInitialInteractions(buildRestoredInteractions(filtered, data.interactions ?? []));
          setInteractionsTruncated(Boolean(data.interactions_truncated));
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          if (err instanceof SessionNotFoundError) {
            setSessionGone(true);
            setInitialMessages([]);
            setInitialInteractions(NO_INTERACTIONS);
            setInteractionsTruncated(false);
            return;
          }
          setHistoryError("Couldn't load previous messages — starting fresh.");
          setInitialMessages([]);
          setInitialInteractions(NO_INTERACTIONS);
          setInteractionsTruncated(false);
        })
        .finally(() => {
          setIsLoadingHistory(false);
        });
    },
    [],
  );

  useEffect(() => {
    if (!sessionId) {
      setInitialMessages([]);
      setInitialInteractions(NO_INTERACTIONS);
      setInteractionsTruncated(false);
      setHistoryError(null);
      setSessionGone(false);
      return;
    }

    if (sessionId === lastSessionId.current) return;
    lastSessionId.current = sessionId;

    fetch_(sessionId);
    return () => abortRef.current?.abort();
  }, [sessionId, fetch_]);

  return {
    initialMessages,
    initialInteractions,
    interactionsTruncated,
    isLoadingHistory,
    historyError,
    sessionGone,
  };
}
