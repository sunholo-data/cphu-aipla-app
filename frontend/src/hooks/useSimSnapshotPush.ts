"use client";

import { useCallback, useRef } from "react";

import { fetchWithAuth } from "@/lib/apiClient";

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
 * ``sessionId`` is captured in a ref so the returned callback stays stable
 * across renders (matches the per-sim pattern that already existed). Callers
 * append a ``lastEvent`` discriminator into the structured content so the agent
 * can tell what change triggered this push (slider drag vs reveal vs reset).
 *
 * Returns ``null`` when ``sessionId`` is null (session hasn't bootstrapped yet
 * — caller should drop the push silently; the catch-up effect re-fires it
 * once the id arrives).
 *
 * See: backend/protocols/iframe_context_routes.py for the receiving end.
 */
export function useSimSnapshotPush<TSnapshot extends object>(
  sessionId: string | null,
  serverId: string,
  toolName = "state",
): (snap: TSnapshot, latestKind: string) => Promise<Response> | null {
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  return useCallback(
    (snap, latestKind) => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      const body = {
        serverId,
        toolName,
        structuredContent: { ...snap, lastEvent: latestKind },
      };
      return fetchWithAuth(`/api/proxy/api/sessions/${sid}/iframe-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [serverId, toolName],
  );
}
