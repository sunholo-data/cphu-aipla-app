"use client";

import { useCallback, useEffect, useState } from "react";

import type { KineBotSnapshot } from "./KineBotFrame";

interface KineBotWorkbenchProps {
  /** Snapshot from the host Frame. `null` before the lab has been
   *  opened at least once. */
  snapshot: KineBotSnapshot | null;
  /** Called when the student picks a topic in the sidebar. Parent
   *  wires this to KineBotFrameHandle.setTopic so the iframe sim
   *  re-renders. */
  onTopicChange: (topic: string) => void;
  /** Chat session id — scopes the notes sessionStorage key + reserves
   *  the slot for future per-session persistence work. */
  sessionId?: string | null;
}

interface TopicMeta {
  key: string;
  label: string;
  blurb: string;
  formulas: string[];
}

const TOPICS_FUNDAMENTALS: ReadonlyArray<TopicMeta> = [
  {
    key: "intro",
    label: "Intro to Motion",
    blurb:
      "Rest, motion, frame of reference, and the idea of a point object. Everything in kinematics depends on what you measure against.",
    formulas: ["position x(t) is what you describe", "rest <=> motion is relative to a frame"],
  },
  {
    key: "displacement",
    label: "Distance & Displacement",
    blurb:
      "Distance is the total path length (scalar). Displacement is the straight-line vector from start to finish. They're rarely the same number.",
    formulas: ["distance >= |displacement|", "displacement = x_final - x_initial"],
  },
  {
    key: "velocity",
    label: "Speed & Velocity",
    blurb:
      "Speed = magnitude. Velocity = magnitude + direction. Average vs instantaneous: instantaneous is the slope of the x-t curve at that instant.",
    formulas: ["v_avg = Δx / Δt", "v_inst = dx/dt"],
  },
  {
    key: "acceleration",
    label: "Acceleration",
    blurb:
      "Rate of change of velocity. Constant acceleration is a straight line on the v-t graph; the slope IS the acceleration.",
    formulas: ["a = Δv / Δt", "a = dv/dt"],
  },
  {
    key: "equations",
    label: "Equations of Motion",
    blurb:
      "The four uniform-acceleration equations — pick one based on which variable is missing.",
    formulas: ["v = u + at", "s = ut + ½at²", "v² = u² + 2as", "s = ½(u+v)t"],
  },
  {
    key: "graphs",
    label: "Motion Graphs",
    blurb:
      "Slope of x-t = velocity. Slope of v-t = acceleration. Area under v-t = displacement. Area under a-t = change in velocity.",
    formulas: ["slope of x-t = v", "area under v-t = displacement"],
  },
  {
    key: "freefall",
    label: "Free Fall",
    blurb:
      "Gravity-only motion, ignoring air. g = 9.8 m/s² downward. In vacuum a hammer and a feather hit the ground together.",
    formulas: ["h = ½gt² (dropped)", "v² = u² + 2gh"],
  },
];

const TOPICS_2D: ReadonlyArray<TopicMeta> = [
  {
    key: "vectors",
    label: "Vectors & Scalars",
    blurb:
      "Vectors have direction and add tip-to-tail. Components: Aₓ = A cos θ, Aᵧ = A sin θ. Perpendicular sum uses the Pythagorean trick.",
    formulas: ["Aₓ = A cos θ", "Aᵧ = A sin θ"],
  },
  {
    key: "projectile",
    label: "Projectile Motion",
    blurb:
      "Horizontal and vertical motions are independent. The horizontal velocity is constant; gravity only changes the vertical. 45° gives maximum range (no air).",
    formulas: ["T = 2u sin θ / g", "H = u² sin²θ / 2g", "R = u² sin 2θ / g"],
  },
  {
    key: "circular",
    label: "Circular Motion",
    blurb:
      "Even at constant speed, direction changes continuously, so there's always an acceleration pointing toward the centre.",
    formulas: ["aᶜ = v² / r = ω²r", "ω = 2πf"],
  },
  {
    key: "relative",
    label: "Relative Velocity",
    blurb:
      "v of A relative to B = v_A - v_B. In 2D (rain–man, boat–river) the two velocities add as vectors.",
    formulas: ["v_AB = v_A - v_B"],
  },
];

const ALL_TOPICS = [...TOPICS_FUNDAMENTALS, ...TOPICS_2D];

