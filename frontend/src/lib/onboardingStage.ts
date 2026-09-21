/**
 * The onboarding stage vocabulary (1.1.124) — the client half of
 * `backend/onboarding/stage.py`. The backend DERIVES a teacher's stage; this
 * file only knows how to say it. Copy lives here so the Programme column, the
 * class-list chip and the getting-started checklist use the same words.
 */

export type Stage = "invited" | "demo_only" | "no_code" | "no_activity" | "waiting" | "live";

/** Ordered — later is further along. Mirrors `STAGES` on the backend. */
export const STAGE_ORDER: readonly Stage[] = ["invited", "demo_only", "no_code", "no_activity", "waiting", "live"];

export interface StagePayload {
  stage: Stage;
  since: string | null;
  days: number | null;
  nextStep: string | null;
}

export const copy = {
  label: {
    invited: "Invited — not signed in",
    demo_only: "Demo only",
    no_code: "No join code",
    no_activity: "No activity assigned",
    waiting: "Waiting for students",
    live: "Live",
  } satisfies Record<Stage, string>,
  days: (n: number) => (n === 0 ? "today" : n === 1 ? "1 day" : `${n} days`),
  next: (step: string) => `Next: ${step}`,
} as const;

/** "Demo only — 9 days". The days are how long they have sat at this stage. */
export function describeStage(s: StagePayload): string {
  const base = copy.label[s.stage];
  if (s.stage === "live" || s.days == null) return base;
  return `${base} — ${copy.days(s.days)}`;
}

/** Chip colour by how far along — amber for the stuck-shaped stages, green for live. */
export function stageTone(stage: Stage): "muted" | "amber" | "green" {
  if (stage === "live") return "green";
  if (stage === "waiting") return "muted";
  return "amber";
}

/**
 * A single CLASS's stage, derived client-side from what the class list already
 * holds (1.1.124 M0, the research-view chip). Not a teacher stage — a teacher
 * is judged by their most advanced class, on the backend — but the same words.
 */
export function classStage(cls: {
  demo?: boolean;
  name: string;
  groupCodes: string[];
  activityIds?: string[];
}, activity: { turns: number } | undefined): Exclude<Stage, "invited"> {
  if (cls.demo || cls.name === "Demo class") return "demo_only";
  if (activity && activity.turns > 0) return "live";
  if (cls.groupCodes.length === 0) return "no_code";
  if ((cls.activityIds ?? []).length === 0) return "no_activity";
  return "waiting";
}
