"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

import {
  useArtefactReportEvent,
} from "@/hooks/useArtefactReportEvent";
import type {
  BoldkastEvent,
  BoldkastMarker,
} from "@/hooks/useBoldkastSnapshot";

import { SimFrameHeader } from "./SimFrameHeader";
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

interface BoldkastSimFrameProps {
  /** Sandbox origin (NO trailing /sandbox.html). */
  sandboxOrigin: string;
  /** Reports bench events into the shared snapshot hook. Routing is
   *  denylist-shaped via useArtefactReportEvent: pause / reset drop,
   *  state-change / show_value get typed payload narrowers,
   *  open / play (and any future kinds) flow through as `{kind}` so
   *  proactive-reactive wiring picks them up automatically. */
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
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const handleStructuredContent = useArtefactReportEvent<BoldkastEvent>({
    report: reportEvent,
    // Drop noise: pause + reset aren't progress (undo / pause aren't
    // proactive-trigger-worthy). Everything else flows through.
    drop: new Set(["boldkast.pause", "boldkast.reset"]),
    narrow: {
      "boldkast.state-change": (d) =>
        Array.isArray(d.changed)
          ? {
              kind: "boldkast.state-change",
              changed: d.changed as string[],
              state:
                (d.state as { v0?: number; theta?: number; g?: number }) ?? {},
              triggeredBy: d.triggeredBy as string | undefined,
            }
          : null,
      "boldkast.show_value": (d) =>
        typeof d.marker === "string" && typeof d.revealed === "boolean"
          ? {
              kind: "boldkast.show_value",
              marker: d.marker as BoldkastMarker,
              revealed: d.revealed,
            }
          : null,
    },
  });

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
    <div ref={wrapperRef} className="flex min-h-0 flex-col bg-background">
      <SimFrameHeader
        title="Boldkast — simulator"
        closeLabel="Luk"
        closeAriaLabel="Luk simulator"
        fullscreenAriaLabel="Skift fuldskærm"
        onClose={onClose}
        fullscreenTarget={wrapperRef.current}
      />
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
