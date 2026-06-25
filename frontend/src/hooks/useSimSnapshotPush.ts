"use client";

import { useCallback, useRef } from "react";

import { useOptionalProactiveSimOptsRef } from "@/contexts/ProactiveSimContext";
import { fetchWithAuth } from "@/lib/apiClient";
import type { EncodedImage } from "@/lib/imageResize";
import {
  fetchProactiveEventCheck,
  mapArtefactKindToMeaningful,
} from "@/lib/proactiveEventCheck";

/**
 * Shared helper that pushes a sim/artefact snapshot to the tutor. Used by
 * `GenericArtefactFrame` — the one generic mount every sim artefact renders
 * through since USR-1 (the per-sim snapshot hooks it replaced are gone).
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
  /** Called with the trigger sentinel when the backend gate says fire, OR
   * directly by a workbench element to send a turn. Optional `attachments`
   * ride the turn as native multimodal image parts (1.1.7) — the photo
   * solution element (1.1.48) submits the student's work this way. Caller
   * hands this to useSkillAgent.sendMessage. */
  onProactiveTrigger: (trigger: string, attachments?: EncodedImage[]) => void;
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
): (snap: TSnapshot, latestKind: string, label?: string | null) => Promise<Response> | null {
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Capture the explicit-opts override in a ref so it stays current
  // across renders without dirtying the returned callback identity.
  const explicitOptsRef = useRef(proactiveOpts);
  explicitOptsRef.current = proactiveOpts;
  // Read the CONTEXT REF — not the deref'd value — so the snapshot
  // hook can be called in the same component scope as the provider
  // mount (chat page case). The provider exposes a stable ref object
  // whose `.current` gets populated by a useEffect AFTER first
  // render. At pushSnapshot callback time (long after first render)
  // we deref to get the latest wiring. Returns null when no
  // provider above — sims on /dev/* pages or in tests then skip the
  // gate-check, identical to proactiveOpts=undefined.
  const contextOptsRef = useOptionalProactiveSimOptsRef();

  return useCallback(
    (snap, latestKind, label) => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      // 1.1.34: carry the human-readable card label so the resumed transcript
      // can re-render this interaction without re-deriving per-sim label text
      // server-side. Optional — omitted for label-less pushes (catch-up syncs,
      // silent state pushes).
      const body: {
        serverId: string;
        toolName: string;
        structuredContent: Record<string, unknown>;
        label?: string;
      } = {
        serverId,
        toolName,
        structuredContent: { ...snap, lastEvent: latestKind },
      };
      if (label) body.label = label;
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
      // gate then reads last_student_message_at + cooldown state on the
      // backend). Read opts LAZILY here: explicit-prop override wins;
      // otherwise read context ref's current at call time so the chat
      // page's useEffect-populated wiring is visible.
      const opts =
        explicitOptsRef.current ?? contextOptsRef?.current ?? null;
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
