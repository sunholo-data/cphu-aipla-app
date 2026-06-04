"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";

import { useArtefactReportEvent } from "@/hooks/useArtefactReportEvent";
import type { KineBotEvent } from "@/hooks/useKineBotSnapshot";

import { SimFrameHeader } from "./SimFrameHeader";
import {
  StaticArtefactFrame,
  type StaticArtefactFrameHandle,
} from "./StaticArtefactFrame";

export interface KineBotFrameHandle {
  /** Flush pending sim-slider changes before a chat message lands. */
  sendChatFlush: () => void;
  /** Push a topic into the iframe so the sim re-renders for it. The
   *  workbench owns the topic state (via the snapshot hook); this only
   *  forwards the notification to the iframe. No-op if not mounted. */
  setTopic: (topic: string) => void;
}

interface KineBotFrameProps {
  sandboxOrigin: string;
  /** Current topic — synced into the iframe once its handshake
   *  completes so the sim opens on the topic the student picked in the
   *  workbench (even if they picked it before opening the sim). */
  topic: string;
  /** Reports iframe-side bench events (sim-run, state-change) into the
   *  shared snapshot hook. Routing is denylist-shaped via
   *  useArtefactReportEvent: graph-change + quiz-attempt drop on the
   *  iframe side (those come from the React workbench surface). */
  reportEvent: (evt: KineBotEvent) => void;
  onClose: () => void;
}

/**
 * KineBotFrame — host wrapper around the sim-ONLY KineBot iframe.
 *
 * After the workbench-split rework the iframe is just the live
 * simulation; quiz + graph + topic nav + notes live in the React
 * workbench. So this Frame no longer accumulates the snapshot (the
 * useKineBotSnapshot hook does) — it only:
 *   - routes the iframe's sim-run + state-change events to reportEvent
 *   - forwards a set-topic notification into the iframe (sim re-render)
 *   - flushes pending slider changes on chat-submit
 *   - syncs the current topic into the iframe on init handshake
 */
export const KineBotFrame = forwardRef<KineBotFrameHandle, KineBotFrameProps>(
  function KineBotFrame({ sandboxOrigin, topic, reportEvent, onClose }, ref) {
    const staticFrameRef = useRef<StaticArtefactFrameHandle | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const topicRef = useRef(topic);
    topicRef.current = topic;

    const handleStructuredContent = useArtefactReportEvent<KineBotEvent>({
      report: reportEvent,
      // Drop: graph-change + quiz-attempt are produced by the React
      // workbench surface, not the iframe. If the iframe ever emits
      // them they're a desync — silently drop on the iframe side.
      drop: new Set(["kinebot.graph-change", "kinebot.quiz-attempt"]),
      narrow: {
        "kinebot.sim-run": (d) =>
          typeof d.simType === "string" && d.params
            ? {
                kind: "kinebot.sim-run",
                simType: d.simType,
                params: d.params as Record<string, number>,
              }
            : null,
        "kinebot.state-change": (d) => ({
          kind: "kinebot.state-change",
          changed: d.changed as string[] | undefined,
          state: d.state as Record<string, number> | undefined,
          triggeredBy: d.triggeredBy as string | undefined,
        }),
      },
    });

    const handleInitialized = useCallback(() => {
      // Sync the sim to the workbench's current topic once the iframe
      // is ready, so opening the sim after picking a topic shows the
      // right simulation.
      if (topicRef.current) {
        staticFrameRef.current?.sendNotification("kinebot.set-topic", {
          topic: topicRef.current,
        });
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        sendChatFlush: () => {
          staticFrameRef.current?.sendNotification(
            "ui/notifications/chat-flush",
            {},
          );
        },
        setTopic: (t: string) => {
          staticFrameRef.current?.sendNotification("kinebot.set-topic", {
            topic: t,
          });
        },
      }),
      [],
    );

    return (
      <div ref={wrapperRef} className="flex min-h-0 flex-col bg-background">
        <SimFrameHeader
          title="KineBot — simulation"
          closeLabel="Close"
          closeAriaLabel="Close simulation"
          fullscreenAriaLabel="Toggle fullscreen"
          onClose={onClose}
          fullscreenTarget={wrapperRef.current}
        />
        <StaticArtefactFrame
          ref={staticFrameRef}
          sandboxOrigin={sandboxOrigin}
          artefactPath="kinebot/v1"
          onUpdateModelContext={handleStructuredContent}
          onInitialized={handleInitialized}
          title="KineBot kinematics simulation"
          className="w-full min-h-[520px] border-0"
        />
      </div>
    );
  },
);
