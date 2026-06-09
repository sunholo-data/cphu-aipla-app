// Workspace composition decision (TAA-1 generalization), extracted as a pure
// function so the dispatch is unit-testable without rendering the whole chat
// page. The page renders the actual elements based on the returned kind.

// Registry of skills that render a bespoke sim workbench. The workspace gate
// is config-driven — a registered sim OR an authored checklist — instead of an
// inline slug allowlist. Adding a sim = an entry here + its render case in the
// composer; non-sim elements (checklist, and later A2UI/quiz) compose from
// config with no page edit. Follow-up: migrate the bespoke wrappers onto a
// generic artefact-iframe mount so a new sim needs no render case at all.
export const SIM_WORKSPACE_SLUGS = new Set<string>([
  "problem-set-hints",
  "led-planck-tutor",
  "kinebot-kinematics-tutor",
]);

/** What the workspace column should contain for this activity. */
export type WorkspaceContentKind = "sim" | "checklist" | "none";

/**
 * Decide the workspace content:
 *  - a registered sim slug → "sim" (the page dispatches to the right sim block)
 *  - else a teacher-authored checklist present → "checklist"
 *  - else "none" (chat-only — no workspace column)
 */
export function workspaceContentKind(
  skillSlug: string | null | undefined,
  hasChecklist: boolean,
): WorkspaceContentKind {
  if (skillSlug && SIM_WORKSPACE_SLUGS.has(skillSlug)) return "sim";
  if (hasChecklist) return "checklist";
  return "none";
}
