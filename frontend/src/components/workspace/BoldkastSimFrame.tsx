"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { fetchWithAuth } from "@/lib/apiClient";

import {
  StaticArtefactFrame,
  type StaticArtefactFrameHandle,
} from "./StaticArtefactFrame";

/** Ref shape exposed by BoldkastSimFrame so callers (chat page) can
 *  trigger a pendingChanges flush in the artefact before sending a
 *  user message. See workbench-state-debounce.md Phase 2 for the
 *  commit-on-submit pattern. */
export interface BoldkastSimFrameHandle {
  /** Fire a ui/notifications/chat-flush JSON-RPC notification at the
   *  artefact so it emits any pending slider changes as a state-change
   *  with triggeredBy: "chat-submit" before the user message lands.
   *  Fire-and-forget — caller does not await. No-op if the artefact
   *  hasn't initialised yet. */
  sendChatFlush: () => void;
}

/** Human-readable Danish label for a pushed Boldkast event, used by
 *  HumanToolUseCard. Kept here (not the hook) so the mapping stays
 *  with the surface that owns the event semantics. */
function labelForBoldkastEvent(
  kind: string,
  marker?: string,
): string | null {
  if (kind === "boldkast.show_value" && marker) return `Afslørede ${marker}`;
  // boldkast.open and others: no card (not a pedagogical action).
  return null;
}

/** 1.E Phase 2 — single human-readable label per commit (Afspil or
 *  chat-submit). Lists the params the student touched in this commit
 *  with their final values. Symbols stay terse (v₀, θ, g) to match
 *  the sim's own UI. The triggeredBy verb (Afspil / Spørgsmål) leads
 *  the line so the student knows why a card appeared. */
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
  const verb = triggeredBy === "chat-submit" ? "Sendte spørgsmål med" : "Afspillede med";
  return parts.length > 0 ? `${verb} ${parts.join(", ")}` : `${verb} aktuel konfiguration`;
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
  /** 1.E Phase 2: boldkast.state-change carries the consolidated
   *  snapshot of params the student touched since the last commit.
   *  `changed` lists the keys (subset of {v0, theta, g}); `state`
   *  carries the full current values. */
  changed?: string[];
  state?: { v0?: number; theta?: number; g?: number };
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
export const BoldkastSimFrame = forwardRef<
  BoldkastSimFrameHandle,
  BoldkastSimFrameProps
>(function BoldkastSimFrame(
  { sandboxOrigin, sessionId, onClose },
  ref,
) {
  const humanToolEvents = useHumanToolEvents();
  const staticFrameRef = useRef<StaticArtefactFrameHandle | null>(null);
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
      let pushedLabel: string | undefined;

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
      } else if (kind === "boldkast.state-change" && Array.isArray(data.changed)) {
        // 1.E Phase 2: consolidated commit. The artefact buffered slider
        // changes locally until the student pressed Afspil OR the host
        // signalled a chat-flush. data.state carries the final values
        // for v0/theta/g; data.changed lists the keys the student
        // actually touched since the last commit. data.triggeredBy is
        // "play" | "chat-submit".
        const state = data.state ?? {};
        if (typeof state.v0 === "number") snap.v0 = state.v0;
        if (typeof state.theta === "number") snap.theta = state.theta;
        if (typeof state.g === "number") snap.g = state.g;
        shouldPush = true;
        pushedLabel = labelForStateChange(data.changed, state, data.triggeredBy);
      }
      // play / pause / reset are intentionally not pushed — control
      // state isn't pedagogically interesting to the agent.

      if (shouldPush) {
        const req = pushSnapshotRequest(kind);
        if (req) {
          // Phase 2 state-change supplies its own pre-computed label;
          // legacy show_value events fall through to the event-vocab
          // mapper.
          const label =
            pushedLabel ?? labelForBoldkastEvent(kind, pushedMarker);
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

  // 1.E Phase 2 — expose sendChatFlush so the chat page can ask the
  // artefact to flush pending slider changes before sending a user
  // message. Fire-and-forget. No-op if the artefact hasn't init'd.
  useImperativeHandle(
    ref,
    () => ({
      sendChatFlush: () => {
        staticFrameRef.current?.sendNotification(
          "ui/notifications/chat-flush",
          {},
        );
      },
    }),
    [],
  );

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
          Luk
        </button>
      </header>
      <StaticArtefactFrame
        ref={staticFrameRef}
        sandboxOrigin={sandboxOrigin}
        artefactPath="boldkast/v1"
        onUpdateModelContext={handleStructuredContent}
        title="Boldkast projectile motion simulator"
        className="w-full min-h-[1100px] border-0"
      />
    </div>
  );
});
