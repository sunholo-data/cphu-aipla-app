"use client";

import { Fragment, type ReactNode } from "react";

import { ELEMENT_KINDS, isWorkspaceElement, type ElementKind } from "@/lib/activityElements";

import { ProgressChecklist, type ChecklistItem } from "./ProgressChecklist";
import { WorkbenchTable, type TableElementDef } from "./WorkbenchTable";

/**
 * Uniform render context shared by every workspace element renderer (1.1.38
 * M1). Each renderer pulls only the fields its kind needs; adding a new element
 * adds its data here + a renderer below + the descriptor in `activityElements.ts`
 * + the backend spec — see the recipe in
 * docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md.
 */
export interface ElementRenderContext {
  skillId: string;
  sessionId?: string | null;
  checklist: ChecklistItem[];
  table: TableElementDef[];
}

/**
 * Element renderer registry — the frontend half of the element registry (the
 * backend half is `ELEMENT_REGISTRY` in `activity_config.py`). Keyed by
 * `ElementKind`; each renderer returns its node, or `null` to self-hide when
 * the element is absent for this activity.
 *
 * The checklist renderer reproduces its exact prior markup (the `Fremgang`
 * header + `ProgressChecklist`) so re-homing it onto the registry is a no-op
 * visual change.
 */
export const elementRenderers: Record<ElementKind, (ctx: ElementRenderContext) => ReactNode> = {
  checklist: (ctx) =>
    ctx.checklist.length > 0 ? (
      <div className="space-y-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">Fremgang</h2>
        <ProgressChecklist skillId={ctx.skillId} items={ctx.checklist} sessionId={ctx.sessionId} />
      </div>
    ) : null,
  table: (ctx) =>
    ctx.table.length > 0 ? (
      <WorkbenchTable skillId={ctx.skillId} tables={ctx.table} sessionId={ctx.sessionId} />
    ) : null,
};

/**
 * Renders every present workspace-rendered platform element for an activity,
 * stacked in registry order (Q1 resolution: stack, don't tab — consistent with
 * the DocumentsPanel that already renders alongside). Absent elements self-hide.
 */
export function WorkspaceElements(ctx: ElementRenderContext) {
  return (
    <>
      {ELEMENT_KINDS.filter(isWorkspaceElement).map((kind) => {
        const node = elementRenderers[kind](ctx);
        return node ? <Fragment key={kind}>{node}</Fragment> : null;
      })}
    </>
  );
}
