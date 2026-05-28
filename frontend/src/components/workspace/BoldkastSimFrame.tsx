"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import type {
  BoldkastEvent,
  BoldkastMarker,
} from "@/hooks/useBoldkastSnapshot";

import {
  StaticArtefactFrame,
  type StaticArtefactFrameHandle,
} from "./StaticArtefactFrame";

/** Ref shape exposed by BoldkastSimFrame so callers (chat page) can
 *  trigger a pendingChanges flush in the artefact before sending a
 *  user message. See workbench-state-debounce.md Phase 2. */
export interface BoldkastSimFrameHandle {
  /** Fire a ui/notifications/chat-flush JSON-RPC notification at the
   *  artefact so it emits any pending slider changes as a state-change
   *  with triggeredBy: "chat-submit" before the user message lands.
   *  Fire-and-forget. No-op if the artefact hasn't initialised yet. */
  sendChatFlush: () => void;
}

/** Spec-side payload shape: structuredContent.kind carries the
 *  artefact's event vocabulary, the rest are event-specific fields. */
interface BoldkastStructuredContent {
  kind: string;
  marker?: string;
  revealed?: boolean;
  triggeredBy?: string;
  changed?: string[];
  state?: { v0?: number; theta?: number; g?: number };
}

interface BoldkastSimFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html). */
  sandboxOrigin: string;
  /** Bench events (open, state-change, show_value) route here into the
   *  shared snapshot hook. play/pause/reset are not pedagogically
   *  interesting and are dropped. */
  reportEvent: (evt: BoldkastEvent) => void;
  /** Called on user-close so the workspace returns to the workbench. */
  onClose: () => void;
}

/**
 * BoldkastSimFrame — host wrapper around the bench-ONLY Boldkast
 * projectile artefact. After the usability pass the iframe is just the
 * live sim; the journey + config + results mirror live in the React
 * BoldkastWorkbench. So this Frame no longer accumulates the snapshot
 * (useBoldkastSnapshot does) — it only routes the iframe's events to
 * reportEvent and flushes pending slider changes on chat-submit.
 * Mirrors KineBotFrame / LedPlanckLabFrame.
 */
export const BoldkastSimFrame = forwardRef<
  BoldkastSimFrameHandle,
  BoldkastSimFrameProps
>(function BoldkastSimFrame({ sandboxOrigin, reportEvent, onClose }, ref) {
  const staticFrameRef = useRef<StaticArtefactFrameHandle | null>(null);
  const reportEventRef = useRef(reportEvent);
  reportEventRef.current = reportEvent;

  const handleStructuredContent = useCallback(
    (structuredContent: Record<string, unknown>) => {
      const data = structuredContent as unknown as BoldkastStructuredContent;
      const kind = data.kind;
      const report = reportEventRef.current;

      if (kind === "boldkast.open") {
        report({ kind: "boldkast.open" });
      } else if (kind === "boldkast.state-change" && Array.isArray(data.changed)) {
        report({
          kind: "boldkast.state-change",
          changed: data.changed,
          state: data.state ?? {},
          triggeredBy: data.triggeredBy,
        });
      } else if (
        kind === "boldkast.show_value" &&
        typeof data.marker === "string" &&
        typeof data.revealed === "boolean"
      ) {
        report({
          kind: "boldkast.show_value",
          marker: data.marker as BoldkastMarker,
          revealed: data.revealed,
        });
      }
      // play / pause / reset: not routed (not pedagogically interesting).
    },
    [],
  );

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
