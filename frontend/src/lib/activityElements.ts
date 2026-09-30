// Activity element registry (1.1.38 M0) — the typed contract mirror of the
// backend ELEMENT_REGISTRY (backend/db/models/activity_config.py). This is the
// single source of truth on the client for *which platform element kinds exist*
// and where each renders (workspace pane vs inline A2UI chat card).
//
// The *platform element* layer is the composable set a teacher layers on top of
// any workbench type — checklist + data table + chart + calculator + note (the
// 1.1.38 v1.1 set) + the student's writing surface (1.1.73). Adding an element = a kind here + a backend spec + a
// renderer + an editor. The recipe is in
// docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md.
//
// The backend is authoritative for cap enforcement; `maxItems` here is advisory
// metadata for builder UX. The consistency tests on both ends keep the two
// registries in lock-step.

export type ElementKind =
  | "checklist"
  | "table"
  | "chart"
  | "calculator"
  | "note"
  | "writing"
  | "solution"
  | "document"
  | "conceptMap";
export type ElementRender = "workspace" | "inline";

export interface ElementDescriptor {
  kind: ElementKind;
  /** Message key (namespace `ElementKinds`) for the human label — render it with
   *  `useT("ElementKinds")(descriptor.label)`. A key, not text, since 1.1.108 M2:
   *  the label speaks the teacher's language, so it cannot live in code. */
  label: ElementKind;
  /** Where the element renders: the workspace pane, or an inline chat card. */
  render: ElementRender;
  /** Advisory cap (backend enforces the authoritative limit). */
  maxItems: number;
}

export const ELEMENT_REGISTRY: Record<ElementKind, ElementDescriptor> = {
  checklist: { kind: "checklist", label: "checklist", render: "workspace", maxItems: 50 },
  table: { kind: "table", label: "table", render: "workspace", maxItems: 5 },
  chart: { kind: "chart", label: "chart", render: "workspace", maxItems: 5 },
  calculator: { kind: "calculator", label: "calculator", render: "workspace", maxItems: 5 },
  // "Note" was a misleading label: a teacher reads it as *notebook* and expects
  // somewhere the student writes (JB did, 2026-08-11). The KIND is wire-stable —
  // only the label changed.
  note: { kind: "note", label: "note", render: "workspace", maxItems: 5 },
  // The student's own writing surface (1.1.73). Not a singleton: a lab report
  // wanting both a method and a conclusion box is the obvious first ask.
  writing: { kind: "writing", label: "writing", render: "workspace", maxItems: 3 },
  // One rich-text solution editor per activity (1.1.45 M4, JB-2 "din løsning").
  solution: { kind: "solution", label: "solution", render: "workspace", maxItems: 1 },
  // File-upload surface (1.1.48 — reconciled from workbench_type="document";
  // 1.1.122 — takes images too, so the label says FILE: a teacher choosing
  // between this and "Din løsning" reads file-vs-solution, not document-vs-solution).
  document: { kind: "document", label: "document", render: "workspace", maxItems: 1 },
  // The living concept map (living-concept-map M0) — one prerequisite DAG per
  // activity; the tutor's in-session check-off lights its nodes up.
  conceptMap: { kind: "conceptMap", label: "conceptMap", render: "workspace", maxItems: 1 },
};

export const ELEMENT_KINDS = Object.keys(ELEMENT_REGISTRY) as ElementKind[];

/** True when the element renders in the workspace pane (vs an inline chat card). */
export function isWorkspaceElement(kind: ElementKind): boolean {
  return ELEMENT_REGISTRY[kind].render === "workspace";
}
