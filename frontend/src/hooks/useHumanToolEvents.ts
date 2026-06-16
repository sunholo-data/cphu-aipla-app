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

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
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
   *  made after the second message land between #2 and #3, etc).
   *
   *  For RESTORED events (1.1.34) this indexes into the RESTORED history
   *  (`initialMessages`), a separate index space from live `messages` —
   *  ChatMessageList interleaves restored cards only within the history
   *  loop and live cards only within the live loop. */
  afterMessageIndex: number;
  /** True for cards reconstructed from persisted interactions on reload
   *  (1.1.34). Always `confirmed` (it persisted, so it succeeded) and
   *  never re-pushes. `afterMessageIndex` is in the restored-history index
   *  space. Live dispatches leave this unset. */
  restored?: boolean;
}

/** A function the dispatcher calls to perform the network side-effect.
 *  Resolves with the Response (or rejects on network failure). */
export type HumanToolPush = () => Promise<Response>;

export interface HumanToolEventsApi {
  events: HumanToolEvent[];
  /** Append a pending card, run `push`, then flip to confirmed/failed. */
  dispatch: (args: { label: string; push: HumanToolPush }) => void;
  /** Replace the RESTORED card set (1.1.34) — read-only confirmed cards
   *  reconstructed from persisted interactions on reload. Idempotent:
   *  clears the previous restored set and keeps all live dispatches. */
  seed: (events: HumanToolEvent[]) => void;
  /** Test/dev helper — drop everything (the chat-page provider doesn't
   *  call this; the events naturally roll off when the page unmounts). */
  clear: () => void;
  /** Sync the current chat-message count into the provider's ref so the
   *  next dispatch's `afterMessageIndex` lands at the right spot. Used by
   *  `useSyncMessageCount` so the provider can be mounted ABOVE the
   *  component that owns `useSkillAgent` — keeping all snapshot hooks
   *  (Boldkast / LED Planck / KineBot) inside the provider's subtree
   *  instead of silently falling through to the no-op fallback. */
  setCurrentMessageCount: (n: number) => void;
}

const MIN_PENDING_MS = 200;

const HumanToolEventsContext = createContext<HumanToolEventsApi | null>(null);

// Tripped the first time the no-op fallback's dispatch runs in dev. Why
// a module-level latch: real card storms (slider settles, repeated
// reveals) would otherwise spam the console. One loud warning per page
// load is enough to catch a misplaced provider; the rest is silent.
//
// Background — 2026-06-01: HumanToolEventsProvider was moved inside the
// component that owns useSkillAgent so it could read messages.length as
// a prop. That move shoved all snapshot hooks (Boldkast / LED Planck /
// KineBot / ProgressChecklist) outside the provider's subtree, where
// useHumanToolEvents() silently returned this no-op fallback — POSTs
// still went out, but no cards rendered. The bug survived ~10 days
// undetected because each snapshot's unit tests mock useHumanToolEvents.
// This warning converts that whole class of silent miswirings into a
// console.warn on first interaction.
let _warnedNoProvider = false;

function _warnNoProviderOnce(): void {
  // Stay quiet in production: no perf cost, no user-visible noise.
  // The "production" guard intentionally lets the warning fire under
  // NODE_ENV=test too — so the regression test below can assert it
  // without per-suite env stubs.
  if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
    return;
  }
  if (_warnedNoProvider) return;
  _warnedNoProvider = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[useHumanToolEvents] dispatch() called outside HumanToolEventsProvider — " +
      "no card will render. Mount <HumanToolEventsProvider> as an ANCESTOR of " +
      "the component whose hooks dispatch (Boldkast / LED Planck / KineBot / " +
      "ProgressChecklist / any future sim). See useHumanToolEvents.ts header " +
      "comment for the 2026-06-01 regression that motivated this check.",
  );
}

// Test-only: reset the latch so the warning re-arms between cases.
export function _resetNoProviderWarnedForTests(): void {
  _warnedNoProvider = false;
}

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

  // 1.1.34: load restored cards without clobbering live dispatches. Replace
  // the prior restored subset (idempotent across re-seeds) and keep every
  // live event. Restored cards are forced to `restored: true` + `confirmed`.
  const seed = useCallback((restored: HumanToolEvent[]) => {
    const normalised = restored.map((e) => ({ ...e, restored: true, status: "confirmed" as const }));
    setEvents((prev) => [...prev.filter((e) => !e.restored), ...normalised]);
  }, []);

  const setCurrentMessageCount = useCallback((n: number) => {
    messageCountRef.current = n;
  }, []);

  const api: HumanToolEventsApi = { events, dispatch, seed, clear, setCurrentMessageCount };
  return createElement(HumanToolEventsContext.Provider, { value: api }, children);
}

/** Push the current chat-message count into the surrounding provider on
 *  every change. Lets the provider sit ABOVE the component that owns
 *  `useSkillAgent` so all snapshot hooks called inside that component are
 *  still inside the provider's subtree and can dispatch real cards (not
 *  the no-op fallback). No-op when no provider is mounted. */
export function useSyncMessageCount(currentMessageCount: number): void {
  const ctx = useContext(HumanToolEventsContext);
  useEffect(() => {
    ctx?.setCurrentMessageCount(currentMessageCount);
  }, [ctx, currentMessageCount]);
}

/** Seed the surrounding provider with restored interaction cards (1.1.34)
 *  whenever the list identity changes. Mirrors `useSyncMessageCount` so the
 *  provider can sit ABOVE the component that owns `useSessionMessages`. Pass
 *  the restored interactions for a resumed session, or an empty array for a
 *  fresh chat (clears any prior restored set). No-op without a provider. */
export function useSeedRestoredInteractions(events: HumanToolEvent[]): void {
  const ctx = useContext(HumanToolEventsContext);
  const seed = ctx?.seed;
  useEffect(() => {
    seed?.(events);
  }, [seed, events]);
}

/** Hook used by workspace surfaces to dispatch cards, and by the chat
 *  list to render them. Falls back to a no-op API if no provider is
 *  mounted (preserves rendering in isolated test setups). */
export function useHumanToolEvents(): HumanToolEventsApi {
  const ctx = useContext(HumanToolEventsContext);
  if (ctx) return ctx;
  // No-op fallback — used by surfaces rendered outside the chat page
  // (e.g. isolated component tests). dispatch still consumes the push
  // so the network side-effect runs. In dev/test, it also fires a
  // one-time console.warn so a misplaced provider on a chat page
  // doesn't fail silently (see _warnNoProviderOnce header for why).
  return {
    events: [],
    dispatch: ({ push }) => {
      _warnNoProviderOnce();
      void push().catch(() => {});
    },
    seed: () => {},
    clear: () => {},
    setCurrentMessageCount: () => {},
  };
}