function findTopic(key: string | null): TopicMeta | null {
  if (!key) return null;
  return ALL_TOPICS.find((t) => t.key === key) ?? null;
}

const NOTES_PREFIX = "kinebot:notes:";
const NOTES_TAG_PREFIX = "kinebot:noteTag:";

function readNotes(sessionId: string | null | undefined): {
  body: string;
  tag: string;
} {
  if (typeof window === "undefined" || !sessionId) return { body: "", tag: "" };
  try {
    return {
      body: window.sessionStorage.getItem(NOTES_PREFIX + sessionId) ?? "",
      tag: window.sessionStorage.getItem(NOTES_TAG_PREFIX + sessionId) ?? "",
    };
  } catch {
    return { body: "", tag: "" };
  }
}

function writeNotes(
  sessionId: string | null | undefined,
  body: string,
  tag: string,
): void {
  if (typeof window === "undefined" || !sessionId) return;
  try {
    window.sessionStorage.setItem(NOTES_PREFIX + sessionId, body);
    window.sessionStorage.setItem(NOTES_TAG_PREFIX + sessionId, tag);
  } catch {
    /* quota / disabled — silently ignore */
  }
}

export function KineBotWorkbench({
  snapshot,
  onTopicChange,
  sessionId,
}: KineBotWorkbenchProps) {
  const currentTopicKey = snapshot?.currentTopic ?? "intro";
  const currentTopic = findTopic(currentTopicKey) ?? TOPICS_FUNDAMENTALS[0];
  const visitedSet = new Set(snapshot?.topicsVisited ?? []);
  const quizProgress = snapshot?.quizProgress ?? [];

  const [noteBody, setNoteBody] = useState("");
  const [noteTag, setNoteTag] = useState("");

  // Hydrate notes from sessionStorage on mount.
  useEffect(() => {
    if (!sessionId) return;
    const initial = readNotes(sessionId);
    setNoteBody(initial.body);
    setNoteTag(initial.tag);
  }, [sessionId]);

  const handleSaveNote = useCallback(() => {
    writeNotes(sessionId, noteBody, noteTag);
  }, [sessionId, noteBody, noteTag]);

  const handleClearNotes = useCallback(() => {
    setNoteBody("");
    setNoteTag("");
    writeNotes(sessionId, "", "");
  }, [sessionId]);

  const totalAttempts = quizProgress.reduce((s, p) => s + p.attempts, 0);
  const totalCorrect = quizProgress.reduce((s, p) => s + p.correct, 0);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Topics</h3>
        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Fundamentals
          </div>
          <ul className="space-y-1">
            {TOPICS_FUNDAMENTALS.map((t) => (
              <TopicRow
                key={t.key}
                topic={t}
                visited={visitedSet.has(t.key)}
                active={t.key === currentTopicKey}
                onClick={() => onTopicChange(t.key)}
              />
            ))}
          </ul>
          <div className="pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            2D Motion
          </div>
          <ul className="space-y-1">
            {TOPICS_2D.map((t) => (
              <TopicRow
                key={t.key}
                topic={t}
                visited={visitedSet.has(t.key)}
                active={t.key === currentTopicKey}
                onClick={() => onTopicChange(t.key)}
              />
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">{currentTopic.label}</h3>
        <p className="text-xs text-muted-foreground">{currentTopic.blurb}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Formulas</h3>
        <ul className="space-y-1 font-mono text-[11px] text-foreground">
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
          rows={5}
          className="w-full rounded border border-border bg-background p-2 text-xs"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={!sessionId}
            className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleClearNotes}
            disabled={!sessionId}
            className="rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Clear
          </button>
          {!sessionId ? (
            <span className="ml-auto self-center text-[10px] text-muted-foreground">
              No session yet
            </span>
          ) : null}
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
          active
            ? "bg-primary/10 font-medium text-foreground"
            : "text-foreground/80 hover:bg-muted/40"
        }`}
        aria-current={active ? "true" : undefined}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            active
              ? "bg-primary"
              : visited
                ? "bg-foreground/40"
                : "bg-border"
          }`}
          aria-hidden="true"
        />
        <span className="flex-1">{topic.label}</span>
        {active ? (
          <span className="text-[9px] uppercase tracking-wide text-primary">
            now
          </span>
        ) : null}
      </button>
    </li>
  );
}
