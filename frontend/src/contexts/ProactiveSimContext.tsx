"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import type { UseSimSnapshotPushProactiveOpts } from "@/hooks/useSimSnapshotPush";

/**
 * React Context for the proactive sim-reactive wiring shared by every
 * workspace artefact hook (useBoldkastSnapshot, useLedPlanckSnapshot,
 * useKineBotSnapshot, and any future sim hook).
 *
 * **Why a context.** Without it, every new workspace artefact would need
 * to thread the same two values (`skillId` + `onProactiveTrigger`) through
 * its snapshot hook into `useSimSnapshotPush`. That meant a per-sim
 * code change just to wire generic platform behaviour. With this context,
 * a new sim only writes its own frame + snapshot hook and calls
 * `useSimSnapshotPush(sessionId, "<sim-name>")` — the gate-check fires
 * automatically because the central hook reads this context.
 *
 * **What to do as a sim author.** Nothing. Mount your sim inside
 * the existing `<ProactiveSimProvider>` (the chat page already wraps the
 * workspace surface). If your sim's per-frame handler currently filters
 * out events, lift the filter so all spec-compliant events reach the
 * snapshot hook — `useSimSnapshotPush` decides on the proactive side via
 * `mapArtefactKindToMeaningful` (in `frontend/src/lib/proactiveEventCheck.ts`)
 * and silently ignores non-meaningful kinds.
 *
 * **What to do as the chat surface.** Wrap the workspace tree in a
 * `<ProactiveSimProvider skillId={...} onProactiveTrigger={text => sendMessage(text)}>`.
 * One provider; every sim inside gets the gate-check.
 *
 * **Decoupled by design.** Sims that mount OUTSIDE the provider (e.g.
 * `/dev/mcp-apps/...` pages with no chat surrounding them) keep their
 * iframe-context flow but skip the gate-check entirely (no chat to
 * trigger). No errors, no warnings — graceful degradation.
 */
const ProactiveSimContext = createContext<UseSimSnapshotPushProactiveOpts | null>(
  null,
);

export interface ProactiveSimProviderProps extends UseSimSnapshotPushProactiveOpts {
  children: ReactNode;
}

export function ProactiveSimProvider({
  skillId,
  onProactiveTrigger,
  children,
}: ProactiveSimProviderProps) {
  const value = useMemo<UseSimSnapshotPushProactiveOpts>(
    () => ({ skillId, onProactiveTrigger }),
    [skillId, onProactiveTrigger],
  );
  return (
    <ProactiveSimContext.Provider value={value}>
      {children}
    </ProactiveSimContext.Provider>
  );
}

/** Returns the wiring when mounted inside a provider; null otherwise.
 *  `useSimSnapshotPush` consumes this to decide whether to fire the
 *  proactive-event-check after each iframe-context POST. */
export function useOptionalProactiveSimOpts(): UseSimSnapshotPushProactiveOpts | null {
  return useContext(ProactiveSimContext);
}
