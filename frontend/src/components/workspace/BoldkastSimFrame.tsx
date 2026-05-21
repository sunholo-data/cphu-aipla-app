"use client";

import { useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/apiClient";

interface BoldkastSimFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html) — e.g.
   *  `https://aipla-v01-sandbox-...lz.a.run.app`. The component appends
   *  the artefact path so callers pass just the origin. */
  sandboxOrigin: string;
  /** Active chat session id. When set, sim interactions (open / Vis
   * reveal / gravity preset click) are POSTed to the iframe-context
   * endpoint so the agent's next prompt sees what the student did in
   * the sim. When null (no session yet), events are still logged in
   * dev but not pushed — agent has nothing to attach them to. */
  sessionId: string | null;
  /** Called on user-close so the workspace can return to its default
   * content (problem statement + checklist). */
  onClose: () => void;
}

interface BoldkastMessage {
  source?: string;
  type?: string;
  marker?: string;
  param?: string;
  value?: number;
  revealed?: boolean;
  triggeredBy?: string;
}

interface BoldkastSnapshot {
  /** Most recent event type — UI signal for the agent to react to. */
  lastEvent: string;
  /** Cumulative set of markers the student has REVEALED so far. The
   * agent uses this to scaffold ("I see you've found y_max — what
   * about the range?") without seeing the values themselves. */
  revealedMarkers: string[];
  /** Current sim parameters. The agent can compare against the
   * problem's givens (v0=15, theta=40, g=9.82) to detect whether
   * the student has set the sim to match the problem yet. */
  v0: number | null;
  theta: number | null;
  g: number | null;
  /** Latest g-preset the student clicked (Earth / Moon / Mars / Jupiter)
   * — distinct from raw g value so the agent can see if the student
   * is exploring non-Earth gravity. */
  lastPreset: string | null;
}

/**
 * BoldkastSimFrame — sandboxed iframe wrapper around the Boldkast
 * projectile-motion artefact served by the mcp-sandbox Cloud Run
 * service. Renders the artefact at `${sandboxOrigin}/artefacts/boldkast/v1/`.
 *
 * Two security layers per ADR-013:
 *  1. Server-side CSP (set on /artefacts/* by infrastructure/mcp-sandbox/serve.ts).
 *  2. Host-side iframe sandbox attribute below — `allow-scripts` only;
 *     deliberately NO `allow-same-origin`, NO `allow-top-navigation`,
 *     NO `allow-popups`. Combined, the artefact runs in a unique-origin
 *     sandbox with no access to host cookies or the chrome of the host
 *     window.
 *
 * postMessage events from the artefact (open/play/pause/reset/
 * show_value/param.change) are filtered by origin before being
 * console-logged. v1 will plumb them into the AG-UI tool-call surface
 * via MCPAppToolCallRouter so the agent sees student interactions; for
 * v0.1 the demo lives without that path.
 */
export function BoldkastSimFrame({ sandboxOrigin, sessionId, onClose }: BoldkastSimFrameProps) {
  const expectedOrigin = sandboxOrigin.replace(/\/$/, "");
  const iframeUrl = `${expectedOrigin}/artefacts/boldkast/v1/index.html`;
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

  useEffect(() => {
    const pushSnapshot = (latestType: string) => {
      if (!sessionId) return; // no session = nothing for the agent to attach to
      const body = {
        serverId: "boldkast",
        toolName: "state",
        structuredContent: { ...snapshotRef.current, lastEvent: latestType },
      };
      void fetchWithAuth(`/api/proxy/api/sessions/${sessionId}/iframe-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch((err) => {
        // Non-fatal: the sim still works locally; the agent just won't
        // see this event. Surface in dev so we know the wiring's right.
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[boldkast] iframe-context push failed:", err);
        }
      });
    };

    const onMessage = (e: MessageEvent) => {
      // ADR-013 contract: validate origin BEFORE reading e.data.
      if (e.origin !== expectedOrigin) return;
      const data = e.data as BoldkastMessage;
      if (!data || data.source !== "boldkast" || typeof data.type !== "string") return;

      const snap = snapshotRef.current;
      snap.lastEvent = data.type;

      // Update the snapshot based on event type, then decide whether
      // to push. We push on PEDAGOGICALLY MEANINGFUL events only:
      // open / show_value / preset-click. Slider-drag param.change is
      // skipped to avoid flooding session state (it fires per-pixel
      // during drag).
      let shouldPush = false;

      if (data.type === "boldkast.open") {
        shouldPush = true;
      } else if (data.type === "boldkast.show_value" && typeof data.marker === "string") {
        const m = data.marker;
        const wasRevealed = snap.revealedMarkers.includes(m);
        if (data.revealed && !wasRevealed) {
          snap.revealedMarkers = [...snap.revealedMarkers, m];
          shouldPush = true;
        } else if (!data.revealed && wasRevealed) {
          snap.revealedMarkers = snap.revealedMarkers.filter((x) => x !== m);
          // No push on un-reveal — agent doesn't need to know the
          // student hid a value they previously saw.
        }
      } else if (data.type === "boldkast.param.change" && typeof data.value === "number") {
        // Always update the snapshot's current value (cheap), but only
        // push when the source is "preset:..." (a deliberate planet
        // click) — slider drags are silent.
        if (data.param === "v0") snap.v0 = data.value;
        else if (data.param === "theta") snap.theta = data.value;
        else if (data.param === "g") snap.g = data.value;
        const triggeredBy = data.triggeredBy || "";
        if (triggeredBy.startsWith("preset:") && data.param === "g") {
          snap.lastPreset = triggeredBy.slice("preset:".length);
          shouldPush = true;
        }
      }
      // play / pause / reset events are intentionally not pushed —
      // control state isn't pedagogically interesting to the agent.

      if (shouldPush) {
        pushSnapshot(data.type);
      }

      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[boldkast]", data, shouldPush ? "(pushed)" : "(local-only)");
      }
    };
    window.addEventListener("message", onMessage);

    // Catch-up push when sessionId arrives. The student often opens the
    // sim and reveals markers BEFORE sending their first chat message;
    // pushes from before sessionId existed got dropped. When the session
    // is finally created, push whatever snapshot we've accumulated so
    // the agent's next prompt sees the prior interactions.
    if (sessionId) {
      const snap = snapshotRef.current;
      if (snap.lastEvent || snap.revealedMarkers.length > 0 || snap.lastPreset) {
        pushSnapshot(snap.lastEvent || "catch-up");
      }
    }

    return () => window.removeEventListener("message", onMessage);
  }, [expectedOrigin, sessionId]);

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
      {/* Width + height contract: w-full so the iframe always tracks
          the workspace column's width (without this iOS Safari hits
          the iframe's 300px default and the canvas inside renders at
          0 height because its CSS width:100% calc collapses). Min-height
          of 1100px is the artefact's natural content height (canvas +
          controls + markers + 2 graphs); the WorkspaceShell's inner
          overflow-y-auto handles the outer scroll on screens shorter
          than that. The artefact's own iframe-internal scrollbar would
          otherwise compete with the workspace scroll on mobile, which
          confuses tap-targeting on iOS. */}
      <iframe
        src={iframeUrl}
        title="Boldkast projectile motion simulator"
        // allow-scripts only. NO allow-same-origin, NO allow-top-navigation,
        // NO allow-popups, NO allow-forms — minimum needed to let the
        // canvas JS run.
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="eager"
        className="w-full min-h-[1100px] border-0"
      />
    </div>
  );
}
