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
  /** Human label for the builder / workspace header. */
  label: string;
  /** Where the element renders: the workspace pane, or an inline chat card. */
  render: ElementRender;
  /** Advisory cap (backend enforces the authoritative limit). */
  maxItems: number;
}

export const ELEMENT_REGISTRY: Record<ElementKind, ElementDescriptor> = {
  checklist: { kind: "checklist", label: "Fremgang", render: "workspace", maxItems: 50 },
  table: { kind: "table", label: "Datatabel", render: "workspace", maxItems: 5 },
  chart: { kind: "chart", label: "Graf", render: "workspace", maxItems: 5 },
  calculator: { kind: "calculator", label: "Beregner", render: "workspace", maxItems: 5 },
  // "Note" was a misleading label: a teacher reads it as *notebook* and expects
  // somewhere the student writes (JB did, 2026-08-11). The KIND is wire-stable —
  // only the label changed.
  note: { kind: "note", label: "Instruktion / reference", render: "workspace", maxItems: 5 },
  // The student's own writing surface (1.1.73). Not a singleton: a lab report
  // wanting both a method and a conclusion box is the obvious first ask.
  writing: { kind: "writing", label: "Skrivefelt", render: "workspace", maxItems: 3 },
  // One rich-text solution editor per activity (1.1.45 M4, JB-2 "din løsning").
  solution: { kind: "solution", label: "Din løsning", render: "workspace", maxItems: 1 },
  // Document-upload surface (1.1.48 — reconciled from workbench_type="document").
  document: { kind: "document", label: "Dokumentupload", render: "workspace", maxItems: 1 },
  // The living concept map (living-concept-map M0) — one prerequisite DAG per
  // activity; the tutor's in-session check-off lights its nodes up.
  conceptMap: { kind: "conceptMap", label: "Begrebskort", render: "workspace", maxItems: 1 },
};

export const ELEMENT_KINDS = Object.keys(ELEMENT_REGISTRY) as ElementKind[];

/** True when the element renders in the workspace pane (vs an inline chat card). */
export function isWorkspaceElement(kind: ElementKind): boolean {
  return ELEMENT_REGISTRY[kind].render === "workspace";
}
