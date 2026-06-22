// Workspace composition decision (TAA-1 generalization), extracted as a pure
// function so the dispatch is unit-testable without rendering the whole chat
// page. The page renders the actual elements based on the returned kind.

// Registry of skills that render a bespoke sim workbench.
//
// A SIM IS THE SKILL IT RUNS (1.1.32). `problem-set-hints` → Boldkast,
// `led-planck-tutor` → LED Planck, `kinebot-kinematics-tutor` → KineBot — each
// is a distinct skill with its own instructions + artefact, and the chat page
// dispatches the specific sim on the skill slug. The activity config's
// `workbench_type`/`paired_workbench` MIRROR this (legacy rows backfill
// `workbench_type="app"`) but can't drive selection on their own: a concept
// activity can't host a sim because it isn't the sim's skill. That's why the
// teacher "Paired workbench" knob was removed — it pretended otherwise.
// Marrying an arbitrary activity to a sim 1:1 is the Phase-B template refactor
// (teacher-ux-refinement.md). Until then this slug registry IS the truthful
// "which skills render a sim" set.
//
// Adding a sim = an entry here + its render case in the composer; non-sim
// elements (checklist, and later A2UI/quiz) compose from config with no page
// edit. Follow-up: migrate the bespoke wrappers onto a generic artefact-iframe
// mount so a new sim needs no render case at all.
export const SIM_WORKSPACE_SLUGS = new Set<string>([
  "problem-set-hints",
  "led-planck-tutor",
  "kinebot-kinematics-tutor",
]);

/** What the workspace column should contain for this activity. */
export type WorkspaceContentKind = "sim" | "elements" | "none";

/**
 * Decide the workspace content:
 *  - a registered sim slug → "sim" (the page dispatches to the right sim block)
 *  - else any teacher-authored workspace element present → "elements"
 *    (checklist, data table, …; the page renders the present ones via the
 *    element registry / `WorkspaceElements` — 1.1.38)
 *  - else "none" (chat-only — no workspace column)
 */
export function workspaceContentKind(
  skillSlug: string | null | undefined,
  hasWorkspaceElement: boolean,
): WorkspaceContentKind {
  if (skillSlug && SIM_WORKSPACE_SLUGS.has(skillSlug)) return "sim";
  if (hasWorkspaceElement) return "elements";
  return "none";
}
