"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from "react";

import type { KineBotEvent } from "@/hooks/useKineBotSnapshot";

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

interface KineBotStructuredContent {
  kind: string;
  simType?: string;
  params?: Record<string, number>;
  changed?: string[];
  state?: Record<string, number>;
  triggeredBy?: string;
}

interface KineBotFrameProps {
  sandboxOrigin: string;
  /** Current topic — synced into the iframe once its handshake
   *  completes so the sim opens on the topic the student picked in the
   *  workbench (even if they picked it before opening the sim). */
  topic: string;
  /** Sim events (sim-run, state-change) route here, into the shared
   *  snapshot hook. Quiz + graph events come from the React workbench,
   *  not the iframe. */
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
    const reportEventRef = useRef(reportEvent);
    reportEventRef.current = reportEvent;
    const topicRef = useRef(topic);
    topicRef.current = topic;

    const handleStructuredContent = useCallback(
      (structuredContent: Record<string, unknown>) => {
        const data = structuredContent as unknown as KineBotStructuredContent;
        const kind = data.kind;
        if (kind === "kinebot.sim-run") {
          if (typeof data.simType === "string" && data.params) {
            reportEventRef.current({
              kind: "kinebot.sim-run",
              simType: data.simType,
              params: data.params,
            });
          }
        } else if (kind === "kinebot.state-change") {
          reportEventRef.current({
            kind: "kinebot.state-change",
            changed: data.changed,
            state: data.state,
            triggeredBy: data.triggeredBy,
          });
        }
        // graph-change + quiz-attempt no longer come from the iframe —
        // those surfaces are React now.
      },
      [],
    );

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
      <div className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            KineBot — simulation
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close simulation"
          >
            Close
          </button>
        </header>
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
