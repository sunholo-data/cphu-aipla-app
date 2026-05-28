"use client";

import { useCallback, useEffect, useState } from "react";

import type { KineBotEvent, KineBotSnapshot } from "@/hooks/useKineBotSnapshot";
import { KineBotLabButton } from "./KineBotLabButton";
import { KineBotQuiz } from "./KineBotQuiz";
import { KineBotGraph } from "./KineBotGraph";

interface KineBotWorkbenchProps {
  snapshot: KineBotSnapshot | null;
  /** Sandbox origin — passed to the quiz so it can fetch its bank. */
  sandboxOrigin: string;
  /** Open the sim iframe (replaces the workbench view in the pane). */
  onOpenSim: () => void;
  /** Pick a topic — wired by the parent to both the snapshot hook
   *  (reportEvent set-topic) and the Frame ref (set-topic notification). */
  onTopicChange: (topic: string) => void;
  /** Report quiz + graph events into the shared snapshot hook. */
  reportEvent: (evt: KineBotEvent) => void;
  /** Sandbox unavailable -> disable the sim launcher. */
  simDisabled?: boolean;
  sessionId?: string | null;
}

interface TopicMeta {
  key: string;
  label: string;
  blurb: string;
  formulas: string[];
}

const TOPICS_FUNDAMENTALS: ReadonlyArray<TopicMeta> = [
  { key: "intro", label: "Intro to Motion", blurb: "Rest, motion, frame of reference, and the point-object idea. Everything depends on what you measure against.", formulas: ["position x(t)", "rest/motion is relative"] },
  { key: "displacement", label: "Distance & Displacement", blurb: "Distance is total path length (scalar). Displacement is the straight-line vector from start to finish.", formulas: ["distance >= |displacement|", "s = x_final - x_initial"] },
  { key: "velocity", label: "Speed & Velocity", blurb: "Speed = magnitude. Velocity = magnitude + direction. Instantaneous velocity is the slope of the x-t curve.", formulas: ["v_avg = Δx / Δt", "v = dx/dt"] },
  { key: "acceleration", label: "Acceleration", blurb: "Rate of change of velocity. Constant acceleration is a straight line on the v-t graph.", formulas: ["a = Δv / Δt", "a = dv/dt"] },
  { key: "equations", label: "Equations of Motion", blurb: "The four uniform-acceleration equations — pick one by which variable is missing.", formulas: ["v = u + at", "s = ut + ½at²", "v² = u² + 2as", "s = ½(u+v)t"] },
  { key: "graphs", label: "Motion Graphs", blurb: "Slope of x-t = velocity. Slope of v-t = acceleration. Area under v-t = displacement.", formulas: ["slope of x-t = v", "area under v-t = s"] },
  { key: "freefall", label: "Free Fall", blurb: "Gravity-only motion, ignoring air. g = 9.8 m/s² down. In vacuum, all objects fall together.", formulas: ["h = ½gt² (dropped)", "v² = u² + 2gh"] },
];

const TOPICS_2D: ReadonlyArray<TopicMeta> = [
  { key: "vectors", label: "Vectors & Scalars", blurb: "Vectors have direction and add tip-to-tail. Components: Aₓ = A cos θ, Aᵧ = A sin θ.", formulas: ["Aₓ = A cos θ", "Aᵧ = A sin θ"] },
  { key: "projectile", label: "Projectile Motion", blurb: "Horizontal and vertical motions are independent. 45° gives maximum range (no air).", formulas: ["T = 2u sin θ / g", "H = u² sin²θ / 2g", "R = u² sin 2θ / g"] },
  { key: "circular", label: "Circular Motion", blurb: "Even at constant speed, direction changes, so there's always acceleration toward the centre.", formulas: ["aᶜ = v² / r = ω²r", "ω = 2πf"] },
  { key: "relative", label: "Relative Velocity", blurb: "v of A relative to B = v_A − v_B. In 2D (rain–man, boat–river) they add as vectors.", formulas: ["v_AB = v_A − v_B"] },
];

const ALL_TOPICS = [...TOPICS_FUNDAMENTALS, ...TOPICS_2D];

function findTopic(key: string | null): TopicMeta {
  return ALL_TOPICS.find((t) => t.key === key) ?? TOPICS_FUNDAMENTALS[0];
}

const NOTES_PREFIX = "kinebot:notes:";
const NOTES_TAG_PREFIX = "kinebot:noteTag:";

