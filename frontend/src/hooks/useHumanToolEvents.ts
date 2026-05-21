// useHumanToolEvents — dispatch + state for human tool-use cards.
//
// The card system runs alongside the AG-UI message stream — it is NOT
// part of `agent.messages` (which is canonical and tightly synced by
// the F1 monotonic guard in useSkillAgent). Events are pure UI state
// for the current page lifetime. Refresh clears them; the agent has
// already received the equivalent info via iframe-context.
//
// Dispatch flow:
//   1. The student clicks something in a workspace surface (e.g. ticks
//      ProgressChecklist, reveals a Boldkast marker).
//   2. The surface calls `humanToolEvents.dispatch({ label, push })`.
//   3. We synchronously append a `pending` event so the card appears
//      before the network round-trip.
//   4. We invoke `push()` (which performs the iframe-context POST).
//   5. On 204 → `confirmed`; on 4xx/5xx → `failed` with httpStatus;
//      on throw (network blip) → `failed` with detail="network".
//   6. Minimum 200 ms pending hold so the success transition isn't a
//      barely-visible flash on a fast localhost loop.
//
// See: docs/design/aipla/v0.1.0-jutland/human-tool-use-cards.md

"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { ReactNode, createElement } from "react";

import type { HumanToolUseStatus } from "@/components/chat/HumanToolUseCard";

export interface HumanToolEvent {
  id: string;
  label: string;
  status: HumanToolUseStatus;
  httpStatus?: number;
  detail?: string;
  /** Local clock at dispatch — used for ordering against the message list. */
  t: number;
  /** Number of chat messages that existed when this event was dispatched.
   *  ChatMessageList uses this to interleave cards between messages:
   *  events with afterMessageIndex===N render between messages N-1 and N
   *  (so clicks made before the first message land at the top, clicks
   *  made after the second message land between #2 and #3, etc). */
  afterMessageIndex: number;
}

/** A function the dispatcher calls to perform the network side-effect.
 *  Resolves with the Response (or rejects on network failure). */
export type HumanToolPush = () => Promise<Response>;

export interface HumanToolEventsApi {
  events: HumanToolEvent[];
  /** Append a pending card, run `push`, then flip to confirmed/failed. */
  dispatch: (args: { label: string; push: HumanToolPush }) => void;
  /** Test/dev helper — drop everything (the chat-page provider doesn't
   *  call this; the events naturally roll off when the page unmounts). */
  clear: () => void;
}

const MIN_PENDING_MS = 200;

const HumanToolEventsContext = createContext<HumanToolEventsApi | null>(null);

/** Wrap the chat tree in this to enable cards. Surface components call
 *  `useHumanToolEvents()` to dispatch; ChatMessageList reads `.events`
 *  to render them inline.
 *
 *  `currentMessageCount` is read at dispatch time so each event records
 *  where it falls relative to the chat transcript. Pass `messages.length`
 *  from useSkillAgent so cards land at the right point in the
 *  conversation instead of always at the bottom. */
export function HumanToolEventsProvider({
  children,
  currentMessageCount,
}: {
  children: ReactNode;
  currentMessageCount?: number;
}) {
  const [events, setEvents] = useState<HumanToolEvent[]>([]);
  // Mirror current message count in a ref so the dispatch closure
  // always sees the latest value without forcing dispatch consumers to
  // re-create their callbacks on every message.
  const messageCountRef = useRef(currentMessageCount ?? 0);
  messageCountRef.current = currentMessageCount ?? 0;
  // Monotonic counter to make ids stable + sortable even when clocks
  // collide (two clicks in the same millisecond — happens on touch).
  const counterRef = useRef(0);

  const dispatch = useCallback<HumanToolEventsApi["dispatch"]>(({ label, push }) => {
    counterRef.current += 1;
    const id = `htu-${Date.now()}-${counterRef.current}`;
    const t = Date.now();
    const afterMessageIndex = messageCountRef.current;
    setEvents((prev) => [...prev, { id, label, status: "pending", t, afterMessageIndex }]);

    const finish = (next: Partial<HumanToolEvent>) => {
      const elapsed = Date.now() - t;
      const wait = Math.max(0, MIN_PENDING_MS - elapsed);
      setTimeout(() => {
        setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...next } : e)));
      }, wait);
    };

    push()
      .then((resp) => {
        if (resp.ok) {
          finish({ status: "confirmed", httpStatus: resp.status });
        } else {
          finish({ status: "failed", httpStatus: resp.status });
        }
      })
      .catch((err) => {
        finish({
          status: "failed",
          detail: err instanceof Error ? err.message || "network" : "network",
        });
      });
  }, []);

  const clear = useCallback(() => setEvents([]), []);

  const api: HumanToolEventsApi = { events, dispatch, clear };
  return createElement(HumanToolEventsContext.Provider, { value: api }, children);
}

/** Hook used by workspace surfaces to dispatch cards, and by the chat
 *  list to render them. Falls back to a no-op API if no provider is
 *  mounted (preserves rendering in isolated test setups). */
export function useHumanToolEvents(): HumanToolEventsApi {
  const ctx = useContext(HumanToolEventsContext);
  if (ctx) return ctx;
  // No-op fallback — used by surfaces rendered outside the chat page
  // (e.g. isolated component tests). dispatch still consumes the push
  // so the network side-effect runs.
  return {
    events: [],
    dispatch: ({ push }) => {
      void push().catch(() => {});
    },
    clear: () => {},
  };
}
