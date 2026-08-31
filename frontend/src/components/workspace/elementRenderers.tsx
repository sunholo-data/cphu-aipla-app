"use client";

import { Fragment, type ReactNode } from "react";

import { ELEMENT_KINDS, isWorkspaceElement, type ElementKind } from "@/lib/activityElements";

import { ProgressChecklist, type ChecklistItem, type ChecklistItemState } from "./ProgressChecklist";
import { WorkbenchCalculator, type CalculatorElementDef } from "./WorkbenchCalculator";
import { WorkbenchChart, type ChartElementDef } from "./WorkbenchChart";
import { WorkbenchNote, type NoteElementDef } from "./WorkbenchNote";
import { WorkbenchWriting, type WritingElementDef } from "./WorkbenchWriting";
import { WorkbenchTable, type TableElementDef } from "./WorkbenchTable";
import { SolutionElementMount, type SolutionElementDef } from "./SolutionElementMount";
import { DocumentElementMount, type DocumentElementDef } from "./DocumentElementMount";
import { ConceptMapView, type ConceptMapElementDef } from "./ConceptMapView";
import type { ConceptNodeStatus } from "./ConceptMapGraph";

/**
 * Uniform render context shared by every workspace element renderer (1.1.38
 * M1). Each renderer pulls only the fields its kind needs; adding a new element
 * adds its data here + a renderer below + the descriptor in `activityElements.ts`
 * + the backend spec — see the recipe in
 * docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md.
 *
 * ⚠ If a student INTERACTS with the element (enters data, computes, writes),
 * sharing with the tutor is TWO wirings — BOTH are required or it's incomplete:
 *   1. THE PUSH — pass `sessionId` and `useSimSnapshotPush(sessionId, "<kind>")`
 *      so the AI sees the state. It lands in `mcp_app_context.<kind>.state`,
 *      which `wrap_with_iframe_context` injects into EVERY agent's prompt (NOT
 *      MCP-app-specific — table, checklist, calculator, solution all use it).
 *   2. THE TRUST CARD — on a *deliberate* action, also
 *      `useHumanToolEvents().dispatch({ label, push: () => req })` so a
 *      pending→confirmed card shows the student their work reached the tutor.
 * Dropping #2 still flows the data (so it passes tests) but leaves the student
 * blind — the most-repeated drop here (calculator + table both shipped without
 * it). Per-action card for one-shot actions; ONE debounced card per burst for
 * grid entry (see WorkbenchTable); none when the action sends a real chat turn
 * (SolutionElementMount) or for read-only elements (note) / catch-up syncs.
 * Full recipe: docs/design/aipla/v1.1.0-feedback/activity-elements-palette.md.
 */
export interface ElementRenderContext {
  skillId: string;
  sessionId?: string | null;
  /** 1.1.62 M3 — the activity the per-group checklist store is keyed by. */
  activityId?: string;
  checklist: ChecklistItem[];
  table: TableElementDef[];
  chart: ChartElementDef[];
  calculator: CalculatorElementDef[];
  note: NoteElementDef[];
  writing: WritingElementDef[];
  /** Activity title, stamped into the writing element's exported file. */
  activityTitle?: string;
  solution: SolutionElementDef[];
  document: DocumentElementDef[];
  conceptMap: ConceptMapElementDef[];
  /** Checkpoint light-up (CONCEPT-1 M3): node id → status for THIS group,
   *  refetched by the chat page at turn end. Absent = all not_yet (preview). */
  conceptMapNodeStates?: Record<string, ConceptNodeStatus>;
  /** 1.1.62 M3 — per-group checklist tick state, fetched by the chat page and
   *  refetched at turn end so a tick the TUTOR just made appears without a
   *  reload. Absent in the builder preview (no group). */
  checklistItemStates?: Record<string, ChecklistItemState>;
  /** Active uploaded-file → tutor document_ids (the document element's hook;
   *  threaded from the chat page). */
  onDocumentActiveChange?: (docId: string | null) => void;
  /** Whose token the document element reads with: student (group) or teacher
   *  (builder preview). Defaults student. */
  documentViewerRole?: "student" | "teacher";
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
        <ProgressChecklist
          skillId={ctx.skillId}
          activityId={ctx.activityId}
          items={ctx.checklist}
          sessionId={ctx.sessionId}
          itemStates={ctx.checklistItemStates}
        />
      </div>
    ) : null,
  table: (ctx) =>
    ctx.table.length > 0 ? (
      <WorkbenchTable
        skillId={ctx.skillId}
        activityId={ctx.activityId}
        tables={ctx.table}
        sessionId={ctx.sessionId}
      />
    ) : null,
  chart: (ctx) =>
    ctx.chart.length > 0 ? (
      <WorkbenchChart skillId={ctx.skillId} charts={ctx.chart} tables={ctx.table} />
    ) : null,
  calculator: (ctx) =>
    ctx.calculator.length > 0 ? (
      <WorkbenchCalculator skillId={ctx.skillId} sessionId={ctx.sessionId} calculators={ctx.calculator} />
    ) : null,
  note: (ctx) =>
    ctx.note.length > 0 ? <WorkbenchNote skillId={ctx.skillId} notes={ctx.note} /> : null,
  writing: (ctx) =>
    ctx.writing.length > 0 ? (
      <WorkbenchWriting
        skillId={ctx.skillId}
        activityId={ctx.activityId}
        sessionId={ctx.sessionId}
        activityTitle={ctx.activityTitle}
        writing={ctx.writing}
      />
    ) : null,
  solution: (ctx) =>
    ctx.solution.length > 0 ? <SolutionElementMount solution={ctx.solution} /> : null,
  document: (ctx) =>
    ctx.document.length > 0 ? (
      <DocumentElementMount
        skillId={ctx.skillId}
        sessionId={ctx.sessionId}
        role={ctx.documentViewerRole ?? "student"}
        document={ctx.document}
        onActiveDocChange={ctx.onDocumentActiveChange}
      />
    ) : null,
  // Living concept map — read-only orientation that lights up as the tutor's
  // checkpoints mark concepts demonstrated (CONCEPT-1 M3).
  conceptMap: (ctx) =>
    ctx.conceptMap.length > 0 ? (
      <ConceptMapView conceptMap={ctx.conceptMap} nodeStates={ctx.conceptMapNodeStates} />
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
