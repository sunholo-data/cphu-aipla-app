"use client";

import { useEffect, useRef } from "react";

interface BoldkastSimFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html) — e.g.
   *  `https://aipla-v01-sandbox-...lz.a.run.app`. The component appends
   *  the artefact path so callers pass just the origin. */
  sandboxOrigin: string;
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
export function BoldkastSimFrame({ sandboxOrigin, onClose }: BoldkastSimFrameProps) {
  const expectedOrigin = sandboxOrigin.replace(/\/$/, "");
  const iframeUrl = `${expectedOrigin}/artefacts/boldkast/v1/index.html`;
  const lastEventRef = useRef<string>("");

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // ADR-013 contract: validate origin BEFORE reading e.data.
      if (e.origin !== expectedOrigin) return;
      const data = e.data as BoldkastMessage;
      if (!data || data.source !== "boldkast" || typeof data.type !== "string") return;
      // Dev observability — replace with OTel push in v1 once we wire
      // /api/proxy/api/sessions/{id}/iframe-context to accept these.
      lastEventRef.current = data.type;
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.log("[boldkast]", data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [expectedOrigin]);

  return (
    <div className="flex h-full min-h-0 flex-col">
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
      <iframe
        src={iframeUrl}
        title="Boldkast projectile motion simulator"
        // allow-scripts only. NO allow-same-origin, NO allow-top-navigation,
        // NO allow-popups, NO allow-forms — minimum needed to let the
        // canvas JS run.
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        loading="eager"
        className="min-h-0 flex-1 border-0"
      />
    </div>
  );
}
