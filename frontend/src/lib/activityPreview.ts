// Shared activity-element normalisation (1.1.40) — converts the builder's
// editor-value state into the element-def shapes the workspace renderers take.
// The SAME function feeds both the save payload and the live preview, so what a
// teacher previews is byte-identical to what students get (no parallel
// converter that could drift).

import type { CalculatorEditorValue } from "@/components/teacher/CalculatorEditor";
import type { ChartEditorValue } from "@/components/teacher/ChartEditor";
import type { ConceptMapEditorValue } from "@/components/teacher/ConceptMapEditor";
import type { NoteEditorValue } from "@/components/teacher/NoteEditor";
import type { TableEditorValue } from "@/components/teacher/TableEditor";
import type { SolutionEditorValue } from "@/components/teacher/SolutionEditor";
import type { DocumentEditorValue } from "@/components/teacher/DocumentEditor";
import type { CalculatorElementDef } from "@/components/workspace/WorkbenchCalculator";
import type { ChartElementDef } from "@/components/workspace/WorkbenchChart";
import type { ConceptMapElementDef } from "@/components/workspace/ConceptMapView";
import type { NoteElementDef } from "@/components/workspace/WorkbenchNote";
import type { SolutionElementDef } from "@/components/workspace/SolutionElementMount";
import type { DocumentElementDef } from "@/components/workspace/DocumentElementMount";
import type { TableElementDef } from "@/components/workspace/WorkbenchTable";
import type { WritingElementDef } from "@/components/workspace/WorkbenchWriting";
import type { WritingEditorRow } from "@/components/teacher/WritingEditor";
import { splitFormula } from "@/lib/safeFormula";

export interface BuilderChecklistItem {
  key: number;
  label: string;
}

/** The element-bearing slice of the activity builder's state. */
export interface BuilderElements {
  checklist: BuilderChecklistItem[];
  table: TableEditorValue | null;
  chart: ChartEditorValue[];
  calculator: CalculatorEditorValue | null;
  note: NoteEditorValue | null;
  writing: WritingEditorRow[];
  solution: SolutionEditorValue | null;
  document: DocumentEditorValue | null;
  conceptMap: ConceptMapEditorValue | null;
}

/** The normalised element defs — what the renderers (and the save payload) take. */
export interface ActivityElementDefs {
  checklist: { id: string; label: string }[];
  table: TableElementDef[];
  chart: ChartElementDef[];
  calculator: CalculatorElementDef[];
  note: NoteElementDef[];
  writing: WritingElementDef[];
  solution: SolutionElementDef[];
  document: DocumentElementDef[];
  conceptMap: ConceptMapElementDef[];
}

const VAR_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Drop columns without a label; drop the whole table if none survive.
 *  Positional column ids assigned here (the labels are the identity). */
function tableDefs(table: TableEditorValue | null): TableElementDef[] {
  if (!table) return [];
  const columns = table.columns
    .filter((c) => c.label.trim())
    .map((c, idx) => ({ id: `col-${idx + 1}`, label: c.label.trim(), unit: c.unit.trim(), kind: c.kind }));
  if (columns.length === 0) return [];
  return [{ id: "table-1", title: table.title.trim(), columns, rows: table.rows }];
}

/** Keep inputs with a valid variable name + label; drop the calculator if it
 *  has no valid inputs or no formula. The teacher may write the equation form
 *  (`E = m * c^2`): we store only the right-hand side as the formula and fall
 *  back to the left-hand side (`E`) as the result title when none was set. */
function calculatorDefs(calc: CalculatorEditorValue | null): CalculatorElementDef[] {
  if (!calc) return [];
  const inputs = calc.inputs
    .filter((i) => VAR_ID_RE.test(i.id.trim()) && i.label.trim())
    .map((i) => ({ id: i.id.trim(), label: i.label.trim(), unit: i.unit.trim() }));
  const { label, expr } = splitFormula(calc.formula.trim());
  const formula = expr.trim();
  if (inputs.length === 0 || !formula) return [];
  return [{ id: "calc-1", title: calc.title.trim() || label || "", formula, inputs }];
}

