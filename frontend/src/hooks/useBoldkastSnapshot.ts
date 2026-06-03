"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import {
  useSimSnapshotPush,
  type UseSimSnapshotPushProactiveOpts,
} from "@/hooks/useSimSnapshotPush";

export type BoldkastMarker = "range" | "tof" | "ymax";

export interface BoldkastSnapshot {
  lastEvent: string;
  v0: number | null;
  theta: number | null;
  g: number | null;
  revealedMarkers: BoldkastMarker[];
}

export type BoldkastEvent =
  | { kind: "boldkast.open" }
  | { kind: "boldkast.play" }
  | {
      kind: "boldkast.state-change";
      changed: string[];
      state: { v0?: number; theta?: number; g?: number };
      triggeredBy?: string;
    }
  | { kind: "boldkast.show_value"; marker: BoldkastMarker; revealed: boolean };

const MARKER_DA: Record<BoldkastMarker, string> = {
  range: "Rækkevidde",
  tof: "Flyvetid",
  ymax: "Maks. højde",
};

export function markerDanish(marker: string): string {
  return MARKER_DA[marker as BoldkastMarker] ?? marker;
}

/** One human-readable Danish label per state-change commit (Afspil or
 *  chat-submit), listing the params the student touched with their final
 *  values. Mirrors the label the pre-hook BoldkastSimFrame produced. */
function labelForStateChange(
  changed: string[],
  state: { v0?: number; theta?: number; g?: number },
  triggeredBy: string | undefined,
): string {
  const parts: string[] = [];
  if (changed.includes("v0") && typeof state.v0 === "number") {
    parts.push(`v₀=${state.v0} m/s`);
  }
  if (changed.includes("theta") && typeof state.theta === "number") {
    parts.push(`θ=${state.theta}°`);
  }
  if (changed.includes("g") && typeof state.g === "number") {
    parts.push(`g=${state.g} m/s²`);
  }
  const verb =
    triggeredBy === "chat-submit" ? "Sendte spørgsmål med" : "Afspillede med";
  return parts.length > 0
    ? `${verb} ${parts.join(", ")}`
    : `${verb} aktuel konfiguration`;
}

const INITIAL: BoldkastSnapshot = {
  lastEvent: "",
  v0: null,
  theta: null,
  g: null,
  revealedMarkers: [],
};

export interface UseBoldkastSnapshot {
  snapshot: BoldkastSnapshot;
  reportEvent: (evt: BoldkastEvent) => void;
}

/**
 * useBoldkastSnapshot — shared source of truth for the Boldkast
 * projectile sim, mirroring useLedPlanckSnapshot / useKineBotSnapshot.
 * The bench iframe reports open / state-change / show_value; the React
 * workbench renders the accumulated snapshot (current v₀/θ/g + which
 * results the student has revealed). One reportEvent path → one snapshot
 * → one iframe-context POST + card dispatch.
 *
 * Before this pass the snapshot lived in a ref inside BoldkastSimFrame
 * and was never reflected back to the student; lifting it lets the React
 * workbench mirror the sim state.
 */
export function useBoldkastSnapshot(
  sessionId: string | null,
  /** Proactive-tutor wiring. The chat page passes explicit opts because
   * this hook is called in the SAME component scope as the
   * <ProactiveSimProvider> mount — React hooks see only ancestor
   * providers, not sibling-in-the-same-component ones. New sims that
   * call this hook inside a NESTED child component (below the provider
   * in the JSX tree) can omit this param and inherit from context via
   * useSimSnapshotPush's `useOptionalProactiveSimOpts()` fallback. */
  proactiveOpts?: UseSimSnapshotPushProactiveOpts,
): UseBoldkastSnapshot {
  const humanToolEvents = useHumanToolEvents();
  const [snapshot, setSnapshot] = useState<BoldkastSnapshot>(INITIAL);
  const snapshotRef = useRef<BoldkastSnapshot>(snapshot);
  snapshotRef.current = snapshot;
  const pushSnapshotRequest = useSimSnapshotPush<BoldkastSnapshot>(
    sessionId,
    "boldkast",
    "state",
    proactiveOpts,
  );

  const reportEvent = useCallback(
    (evt: BoldkastEvent) => {
      const prev = snapshotRef.current;
      const next: BoldkastSnapshot = { ...prev, lastEvent: evt.kind };
      let pushedLabel: string | null = null;
      let shouldPush = false;

      switch (evt.kind) {
        case "boldkast.open": {
          shouldPush = true; // silent — agent sees the open, no card
          break;
        }
        case "boldkast.play": {
          // Sprint PROACTIVE-SIM-REACTIVE M8-fix: pressing Afspil is the
          // canonical "sim ran" event. It emits a state-change too (so
          // the agent sees the committed params); we ALSO push play
          // explicitly so useSimSnapshotPush's proactive-event-check can
          // map "boldkast.play" → "sim_run" and trigger a reactive
          // tutor turn. Silent — no chat chip, because the matching
          // state-change event already produces an "Afspillede med …"
          // card via labelForStateChange.
          shouldPush = true;
          break;
        }
        case "boldkast.state-change": {
          const s = evt.state ?? {};
          if (typeof s.v0 === "number") next.v0 = s.v0;
          if (typeof s.theta === "number") next.theta = s.theta;
          if (typeof s.g === "number") next.g = s.g;
          shouldPush = true;
          pushedLabel = labelForStateChange(evt.changed, s, evt.triggeredBy);
          break;
        }
        case "boldkast.show_value": {
          const was = prev.revealedMarkers.includes(evt.marker);
          if (evt.revealed && !was) {
            next.revealedMarkers = [...prev.revealedMarkers, evt.marker];
            shouldPush = true;
            pushedLabel = `Afslørede ${markerDanish(evt.marker)}`;
          } else if (!evt.revealed && was) {
            // Un-reveal: update locally, no push (agent needn't know the
            // student re-hid a value they already saw).
            next.revealedMarkers = prev.revealedMarkers.filter(
              (m) => m !== evt.marker,
            );
          }
          break;
        }
      }

      setSnapshot(next);
      snapshotRef.current = next;

      if (!shouldPush) return;
      const req = pushSnapshotRequest(next, evt.kind);
      if (req) {
        if (pushedLabel) {
          humanToolEvents.dispatch({ label: pushedLabel, push: () => req });
        } else {
          void req.catch(() => {});
        }
      }
    },
    [pushSnapshotRequest, humanToolEvents],
  );

  // Catch-up push when sessionId arrives after the student has already
  // interacted (matches LED Planck / KineBot).
  useEffect(() => {
    if (!sessionId) return;
    const snap = snapshotRef.current;
    if (snap.lastEvent) {
      const req = pushSnapshotRequest(snap, snap.lastEvent);
      if (req) void req.catch(() => {});
    }
  }, [sessionId, pushSnapshotRequest]);

  return { snapshot, reportEvent };
}