export function KineBotWorkbench({
  snapshot,
  sandboxOrigin,
  onOpenSim,
  onTopicChange,
  reportEvent,
  simDisabled,
  sessionId,
}: KineBotWorkbenchProps) {
  const currentTopicKey = snapshot?.currentTopic ?? "intro";
  const currentTopic = findTopic(currentTopicKey);
  const visitedSet = new Set(snapshot?.topicsVisited ?? []);
  const quizProgress = snapshot?.quizProgress ?? [];

  const [noteBody, setNoteBody] = useState("");
  const [noteTag, setNoteTag] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !sessionId) return;
    try {
      setNoteBody(window.sessionStorage.getItem(NOTES_PREFIX + sessionId) ?? "");
      setNoteTag(window.sessionStorage.getItem(NOTES_TAG_PREFIX + sessionId) ?? "");
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const saveNotes = useCallback(() => {
    if (typeof window === "undefined" || !sessionId) return;
    try {
      window.sessionStorage.setItem(NOTES_PREFIX + sessionId, noteBody);
      window.sessionStorage.setItem(NOTES_TAG_PREFIX + sessionId, noteTag);
    } catch {
      /* ignore */
    }
  }, [sessionId, noteBody, noteTag]);

  const handleGraphChange = useCallback(
    (graphType: string) => reportEvent({ kind: "kinebot.graph-change", graphType }),
    [reportEvent],
  );

  const handleQuizAttempt = useCallback(
    (questionId: string, answeredCorrectly: boolean) =>
      reportEvent({
        kind: "kinebot.quiz-attempt",
        topic: currentTopicKey,
        questionId,
        answeredCorrectly,
      }),
    [reportEvent, currentTopicKey],
  );

  const totalAttempts = quizProgress.reduce((s, p) => s + p.attempts, 0);
  const totalCorrect = quizProgress.reduce((s, p) => s + p.correct, 0);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <h3 className="mb-1 text-sm font-semibold">How this works</h3>
        <ol className="ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
          <li>Pick a topic below.</li>
          <li>Open the simulation to explore it, then close it to come back.</li>
          <li>Try the motion graphs and the quiz for that topic.</li>
          <li>Ask the tutor anything in the chat — it can see what you do here.</li>
        </ol>
      </section>

      <KineBotLabButton onOpen={onOpenSim} disabled={simDisabled} />

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Topics</h3>
        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Fundamentals
          </div>
          <ul className="space-y-1">
            {TOPICS_FUNDAMENTALS.map((t) => (
              <TopicRow key={t.key} topic={t} visited={visitedSet.has(t.key)} active={t.key === currentTopicKey} onClick={() => onTopicChange(t.key)} />
            ))}
          </ul>
          <div className="pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            2D Motion
          </div>
          <ul className="space-y-1">
            {TOPICS_2D.map((t) => (
              <TopicRow key={t.key} topic={t} visited={visitedSet.has(t.key)} active={t.key === currentTopicKey} onClick={() => onTopicChange(t.key)} />
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">{currentTopic.label}</h3>
        <p className="text-xs text-muted-foreground">{currentTopic.blurb}</p>
      </section>

      <KineBotGraph onGraphChange={handleGraphChange} />

      <KineBotQuiz
        sandboxOrigin={sandboxOrigin}
        topic={currentTopicKey}
        onAttempt={handleQuizAttempt}
      />

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Formulas</h3>
        <ul className="space-y-1 font-mono text-[11px]">
          {currentTopic.formulas.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Progress</h3>
        <p className="text-xs text-muted-foreground">
          Topics visited:{" "}
          <span className="font-medium text-foreground">
            {snapshot?.topicsVisited.length ?? 0}
          </span>{" "}
          / {ALL_TOPICS.length}
        </p>
        {totalAttempts > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Quiz: {totalCorrect}/{totalAttempts} correct
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Notes</h3>
        <input
          type="text"
          value={noteTag}
          onChange={(e) => setNoteTag(e.target.value)}
          placeholder="Tag (e.g. SUVAT)"
          className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          placeholder="Write your notes here. Saved per chat session in this tab."
          rows={4}
          className="w-full rounded border border-border bg-background p-2 text-xs"
        />
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={saveNotes} disabled={!sessionId} className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">
            Save
          </button>
        </div>
      </section>
    </div>
  );
}

interface TopicRowProps {
  topic: TopicMeta;
  visited: boolean;
  active: boolean;
  onClick: () => void;
}

function TopicRow({ topic, visited, active, onClick }: TopicRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${
          active ? "bg-primary/10 font-medium text-foreground" : "text-foreground/80 hover:bg-muted/40"
        }`}
        aria-current={active ? "true" : undefined}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            active ? "bg-primary" : visited ? "bg-foreground/40" : "bg-border"
          }`}
          aria-hidden="true"
        />
        <span className="flex-1">{topic.label}</span>
        {active ? <span className="text-[9px] uppercase tracking-wide text-primary">now</span> : null}
      </button>
    </li>
  );
}
