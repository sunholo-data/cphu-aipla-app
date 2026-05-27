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

export interface KineBotFrameHandle {
  /** Fire ui/notifications/chat-flush at the artefact so it flushes
   *  any pending slider changes as a state-change event before the
   *  user's chat message lands. Fire-and-forget. */
  sendChatFlush: () => void;
  /** Push a topic into the iframe via kinebot.set-topic. The host
   *  workbench owns topic state; this method tells the iframe to
   *  re-render the sim for the new topic. Also updates the local
   *  snapshot (currentTopic + topicsVisited) and pushes iframe-context
   *  so the agent sees the change in one round-trip. */
  setTopic: (topic: string) => void;
}

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

function labelForTopic(topic: string): string {
  return TOPIC_LABELS_EN[topic] ?? topic;
}

function labelForGraph(graphType: string): string {
  const m: Record<string, string> = {
    xt: "x-t",
    vt: "v-t",
    at: "a-t",
    range: "range-vs-angle",
    height: "max-height-vs-angle",
  };
  return m[graphType] ?? graphType;
}

interface KineBotStructuredContent {
  kind: string;
  // sim-run
  simType?: string;
  params?: Record<string, number>;
  // graph-change
  graphType?: string;
  // quiz-attempt
  topic?: string;
  questionId?: string;
  answeredCorrectly?: boolean;
  // state-change (commit-on-submit)
  changed?: string[];
  state?: Record<string, number>;
  triggeredBy?: string;
}

export interface KineBotSimRun {
  simType: string;
  params: Record<string, number>;
}

export interface KineBotQuizAttempt {
  topic: string;
  questionId: string;
  answeredCorrectly: boolean;
}

export interface KineBotSnapshot {
  lastEvent: string;
  currentTopic: string | null;
  topicsVisited: string[];
  lastSimRun: KineBotSimRun | null;
  currentGraph: string | null;
  quizProgress: Array<{
    topic: string;
    attempts: number;
    correct: number;
  }>;
}

interface KineBotFrameProps {
  sandboxOrigin: string;
  sessionId: string | null;
  onClose: () => void;
  onSnapshotChange?: (snapshot: KineBotSnapshot) => void;
}

