"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";

export interface KineBotSimRun {
  simType: string;
  params: Record<string, number>;
}

export interface KineBotSnapshot {
  lastEvent: string;
  currentTopic: string | null;
  topicsVisited: string[];
  lastSimRun: KineBotSimRun | null;
  currentGraph: string | null;
  quizProgress: Array<{ topic: string; attempts: number; correct: number }>;
}

/** Every pedagogically meaningful event, regardless of which surface
 *  produced it. The iframe (sim) reports sim-run + state-change; the
 *  React workbench reports set-topic (topic picker), graph-change
 *  (graph component), and quiz-attempt (quiz component). One channel,
 *  one accumulated snapshot, one place that POSTs to the agent. */
export type KineBotEvent =
  | { kind: "kinebot.sim-run"; simType: string; params: Record<string, number> }
  | { kind: "kinebot.graph-change"; graphType: string }
  | {
      kind: "kinebot.quiz-attempt";
      topic: string;
      questionId: string;
      answeredCorrectly: boolean;
    }
  | { kind: "kinebot.set-topic"; topic: string }
  | {
      kind: "kinebot.state-change";
      changed?: string[];
      state?: Record<string, number>;
      triggeredBy?: string;
    };

const TOPIC_LABELS_EN: Record<string, string> = {
  intro: "Intro to Motion",
  displacement: "Distance & Displacement",
  velocity: "Speed & Velocity",
  acceleration: "Acceleration",
  equations: "Equations of Motion",
  graphs: "Motion Graphs",
  freefall: "Free Fall",
  vectors: "Vectors & Scalars",
  projectile: "Projectile Motion",
  circular: "Circular Motion",
  relative: "Relative Velocity",
};

const GRAPH_LABELS: Record<string, string> = {
  xt: "x-t",
  vt: "v-t",
  at: "a-t",
  range: "range-vs-angle",
  height: "max-height-vs-angle",
};

const SIM_TYPE_LABELS: Record<string, string> = {
  "1d": "1D motion",
  accel: "acceleration",
  projectile: "projectile",
  circular: "circular motion",
  vectors: "vector",
  freefall: "free fall",
  relative: "relative velocity",
};

export function labelForTopic(topic: string): string {
  return TOPIC_LABELS_EN[topic] ?? topic;
}

function labelForGraph(graphType: string): string {
  return GRAPH_LABELS[graphType] ?? graphType;
}

function labelForSimRun(simType: string, params: Record<string, number>): string {
  const parts: string[] = [];
  if (params.velocity !== undefined) parts.push(`v=${params.velocity} m/s`);
  if (params.acceleration !== undefined) parts.push(`a=${params.acceleration} m/s²`);
  if (params.angle !== undefined) parts.push(`θ=${params.angle}°`);
  if (params.v2 !== undefined) parts.push(`v₂=${params.v2} m/s`);
  const typeLabel = SIM_TYPE_LABELS[simType] ?? simType;
  return `Ran ${typeLabel} sim${parts.length ? ": " + parts.join(", ") : ""}`;
}

const INITIAL: KineBotSnapshot = {
  lastEvent: "",
  currentTopic: null,
  topicsVisited: [],
  lastSimRun: null,
  currentGraph: null,
  quizProgress: [],
};

export interface UseKineBotSnapshot {
  snapshot: KineBotSnapshot;
  /** Apply an event: mutate the snapshot, push iframe-context to the
   *  agent, and dispatch a chat card when the event is pedagogically
   *  card-worthy. Callable from any surface (Frame or workbench). */
  reportEvent: (evt: KineBotEvent) => void;
}

