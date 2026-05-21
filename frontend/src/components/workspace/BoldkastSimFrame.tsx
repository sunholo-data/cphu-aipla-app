"use client";

import { useCallback, useEffect, useRef } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { fetchWithAuth } from "@/lib/apiClient";

import { StaticArtefactFrame } from "./StaticArtefactFrame";

/** Human-readable Danish label for a pushed Boldkast event, used by
 *  HumanToolUseCard. Kept here (not the hook) so the mapping stays
 *  with the surface that owns the event semantics. */
function labelForBoldkastEvent(
  kind: string,
  marker?: string,
  preset?: string,
): string | null {
  if (kind === "boldkast.show_value" && marker) return `Afslørede ${marker}`;
  if (kind === "boldkast.param.change" && preset) {
    const planet =
      { earth: "Jorden", moon: "Månen", mars: "Mars", jupiter: "Jupiter" }[preset.toLowerCase()] ??
      preset;
    return `Skiftede tyngdekraft til ${planet}`;
  }
  // boldkast.open and others: no card (not a pedagogical action).
  return null;
}

/** Label for the debounced slider-end push. One card per drag-end so
 *  the student / dev can SEE what value reached the agent — closes
 *  the "trust the context" gap. Symbols stay terse (v₀, θ, g) to
 *  match the sim's own UI. */
function labelForSliderEnd(param: string, value: number): string {
  if (param === "v0") return `Justerede v₀ til ${value} m/s`;
  if (param === "theta") return `Justerede θ til ${value}°`;
  if (param === "g") return `Justerede g til ${value} m/s²`;
  return `Justerede ${param} til ${value}`;
}

interface BoldkastSimFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html) — e.g.
   *  `https://aipla-v01-sandbox-...lz.a.run.app`. */
  sandboxOrigin: string;
  /** Active chat session id. When set, sim interactions are POSTed
   *  to the iframe-context endpoint so the agent's next prompt sees
   *  what the student did in the sim. When null, events queue locally
   *  until a session arrives (catch-up effect). */
  sessionId: string | null;
  /** Called on user-close so the workspace can return to its default
   * content (problem statement + checklist). */
  onClose: () => void;
}

/** Spec-side payload shape: structuredContent.kind carries the
 *  artefact's event vocabulary, the rest are event-specific fields. */
interface BoldkastStructuredContent {
  kind: string;
  marker?: string;
  param?: string;
  value?: number;
  revealed?: boolean;
  triggeredBy?: string;
}

/** Accumulated snapshot the host POSTs to /iframe-context. The agent's
 *  next turn sees this via the InstructionProvider. */
interface BoldkastSnapshot {
  lastEvent: string;
  revealedMarkers: string[];
  v0: number | null;
  theta: number | null;
  g: number | null;
  lastPreset: string | null;
}

/**
 * BoldkastSimFrame — spec-compliant host wrapper around the Boldkast
 * projectile-motion artefact. Mounts the artefact via `StaticArtefactFrame`
 * which speaks MCP Apps JSON-RPC over the sandbox-proxy at the mcp-sandbox
 * service. Per ADR-013 + spec §Sandbox proxy:
 *
 *   Host page (chat)
 *     └── outer iframe @ ${sandboxOrigin}/sandbox.html
 *          (allow-scripts allow-same-origin — proxy needs same-origin
 *           to bridge the inner artefact iframe)
 *         └── inner iframe (the artefact HTML, document.written by
 *             the proxy)
 *              — runs ui/initialize handshake on load
 *              — emits ui/update-model-context notifications on
 *                pedagogically meaningful events
 *              — accepts ping requests
 *
 * StaticArtefactFrame handles the wire (handshake, JSON-RPC envelope
 * parsing, origin auth, lifecycle). This file owns the Boldkast-specific
 * event-routing: snapshot accumulation, push-with-card / silent-push,
 * slider debounce, catch-up on late sessionId.
 *
 * Migration from raw postMessage was sprint MCPAPP-SPEC (2026-05-21).
 * See: docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-spec-compliance.md
 */