/** Nodes need a non-empty label; edges keep only refs to surviving nodes (a
 *  removed/unlabelled concept silently drops its edges — same "drop invalid,
 *  keep the rest" discipline as tableDefs). Check questions need a prompt. */
function conceptMapDefs(map: ConceptMapEditorValue | null): ConceptMapElementDef[] {
  if (!map) return [];
  const nodes = map.nodes
    .filter((n) => n.label.trim())
    .map((n) => ({
      id: n.id,
      label: n.label.trim(),
      checkQuestions: n.questions
        .filter((q) => q.prompt.trim())
        .map((q, qIdx) => ({
          id: `q-${qIdx + 1}`,
          prompt: q.prompt.trim(),
          expectedAnswer: q.expectedAnswer.trim(),
        })),
    }));
  if (nodes.length === 0) return [];
  const ids = new Set(nodes.map((n) => n.id));
  const edges = map.nodes
    .filter((n) => ids.has(n.id))
    .flatMap((n) => n.dependsOn.filter((d) => ids.has(d) && d !== n.id).map((d) => ({ from: d, to: n.id })));
  return [{ id: "concept-map-1", title: map.title.trim(), nodes, edges }];
}

/**
 * Convert builder state → element defs. The single source of truth for "what
 * elements does this activity have", used by the save handler and the preview.
 */
export function builderToElementDefs(s: BuilderElements): ActivityElementDefs {
  return {
    checklist: s.checklist
      .map((i) => i.label.trim())
      .filter(Boolean)
      .map((label, idx) => ({ id: `step-${idx + 1}`, label })),
    table: tableDefs(s.table),
    // 1.1.64 — several charts, each with its own (optional) axis binding. An
    // unbound chart keeps the 1.1.38 auto-bind, so nothing authored before this
    // changes shape.
    chart: (s.chart ?? []).map((c, idx) => ({
      id: c.id || `chart-${idx + 1}`,
      title: c.title.trim(),
      chartKind: c.chartKind,
      tableId: c.tableId ?? null,
      xColumn: c.xColumn ?? null,
      yColumn: c.yColumn ?? null,
    })),
    calculator: calculatorDefs(s.calculator),
    note: s.note && s.note.body.trim() ? [{ id: "note-1", title: s.note.title.trim(), body: s.note.body.trim() }] : [],
    // Ids are PRESERVED when present: student text is keyed by element id, so
    // re-minting positionally on every save would orphan a group's writing (the
    // hazard 1.1.71 documents for tables). Only a brand-new row is minted, and
    // from its stable client key rather than its position.
    writing: (s.writing ?? []).map((w) => ({
      id: w.id || `writing-${w.key}`,
      title: w.title.trim(),
      prompt: w.prompt.trim(),
      minWords: w.minWords || 0,
    })),
    // The solution editor needs no content to be valid — the student writes; a
    // present (enabled) element ships with its (optional) teacher prompt.
    solution: s.solution ? [{ id: "solution-1", prompt: s.solution.prompt.trim() }] : [],
    // The document upload needs no content to be valid — the student uploads; a
    // present element ships with its (optional) teacher prompt.
    document: s.document ? [{ id: "document-1", prompt: s.document.prompt.trim() }] : [],
    conceptMap: conceptMapDefs(s.conceptMap),
  };
}

/** True when an activity has at least one workspace element to preview. */
export function hasAnyElement(defs: ActivityElementDefs): boolean {
  return (
    defs.checklist.length > 0 ||
    defs.table.length > 0 ||
    defs.chart.length > 0 ||
    defs.calculator.length > 0 ||
    defs.note.length > 0 ||
    defs.writing.length > 0 ||
    defs.solution.length > 0 ||
    defs.document.length > 0 ||
    defs.conceptMap.length > 0
  );
}
