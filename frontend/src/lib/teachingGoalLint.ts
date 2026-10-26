import type { GoalLintState } from "@/hooks/useActivityBuilder";
import { lintTeachingGoal, type PedagogySpan } from "@/lib/teacherApi";

// 1.1.141 M2/M3 — the activity says what to learn, the tutor says how to teach.
//
// The lint runs at AUTHORING time only: when the teacher leaves the goal field,
// after a save, and after the co-pilot drafts a goal. Never per turn. The backend
// caches by a hash of the text, so re-running on an unchanged goal is free.
// Advisory throughout: a failed lint is "no warning", never an error a teacher
// sees, and nothing here blocks a save.

export interface GoalLintContext {
  classId?: string;
  activityId?: string;
}

/** Tidy the whitespace a cut leaves behind (mirrors the backend's `_tidy`). */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.;:!?])/g, "$1")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Move `lines` out of the goal and append them to the notes. A line no longer
 *  in the goal is skipped, so a stale lint can never cut the wrong text. */
export function moveToNotes(goal: string, notes: string, lines: string[]): { goal: string; notes: string; moved: string[] } {
  let rest = goal;
  const moved: string[] = [];
  for (const line of lines) {
    const at = rest.indexOf(line);
    if (at < 0) continue;
    rest = rest.slice(0, at) + rest.slice(at + line.length);
    moved.push(line.trim());
  }
  const existing = notes.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const m of moved) if (!existing.includes(m)) existing.push(m);
  return { goal: moved.length ? tidy(rest) : goal, notes: existing.join("\n"), moved };
}

/** The reverse: put `lines` back at the end of the goal and drop them from the
 *  notes. Reversible is the point — teachers trust a change they can undo. */
export function moveBackToGoal(goal: string, notes: string, lines: string[]): { goal: string; notes: string } {
  const back = lines.map((l) => l.trim()).filter(Boolean);
  const remaining = notes
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !back.includes(l));
  const sep = goal.trim() ? (goal.trimEnd().endsWith("\n") ? "" : " ") : "";
  return { goal: back.length ? `${goal.trimEnd()}${sep}${back.join(" ")}`.trim() : goal, notes: remaining.join("\n") };
}

/** The spans still worth warning about: present in the CURRENT goal, not Kept. */
export function visibleSpans(state: GoalLintState | null, goal: string): PedagogySpan[] {
  if (!state) return [];
  return state.result.spans.filter((s) => goal.includes(s.text) && !state.kept.includes(s.text));
}

/** Lint `text` and store the result on the builder. Never throws. */
export async function runGoalLint(
  setGoalLint: (v: GoalLintState | null) => void,
  text: string,
  ctx: GoalLintContext,
  mode: "warn" | "move" = "warn",
): Promise<void> {
  const goal = text.trim();
  if (!goal) {
    setGoalLint(null);
    return;
  }
  try {
    const result = await lintTeachingGoal({ text: goal, classId: ctx.classId, activityId: ctx.activityId });
    setGoalLint({ text: goal, result, mode, kept: [], moved: [] });
  } catch (err) {
    // Advisory — the teacher sees no warning rather than an error.
    console.warn("[teacher-ui] teaching-goal lint unavailable:", err);
  }
}