export function BoldkastSimFrame({ sandboxOrigin, sessionId, onClose }: BoldkastSimFrameProps) {
  const humanToolEvents = useHumanToolEvents();
  // Debounce handle for slider-drag pushes.
  const sliderDebounceRef = useRef<number | null>(null);
  // Accumulated snapshot — ref (not state) because we don't re-render
  // on update; we only POST to the backend.
  const snapshotRef = useRef<BoldkastSnapshot>({
    lastEvent: "",
    revealedMarkers: [],
    v0: null,
    theta: null,
    g: null,
    lastPreset: null,
  });

  // Mirror sessionId in a ref so the long-lived callback reads the
  // current value at event time (StaticArtefactFrame's onUpdateModelContext
  // is bound once at mount and reads .current at invocation).
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const pushSnapshotRequest = useCallback(
    (latestKind: string): Promise<Response> | null => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      const body = {
        serverId: "boldkast",
        toolName: "state",
        structuredContent: { ...snapshotRef.current, lastEvent: latestKind },
      };
      return fetchWithAuth(`/api/proxy/api/sessions/${sid}/iframe-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [],
  );

  const pushSnapshotSilent = useCallback(
    (latestKind: string) => {
      const req = pushSnapshotRequest(latestKind);
      if (!req) return;
      void req.catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[boldkast] iframe-context push failed:", err);
        }
      });
    },
    [pushSnapshotRequest],
  );

  // The callback StaticArtefactFrame invokes for each
  // ui/update-model-context notification from the artefact. Spec
  // wire shape: { kind, ...event-specific fields } under
  // structuredContent. Field-routing identical to the pre-migration
  // path — only the envelope changes.
  const handleStructuredContent = useCallback(
    (structuredContent: Record<string, unknown>) => {
      const data = structuredContent as unknown as BoldkastStructuredContent;
      const kind = data.kind;
      if (typeof kind !== "string") return;

      const snap = snapshotRef.current;
      snap.lastEvent = kind;

      let shouldPush = false;
      let pushedMarker: string | undefined;
      let pushedPreset: string | undefined;

      if (kind === "boldkast.open") {
        shouldPush = true;
      } else if (kind === "boldkast.show_value" && typeof data.marker === "string") {
        const m = data.marker;
        const wasRevealed = snap.revealedMarkers.includes(m);
        if (data.revealed && !wasRevealed) {
          snap.revealedMarkers = [...snap.revealedMarkers, m];
          shouldPush = true;
          pushedMarker = m;
        } else if (!data.revealed && wasRevealed) {
          snap.revealedMarkers = snap.revealedMarkers.filter((x) => x !== m);
          // No push on un-reveal — agent doesn't need to know the
          // student hid a value they previously saw.
        }
      } else if (kind === "boldkast.param.change" && typeof data.value === "number") {
        // Update snapshot's current value (cheap).
        if (data.param === "v0") snap.v0 = data.value;
        else if (data.param === "theta") snap.theta = data.value;
        else if (data.param === "g") snap.g = data.value;
        const triggeredBy = data.triggeredBy || "";
        if (triggeredBy.startsWith("preset:") && data.param === "g") {
          // Deliberate planet preset click → push + card immediately.
          snap.lastPreset = triggeredBy.slice("preset:".length);
          shouldPush = true;
          pushedPreset = snap.lastPreset;
        } else {
          // Slider drag — fires per-pixel. Debounce 500ms then push the
          // final value + card so the student / dev can see what value
          // reached the agent.
          if (sliderDebounceRef.current !== null) {
            window.clearTimeout(sliderDebounceRef.current);
          }
          const finalParam = data.param;
          const finalValue = data.value;
          sliderDebounceRef.current = window.setTimeout(() => {
            const req = pushSnapshotRequest("boldkast.param.change");
            if (req && typeof finalParam === "string") {
              const label = labelForSliderEnd(finalParam, finalValue);
              humanToolEvents.dispatch({ label, push: () => req });
            } else if (req) {
              void req.catch(() => {});
            }
            sliderDebounceRef.current = null;
          }, 500);
        }
      }
      // play / pause / reset are intentionally not pushed — control
      // state isn't pedagogically interesting to the agent.

      if (shouldPush) {
        const req = pushSnapshotRequest(kind);
        if (req) {
          const label = labelForBoldkastEvent(kind, pushedMarker, pushedPreset);
          if (label) {
            humanToolEvents.dispatch({ label, push: () => req });
          } else {
            // No human-meaningful label (e.g. boldkast.open). Still
            // fire the push so the agent gets the state.
            void req.catch(() => {});
          }
        }
      }
    },
    [pushSnapshotRequest, humanToolEvents],
  );

  // Catch-up push when sessionId arrives. The student often opens the
  // sim and reveals markers BEFORE sending their first chat message;
  // pushes from before sessionId existed got dropped. When the session
  // is finally created, push whatever snapshot we've accumulated so
  // the agent's next prompt sees the prior interactions.
  useEffect(() => {
    if (!sessionId) return;
    const snap = snapshotRef.current;
    if (snap.lastEvent || snap.revealedMarkers.length > 0 || snap.lastPreset) {
      pushSnapshotSilent(snap.lastEvent || "catch-up");
    }
  }, [sessionId, pushSnapshotSilent]);

  // Flush any pending slider debounce on unmount.
  useEffect(() => {
    return () => {
      if (sliderDebounceRef.current !== null) {
        window.clearTimeout(sliderDebounceRef.current);
        sliderDebounceRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Boldkast — simulator
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Luk simulator"
        >
          ✕ Luk
        </button>
      </header>
      <StaticArtefactFrame
        sandboxOrigin={sandboxOrigin}
        artefactPath="boldkast/v1"
        onUpdateModelContext={handleStructuredContent}
        title="Boldkast projectile motion simulator"
        className="w-full min-h-[1100px] border-0"
      />
    </div>
  );
}
