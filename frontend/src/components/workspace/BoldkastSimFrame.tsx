"use client";

import { useEffect, useRef } from "react";
import { fetchWithAuth } from "@/lib/apiClient";
import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";

/** Human-readable Danish label for a pushed Boldkast event, used by
 *  HumanToolUseCard. Kept here (not the hook) so the mapping stays
 *  with the surface that owns the event semantics. */
function labelForBoldkastEvent(
  type: string,
  marker?: string,
  preset?: string,
): string | null {
  if (type === "boldkast.show_value" && marker) return `Afslørede ${marker}`;
  if (type === "boldkast.param.change" && preset) {
    const planet =
      { earth: "Jorden", moon: "Månen", mars: "Mars", jupiter: "Jupiter" }[preset.toLowerCase()] ??
      preset;
    return `Skiftede tyngdekraft til ${planet}`;
  }
  // boldkast.open and others: no card (not a pedagogical action).
  return null;
}

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
  const humanToolEvents = useHumanToolEvents();
  // Debounce handle for slider-drag pushes. window.setTimeout returns a
  // number; null when no debounce is pending.
  const sliderDebounceRef = useRef<number | null>(null);
  // Ref on the iframe element so the message handler can check
  // `e.source === iframeRef.current.contentWindow` — origin-based
  // checks don't work for sandboxed iframes without allow-same-origin
  // (their effective origin is "null"). Per ADR-013 we deliberately
  // keep allow-same-origin OFF, so we authenticate by window identity.
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
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
    const pushSnapshotRequest = (latestType: string): Promise<Response> | null => {
      if (!sessionId) return null; // no session = nothing for the agent to attach to
      const body = {
        serverId: "boldkast",
        toolName: "state",
        structuredContent: { ...snapshotRef.current, lastEvent: latestType },
      };
      return fetchWithAuth(`/api/proxy/api/sessions/${sessionId}/iframe-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    // Silent push for the catch-up effect (sessionId arrived late).
    // Does not dispatch a card — the original click already happened
    // and (likely) had a card; we don't want to confuse the student
    // with a card appearing for an action they performed minutes ago.
    const pushSnapshotSilent = (latestType: string) => {
      const req = pushSnapshotRequest(latestType);
      if (!req) return;
      void req.catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[boldkast] iframe-context push failed:", err);
        }
      });
    };

    // Push and dispatch a human-tool-use card if the event has a label.
    const pushSnapshotWithCard = (latestType: string, marker?: string, preset?: string) => {
      const req = pushSnapshotRequest(latestType);
      if (!req) {
        // No session yet — push will be retried by the catch-up effect.
        // No card either; the student will see the card the next time
        // they click after the session has been created.
        return;
      }
      const label = labelForBoldkastEvent(latestType, marker, preset);
      if (label) {
        humanToolEvents.dispatch({ label, push: () => req });
      } else {
        // No human-meaningful label (e.g. boldkast.open). Still fire
        // the push so the agent gets the state.
        void req.catch((err) => {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[boldkast] iframe-context push failed:", err);
          }
        });
      }
    };

    const onMessage = (e: MessageEvent) => {
      // ADR-013 contract: authenticate the sender BEFORE reading e.data.
      // We can't check `e.origin === sandboxOrigin` because the iframe
      // runs with `sandbox="allow-scripts"` and no `allow-same-origin`
      // — that makes its effective origin opaque ("null") so the origin
      // check would reject every legitimate event. Instead we check
      // `e.source === iframeRef.current.contentWindow`: only messages
      // coming from THIS exact iframe's window are accepted. Combined
      // with the data.source === "boldkast" type-marker filter below,
      // that's a strict authentication. Caught live on 2026-05-21 when
      // M's slider drags + Vis clicks weren't producing any pushes.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
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
      let pushedMarker: string | undefined;
      let pushedPreset: string | undefined;

      if (data.type === "boldkast.open") {
        shouldPush = true;
      } else if (data.type === "boldkast.show_value" && typeof data.marker === "string") {
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
      } else if (data.type === "boldkast.param.change" && typeof data.value === "number") {
        // Always update the snapshot's current value (cheap).
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
          // final value silently so the agent sees the student's
          // chosen v0 / theta / g without flooding state. No card —
          // would create one chip per drag-end which is noisy. The
          // student already sees the slider's value next to the
          // handle; the card adds nothing.
          // 2026-05-21: added after live testing showed M's slider
          // drags weren't reaching the agent, breaking "are my values
          // close to correct?" — the very prompt the demo is built on.
          if (sliderDebounceRef.current !== null) {
            window.clearTimeout(sliderDebounceRef.current);
          }
          sliderDebounceRef.current = window.setTimeout(() => {
            pushSnapshotSilent("boldkast.param.change");
            sliderDebounceRef.current = null;
          }, 500);
        }
      }
      // play / pause / reset events are intentionally not pushed —
      // control state isn't pedagogically interesting to the agent.

      if (shouldPush) {
        pushSnapshotWithCard(data.type, pushedMarker, pushedPreset);
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
        pushSnapshotSilent(snap.lastEvent || "catch-up");
      }
    }

    return () => {
      window.removeEventListener("message", onMessage);
      // Flush any pending slider debounce on unmount — keeps the
      // last-known values reaching the agent if the student closes
      // the sim mid-drag.
      if (sliderDebounceRef.current !== null) {
        window.clearTimeout(sliderDebounceRef.current);
        sliderDebounceRef.current = null;
      }
    };
    // humanToolEvents is intentionally excluded: its `dispatch` is a
    // useCallback(..., []) (stable for the page lifetime), and adding it
    // would rebind the message listener every render → lost events on
    // re-render. Same pattern as other surface listeners in this repo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        ref={iframeRef}
        src={iframeUrl}
        title="Boldkast projectile motion simulator"
        // allow-scripts only. NO allow-same-origin, NO allow-top-navigation,
        // NO allow-popups, NO allow-forms — minimum needed to let the
        // canvas JS run. Note: this means the iframe has an opaque
        // origin — postMessage events arrive with e.origin === "null".
        // We authenticate via e.source === iframeRef.current.contentWindow
        // in onMessage above.
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="eager"
        className="w-full min-h-[1100px] border-0"
      />
    </div>
  );
}
