// useSandboxedIframeMessages — paved path for host-side iframe auth.
//
// Why a hook (vs. each MCP App writing its own listener):
//
// ADR-013 requires `sandbox="allow-scripts"` on artefact iframes, with
// no `allow-same-origin`. That makes the iframe's effective origin
// OPAQUE — every postMessage arrives at the host with `e.origin === "null"`.
// Origin-based auth (`if (e.origin !== expectedOrigin) return`) rejects
// every legitimate event silently. Caught live on 2026-05-21 when the
// first artefact (Boldkast) shipped with that check and zero events
// reached the agent for an entire test session.
//
// The correct pattern under that sandbox profile is to authenticate by
// WINDOW IDENTITY: `e.source === iframeRef.current.contentWindow`. The
// host owns the <iframe> element so it knows which contentWindow is the
// legitimate sender. Combined with the artefact's claimed
// `data.source === sourceMarker` type tag, only events from the host's
// own iframe with the artefact's declared type marker reach the
// application code.
//
// This hook centralises that auth gate. Every future MCP App artefact
// (energy sim, friction sim, free-body diagrams in v1; physics games
// in Strand B) consumes the hook and inherits the audited auth path.
// Authors don't have to know the gotcha — they ref the iframe, name
// the type marker, write the handler.
//
// See: docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-harness.md
// See: ADR-013 (artefact safety / sandbox profile).

"use client";

import { useEffect, type RefObject } from "react";

/** Minimum shape every artefact's wire format MUST conform to. The
 *  artefact-specific payload type extends this with its own fields. */
export interface SandboxedIframeMessage {
  /** Type-marker — e.g. "boldkast", "energy-sim". The hook rejects
   *  events whose `data.source` doesn't match `opts.sourceMarker`. */
  source: string;
  /** Event type — e.g. "boldkast.show_value". The hook rejects events
   *  where `data.type` is not a string. */
  type: string;
}

export interface UseSandboxedIframeMessagesOptions<T extends SandboxedIframeMessage> {
  /** Ref on the <iframe> element. Read at event time so attaching the
   *  ref AFTER the hook runs (e.g. iframe mounts conditionally) just
   *  works. */
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** Required type-marker. Events with `data.source !== sourceMarker`
   *  are rejected before the handler sees them. Lets two MCP Apps
   *  coexist on the same page without colliding — a Boldkast iframe
   *  can't spoof events from an Energy Sim iframe even if both render
   *  in the same chat tree. */
  sourceMarker: string;
  /** Called once per legitimate, authenticated, type-tagged event. */
  onMessage: (data: T) => void;
  /** Optional: dev-mode console label. Defaults to `sourceMarker`.
   *  Every accepted event is logged in dev so authors can see whether
   *  the wire is firing — closes the "is it sending?" debug gap that
   *  cost an hour on 2026-05-21. */
  debugLabel?: string;
}

/**
 * Register a window message listener that accepts events only from the
 * given iframe (window-identity auth), rejects events that don't carry
 * the artefact's type marker, and cleans up on unmount.
 *
 * Usage (mirror in any new MCP App artefact wrapper):
 *
 * ```tsx
 * interface MyArtefactMessage extends SandboxedIframeMessage {
 *   type: "myart.event-a" | "myart.event-b";
 *   value?: number;
 * }
 *
 * const iframeRef = useRef<HTMLIFrameElement | null>(null);
 * useSandboxedIframeMessages<MyArtefactMessage>({
 *   iframeRef,
 *   sourceMarker: "myart",
 *   onMessage: (data) => {
 *     // data.source === "myart" and data.type is a string, guaranteed
 *   },
 * });
 *
 * return <iframe ref={iframeRef} sandbox="allow-scripts" src={...} />;
 * ```
 */
export function useSandboxedIframeMessages<T extends SandboxedIframeMessage>(
  opts: UseSandboxedIframeMessagesOptions<T>,
): void {
  const { iframeRef, sourceMarker, onMessage, debugLabel } = opts;
  const label = debugLabel || sourceMarker;

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      // Window-identity auth: only events from the iframe element we
      // own pass. Origin can't be used here — see file header.
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const data = e.data as unknown;
      if (!data || typeof data !== "object") return;
      const candidate = data as Partial<SandboxedIframeMessage>;
      if (candidate.source !== sourceMarker) return;
      if (typeof candidate.type !== "string") return;
      // All checks passed. The cast is safe because callers extend
      // SandboxedIframeMessage; field-shape validation beyond the
      // type marker is the caller's responsibility.
      const typed = candidate as T;
      onMessage(typed);
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log(`[${label}]`, typed);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // onMessage is intentionally omitted from deps — every dispatch
    // would otherwise rebind the listener and miss events fired
    // during the swap. Callers should pass a stable handler (e.g.
    // via useCallback or refs internal to their component). The
    // existing BoldkastSimFrame consumer does exactly that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeRef, sourceMarker, label]);
}
