// Activity element registry (1.1.38 M0) — the typed contract mirror of the
// backend ELEMENT_REGISTRY (backend/db/models/activity_config.py). This is the
// single source of truth on the client for *which platform element kinds exist*
// and where each renders (workspace pane vs inline A2UI chat card).
//
// The *platform element* layer is the composable set a teacher layers on top of
// any workbench type — checklist + data table today; chart / calculator /
// document land as 1.1.38 M2–M4. Adding an element = a kind here + a backend
// spec + a renderer + an editor. The recipe is in
// docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md.
//
// The backend is authoritative for cap enforcement; `maxItems` here is advisory
// metadata for builder UX. The consistency tests on both ends keep the two
// registries in lock-step.

export type ElementKind = "checklist" | "table";
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
};

export const ELEMENT_KINDS = Object.keys(ELEMENT_REGISTRY) as ElementKind[];

/** True when the element renders in the workspace pane (vs an inline chat card). */
export function isWorkspaceElement(kind: ElementKind): boolean {
  return ELEMENT_REGISTRY[kind].render === "workspace";
}
