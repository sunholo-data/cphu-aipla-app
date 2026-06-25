"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";

import type { UseSimSnapshotPushProactiveOpts } from "@/hooks/useSimSnapshotPush";

/**
 * React Context for the proactive sim-reactive wiring shared by every
 * workspace artefact — consumed by `useSimSnapshotPush` inside
 * `GenericArtefactFrame`, the single mount every sim artefact renders through.
 *
 * **Why a context.** Without it, every new workspace artefact would
 * need to thread the same two values (`skillId` + `onProactiveTrigger`)
 * through its snapshot hook into `useSimSnapshotPush`. That meant a
 * per-sim code change just to wire generic platform behaviour. With
 * this context, a new sim only writes its own frame + snapshot hook
 * and calls `useSimSnapshotPush(sessionId, "<sim-name>")` — the
 * gate-check fires automatically because the central hook reads this
 * context.
 *
 * **Why a ref under the hood.** The chat page mounts the provider in
 * the SAME component (`ChatPageInner`) as the snapshot hooks. Hooks
 * called in the same component as their own provider can't see the
 * provider via plain useContext (the provider only supplies context
 * to JSX-tree descendants — and the hook body runs BEFORE the JSX is
 * rendered). The ref pattern works around this: the context value is
 * a stable mutable ref OBJECT; `useSimSnapshotPush` captures the ref
 * and reads `ref.current` lazily at iframe-context-POST callback time
 * — long after the chat page's useEffect has populated the wiring.
 * Stable ref = no re-render churn, deferred read = correct timing.
 *
 * **What to do as a sim author.** Nothing. Mount your sim inside
 * the existing `<ProactiveSimProvider>` (the chat page already wraps
 * the workspace surface). If your sim's per-frame handler currently
 * filters out events, lift the filter so all spec-compliant events
 * reach the snapshot hook — `useSimSnapshotPush` decides on the
 * proactive side via `mapArtefactKindToMeaningful` (in
 * `frontend/src/lib/proactiveEventCheck.ts`) and silently ignores
 * non-meaningful kinds.
 *
 * **What to do as the chat surface.** Wrap the entire chat page in
 * `<ProactiveSimProvider>`. Then call `useSetProactiveSimWiring()`
 * inside a child component (typically the same component that owns
 * `useSkillAgent`) and pass `{skillId, onProactiveTrigger}` into it
 * via a useEffect. See `frontend/src/app/chat/[...path]/page.tsx`.
 *
 * **Decoupled by design.** Sims that mount OUTSIDE the provider (e.g.
 * `/dev/mcp-apps/...` pages with no chat surrounding them) keep their
 * iframe-context flow but skip the gate-check entirely (no chat to
 * trigger). No errors, no warnings — graceful degradation.
 */
interface ProactiveSimContextValue {
  optsRef: MutableRefObject<UseSimSnapshotPushProactiveOpts | null>;
}

const ProactiveSimContext = createContext<ProactiveSimContextValue | null>(null);

export interface ProactiveSimProviderProps {
  children: ReactNode;
}

export function ProactiveSimProvider({ children }: ProactiveSimProviderProps) {
  // Stable ref object so the Provider's value identity doesn't change
  // across renders. Consumers read `.current` at callback time so they
  // see whatever the most recent useSetProactiveSimWiring call wrote.
  const optsRef = useRef<UseSimSnapshotPushProactiveOpts | null>(null);
  const value = useMemo<ProactiveSimContextValue>(() => ({ optsRef }), []);
  return (
    <ProactiveSimContext.Provider value={value}>
      {children}
    </ProactiveSimContext.Provider>
  );
}

/** Set / clear the proactive-tutor wiring. Returns a stable setter
 *  the caller invokes inside a useEffect once `useSkillAgent` has
 *  produced `sendMessage`. Clearing on unmount keeps the ref tidy
 *  across navigation. */
export function useSetProactiveSimWiring(): (
  opts: UseSimSnapshotPushProactiveOpts | null,
) => void {
  const ctx = useContext(ProactiveSimContext);
  return useCallback(
    (opts) => {
      if (ctx) ctx.optsRef.current = opts;
    },
    [ctx],
  );
}

/** Read the current wiring. Returns the ref object directly so
 *  callers can read `.current` lazily at callback time (after the
 *  chat page's useEffect has populated the wiring). Returns null when
 *  the hook is mounted outside a `<ProactiveSimProvider>` — sims on
 *  /dev/* surfaces or in standalone tests just don't get the gate
 *  check. */
export function useOptionalProactiveSimOptsRef(): MutableRefObject<UseSimSnapshotPushProactiveOpts | null> | null {
  const ctx = useContext(ProactiveSimContext);
  return ctx?.optsRef ?? null;
}
