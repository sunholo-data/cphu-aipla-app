"use client";

import { useCallback, useRef } from "react";

import { useOptionalProactiveSimOpts } from "@/contexts/ProactiveSimContext";
import { fetchWithAuth } from "@/lib/apiClient";
import {
  fetchProactiveEventCheck,
  mapArtefactKindToMeaningful,
} from "@/lib/proactiveEventCheck";

/**
 * Shared helper for sim snapshot hooks (useBoldkastSnapshot, useLedPlanckSnapshot,
 * useKineBotSnapshot, and any future sim hook).
 *
 * Returns a stable ``pushSnapshot(snap, latestKind)`` function that POSTs the
 * snapshot to ``/api/sessions/{sessionId}/iframe-context`` under the given
 * ``serverId`` / ``toolName`` namespace. The endpoint writes the structured
 * content into ADK session state under ``mcp_app_context.{serverId}.{toolName}``
 * — agent sees the current state on the next turn.
 *
 * **Sprint PROACTIVE-SIM-REACTIVE M8-fix (2026-06-03):** when ``proactiveOpts``
 * is supplied (skillId + onProactiveTrigger), this hook ALSO fires the
 * ``/proactive-event-check`` gate-decision after each iframe-context POST. If
 * the backend says shouldFire, the trigger sentinel is passed to
 * ``onProactiveTrigger`` (caller hands it to ``useSkillAgent.sendMessage`` to
 * kick off the AG-UI run that streams the proactive tutor turn back through
 * the established protocol).
 *
 * The gate-check is best-effort + non-blocking. Skipped silently when the
 * artefact's latestKind doesn't map to a meaningful event (slider drag,
 * reset, state syncs etc. are correctly NOT proactive triggers per the
 * design doc's MEANINGFUL_EVENT_KINDS allowlist). Original sprint wired
 * the gate-check inside MCPAppToolCallRouter (in-chat MCP App tool calls)
 * which is a DIFFERENT surface than the workspace artefacts (Boldkast,
 * LED Planck, KineBot) — see memory
 * ``reference-workbench-artefact-dual-surfaces``. This hook is the
 * workspace surface.
 *
 * ``sessionId`` is captured in a ref so the returned callback stays stable
 * across renders (matches the per-sim pattern that already existed). Callers
 * append a ``lastEvent`` discriminator into the structured content so the agent
 * can tell what change triggered this push (slider drag vs reveal vs reset).
 *
 * Returns ``null`` when ``sessionId`` is null (session hasn't bootstrapped yet
 * — caller should drop the push silently; the catch-up effect re-fires it
 * once the id arrives).
 *
 * See: backend/protocols/iframe_context_routes.py for the receiving end
 * + backend/protocols/proactive_routes.py for the gate endpoint.
 */
export interface UseSimSnapshotPushProactiveOpts {
  /** Current skill id — required by the gate endpoint. When null/empty
   * the proactive check is skipped (same posture as sessionId). */
  skillId: string | null | undefined;
  /** Called with the trigger sentinel when the backend gate says fire.
   * Caller hands this to useSkillAgent.sendMessage. */
  onProactiveTrigger: (trigger: string) => void;
}

export function useSimSnapshotPush<TSnapshot extends object>(
  sessionId: string | null,
  serverId: string,
  toolName = "state",
  /** Optional explicit override. When omitted, the hook reads
   *  ``ProactiveSimContext`` — a chat-page-level provider supplies the
   *  wiring once, and every sim inside picks it up automatically. The
   *  explicit override exists for tests and for sims mounted outside
   *  the chat surface that need different wiring. */
  proactiveOpts?: UseSimSnapshotPushProactiveOpts,
): (snap: TSnapshot, latestKind: string) => Promise<Response> | null {
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Read the context once; the explicit prop wins if supplied. Sims
  // mounted outside the provider (e.g. /dev/* pages) get null and skip
  // the gate-check entirely — same posture as proactiveOpts undefined.
  const contextOpts = useOptionalProactiveSimOpts();
  const effectiveOpts = proactiveOpts ?? contextOpts;
  const proactiveRef = useRef(effectiveOpts);
  proactiveRef.current = effectiveOpts;

  return useCallback(
    (snap, latestKind) => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      const body = {
        serverId,
        toolName,
        structuredContent: { ...snap, lastEvent: latestKind },
      };
      const req = fetchWithAuth(
        `/api/proxy/api/sessions/${sid}/iframe-context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      // Proactive sim-reactive gate-check (sprint PROACTIVE-SIM-REACTIVE).
      // Fire-and-forget — the caller awaits the iframe-context request
      // only; the gate-check happens in parallel. We chain off `req` so
      // the gate sees the post-push state (iframe-context arrives first;
      // gate then reads last_message_at + cooldown state on the backend).
      const opts = proactiveRef.current;
      if (opts && opts.skillId) {
        const meaningful = mapArtefactKindToMeaningful(latestKind);
        if (meaningful) {
          const onTrigger = opts.onProactiveTrigger;
          const skillId = opts.skillId;
          req
            .then(() =>
              fetchProactiveEventCheck({
                sessionId: sid,
                skillId,
                eventKind: meaningful,
              }),
            )
            .then((result) => {
              if (result.shouldFire && result.trigger) {
                onTrigger(result.trigger);
              }
            })
            .catch((err) => {
              console.warn(
                "useSimSnapshotPush: proactive-event-check failed",
                err,
              );
            });
        }
      }

      return req;
    },
    [serverId, toolName],
  );
}