export const KineBotFrame = forwardRef<KineBotFrameHandle, KineBotFrameProps>(
  function KineBotFrame(
    { sandboxOrigin, sessionId, onClose, onSnapshotChange },
    ref,
  ) {
    const humanToolEvents = useHumanToolEvents();
    const staticFrameRef = useRef<StaticArtefactFrameHandle | null>(null);
    const snapshotRef = useRef<KineBotSnapshot>({
      lastEvent: "",
      currentTopic: null,
      topicsVisited: [],
      lastSimRun: null,
      currentGraph: null,
      quizProgress: [],
    });

    const sessionIdRef = useRef(sessionId);
    sessionIdRef.current = sessionId;

    const onSnapshotChangeRef = useRef(onSnapshotChange);
    onSnapshotChangeRef.current = onSnapshotChange;

    const pushSnapshotRequest = useCallback(
      (latestKind: string): Promise<Response> | null => {
        const sid = sessionIdRef.current;
        if (!sid) return null;
        const body = {
          serverId: "kinebot",
          toolName: "state",
          structuredContent: {
            ...snapshotRef.current,
            lastEvent: latestKind,
          },
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
            console.warn("[kinebot] iframe-context push failed:", err);
          }
        });
      },
      [pushSnapshotRequest],
    );

    const handleStructuredContent = useCallback(
      (structuredContent: Record<string, unknown>) => {
        const data = structuredContent as unknown as KineBotStructuredContent;
        const kind = data.kind;
        if (typeof kind !== "string") return;

        const snap = snapshotRef.current;
        snap.lastEvent = kind;

        let shouldPush = false;
        let pushedLabel: string | null = null;

        if (kind === "kinebot.sim-run") {
          if (typeof data.simType === "string" && data.params) {
            snap.lastSimRun = {
              simType: data.simType,
              params: data.params,
            };
            shouldPush = true;
            // No card — sim-run fires frequently as students iterate. The
            // tutor still sees the state via the iframe-context push.
            pushedLabel = null;
          }
        } else if (kind === "kinebot.graph-change") {
          if (typeof data.graphType === "string") {
            snap.currentGraph = data.graphType;
            shouldPush = true;
            pushedLabel = `Viewing ${labelForGraph(data.graphType)} graph`;
          }
        } else if (kind === "kinebot.quiz-attempt") {
          if (
            typeof data.topic === "string" &&
            typeof data.questionId === "string" &&
            typeof data.answeredCorrectly === "boolean"
          ) {
            const t = data.topic;
            const existing = snap.quizProgress.findIndex((p) => p.topic === t);
            if (existing >= 0) {
              snap.quizProgress = snap.quizProgress.map((p, i) =>
                i === existing
                  ? {
                      topic: p.topic,
                      attempts: p.attempts + 1,
                      correct: p.correct + (data.answeredCorrectly ? 1 : 0),
                    }
                  : p,
              );
            } else {
              snap.quizProgress = [
                ...snap.quizProgress,
                {
                  topic: t,
                  attempts: 1,
                  correct: data.answeredCorrectly ? 1 : 0,
                },
              ];
            }
            shouldPush = true;
            if (data.answeredCorrectly) {
              pushedLabel = `Quiz: correct on ${labelForTopic(t)}`;
            } else {
              // Pedagogical silence — agent sees the attempt in the
              // snapshot but no chat card. Student reflects via the
              // explanation in the artefact instead of being told off
              // in the chat.
              pushedLabel = null;
            }
          }
        } else if (kind === "kinebot.state-change" && data.state) {
          // Phase-2 commit-on-submit: silent push only, no card.
          shouldPush = true;
          pushedLabel = null;
        }

        if (shouldPush) {
          const req = pushSnapshotRequest(kind);
          if (req) {
            if (pushedLabel) {
              humanToolEvents.dispatch({ label: pushedLabel, push: () => req });
            } else {
              void req.catch(() => {});
            }
          }
          onSnapshotChangeRef.current?.({ ...snap });
        }
      },
      [pushSnapshotRequest, humanToolEvents],
    );

    // Catch-up push when sessionId arrives after the student has
    // already touched the artefact (matches Boldkast / LED Planck
    // catch-up pattern).
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
        pushSnapshotSilent(snap.lastEvent || "catch-up");
      }
    }, [sessionId, pushSnapshotSilent]);

    useImperativeHandle(
      ref,
      () => ({
        sendChatFlush: () => {
          staticFrameRef.current?.sendNotification(
            "ui/notifications/chat-flush",
            {},
          );
        },
        setTopic: (topic: string) => {
          if (typeof topic !== "string") return;
          // Update the snapshot first — host is the source of truth for
          // the topic per the skill's no-mirror rule. Iframe receives
          // the set-topic notification + re-renders but does NOT echo
          // a topic-change event back.
          const snap = snapshotRef.current;
          snap.currentTopic = topic;
          if (!snap.topicsVisited.includes(topic)) {
            snap.topicsVisited = [...snap.topicsVisited, topic];
          }
          snap.lastEvent = "kinebot.set-topic";
          onSnapshotChangeRef.current?.({ ...snap });

          // Push iframe-context so the agent sees the new topic right
          // away (no waiting for any iframe-side echo).
          pushSnapshotSilent("kinebot.set-topic");

          // Push the notification down into the iframe so the sim
          // canvas re-renders for the new topic.
          staticFrameRef.current?.sendNotification("kinebot.set-topic", {
            topic,
          });
        },
      }),
      [pushSnapshotSilent],
    );

    return (
      <div className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            KineBot — kinematics workbench
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close workbench"
          >
            Close
          </button>
        </header>
        <StaticArtefactFrame
          ref={staticFrameRef}
          sandboxOrigin={sandboxOrigin}
          artefactPath="kinebot/v1"
          onUpdateModelContext={handleStructuredContent}
          title="KineBot kinematics workbench"
          className="w-full min-h-[700px] border-0"
        />
      </div>
    );
  },
);