/**
 * useKineBotSnapshot — single source of truth for KineBot's
 * workbench state, shared by the sim iframe (KineBotFrame) and the
 * React surfaces (quiz, graph, topic picker). Owns:
 *   - snapshot accumulation (returned as state so consumers re-render)
 *   - the iframe-context POST to /api/sessions/{id}/iframe-context
 *   - the human-tool-event card dispatch (push-with-card vs silent)
 *   - catch-up push when sessionId arrives late
 *
 * Before the workbench-split rework this logic lived inside
 * KineBotFrame; lifting it lets the React quiz + graph report events
 * through the same path the sim does, so what the student sees and
 * what the tutor sees never diverge.
 */
export function useKineBotSnapshot(
  sessionId: string | null,
): UseKineBotSnapshot {
  const humanToolEvents = useHumanToolEvents();
  const [snapshot, setSnapshot] = useState<KineBotSnapshot>(INITIAL);
  const snapshotRef = useRef<KineBotSnapshot>(snapshot);
  snapshotRef.current = snapshot;
  const pushSnapshotRequest = useSimSnapshotPush<KineBotSnapshot>(
    sessionId,
    "kinebot",
  );

  const reportEvent = useCallback(
    (evt: KineBotEvent) => {
      const prev = snapshotRef.current;
      const next: KineBotSnapshot = { ...prev, lastEvent: evt.kind };
      let pushedLabel: string | null = null;

      switch (evt.kind) {
        case "kinebot.sim-run": {
          next.lastSimRun = { simType: evt.simType, params: evt.params };
          pushedLabel = labelForSimRun(evt.simType, evt.params);
          break;
        }
        case "kinebot.graph-change": {
          next.currentGraph = evt.graphType;
          pushedLabel = `Viewing ${labelForGraph(evt.graphType)} graph`;
          break;
        }
        case "kinebot.quiz-attempt": {
          const existing = prev.quizProgress.findIndex(
            (p) => p.topic === evt.topic,
          );
          if (existing >= 0) {
            next.quizProgress = prev.quizProgress.map((p, i) =>
              i === existing
                ? {
                    topic: p.topic,
                    attempts: p.attempts + 1,
                    correct: p.correct + (evt.answeredCorrectly ? 1 : 0),
                  }
                : p,
            );
          } else {
            next.quizProgress = [
              ...prev.quizProgress,
              {
                topic: evt.topic,
                attempts: 1,
                correct: evt.answeredCorrectly ? 1 : 0,
              },
            ];
          }
          pushedLabel = evt.answeredCorrectly
            ? `Quiz: correct on ${labelForTopic(evt.topic)}`
            : `Quiz: wrong answer on ${labelForTopic(evt.topic)}`;
          break;
        }
        case "kinebot.set-topic": {
          next.currentTopic = evt.topic;
          if (!prev.topicsVisited.includes(evt.topic)) {
            next.topicsVisited = [...prev.topicsVisited, evt.topic];
          }
          // Silent — the workbench already shows the topic; no card.
          break;
        }
        case "kinebot.state-change": {
          // Phase-2 commit-on-submit from the sim sliders. Silent push.
          break;
        }
      }

      setSnapshot(next);
      snapshotRef.current = next;

      const req = pushSnapshotRequest(next, evt.kind, pushedLabel);
      if (req) {
        if (pushedLabel) {
          humanToolEvents.dispatch({ label: pushedLabel, push: () => req });
        } else {
          void req.catch(() => {});
        }
      }
    },
    [pushSnapshotRequest, humanToolEvents],
  );

  // Catch-up push when sessionId arrives after the student has already
  // interacted (matches Boldkast / LED Planck).
  useEffect(() => {
    if (!sessionId) return;
    const snap = snapshotRef.current;
    const dirty =
      snap.lastEvent ||
      snap.currentTopic ||
      snap.topicsVisited.length > 0 ||
      snap.lastSimRun ||
      snap.currentGraph ||
      snap.quizProgress.length > 0;
    if (dirty) {
      const req = pushSnapshotRequest(snap, snap.lastEvent || "catch-up");
      if (req) void req.catch(() => {});
    }
  }, [sessionId, pushSnapshotRequest]);

  return { snapshot, reportEvent };
}
