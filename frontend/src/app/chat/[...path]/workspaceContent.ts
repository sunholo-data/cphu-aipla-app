// Workspace composition decision (TAA-1 generalization), extracted as a pure
// function so the dispatch is unit-testable without rendering the whole chat
// page. The page renders the actual elements based on the returned kind.

/** What the workspace column should contain for this activity. */
export type WorkspaceContentKind = "elements" | "none";

/**
 * Decide the workspace content:
 *  - any workspace surface present → "elements" (a vetted sim artefact OR a
 *    teacher-authored element: checklist, data table, chart, calculator, note,
 *    solution, document). The page renders the present ones through the single
 *    generic `StudentWorkspace` mount — artefact === student runtime === builder
 *    preview.
 *  - else "none" (chat-only — no workspace column).
 *
 * USR-1 (2026-06-25): the old slug-driven "sim" kind is gone. A simulation is
 * now a catalogue artefact attached to an activity (folded into
 * `hasWorkspaceElement` by the caller via `activeArtefact != null`); there is no
 * longer a per-skill `SIM_WORKSPACE_SLUGS` registry or a bespoke render path.
 */
export function workspaceContentKind(hasWorkspaceElement: boolean): WorkspaceContentKind {
  return hasWorkspaceElement ? "elements" : "none";
}
