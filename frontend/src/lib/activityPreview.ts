// Shared activity-element normalisation (1.1.40) — converts the builder's
// editor-value state into the element-def shapes the workspace renderers take.
// The SAME function feeds both the save payload and the live preview, so what a
// teacher previews is byte-identical to what students get (no parallel
// converter that could drift).

import type { CalculatorEditorValue } from "@/components/teacher/CalculatorEditor";
import type { ChartEditorValue } from "@/components/teacher/ChartEditor";
import type { NoteEditorValue } from "@/components/teacher/NoteEditor";
import type { TableEditorValue } from "@/components/teacher/TableEditor";
import type { SolutionEditorValue } from "@/components/teacher/SolutionEditor";
import type { DocumentEditorValue } from "@/components/teacher/DocumentEditor";
import type { CalculatorElementDef } from "@/components/workspace/WorkbenchCalculator";
import type { ChartElementDef } from "@/components/workspace/WorkbenchChart";
import type { NoteElementDef } from "@/components/workspace/WorkbenchNote";
import type { SolutionElementDef } from "@/components/workspace/SolutionElementMount";
import type { DocumentElementDef } from "@/components/workspace/DocumentElementMount";
import type { TableElementDef } from "@/components/workspace/WorkbenchTable";

export interface BuilderChecklistItem {
  key: number;
  label: string;
}

/** The element-bearing slice of the activity builder's state. */
export interface BuilderElements {
  checklist: BuilderChecklistItem[];
  table: TableEditorValue | null;
  chart: ChartEditorValue | null;
  calculator: CalculatorEditorValue | null;
  note: NoteEditorValue | null;
  solution: SolutionEditorValue | null;
  document: DocumentEditorValue | null;
}

/** The normalised element defs — what the renderers (and the save payload) take. */
export interface ActivityElementDefs {
  checklist: { id: string; label: string }[];
  table: TableElementDef[];
  chart: ChartElementDef[];
  calculator: CalculatorElementDef[];
  note: NoteElementDef[];
  solution: SolutionElementDef[];
  document: DocumentElementDef[];
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
 *  has no valid inputs or no formula. */
function calculatorDefs(calc: CalculatorEditorValue | null): CalculatorElementDef[] {
  if (!calc) return [];
  const inputs = calc.inputs
    .filter((i) => VAR_ID_RE.test(i.id.trim()) && i.label.trim())
    .map((i) => ({ id: i.id.trim(), label: i.label.trim(), unit: i.unit.trim() }));
  if (inputs.length === 0 || !calc.formula.trim()) return [];
  return [{ id: "calc-1", title: calc.title.trim(), formula: calc.formula.trim(), inputs }];
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
    chart: s.chart ? [{ id: "chart-1", title: s.chart.title.trim(), chartKind: s.chart.chartKind }] : [],
    calculator: calculatorDefs(s.calculator),
    note: s.note && s.note.body.trim() ? [{ id: "note-1", title: s.note.title.trim(), body: s.note.body.trim() }] : [],
    // The solution editor needs no content to be valid — the student writes; a
    // present (enabled) element ships with its (optional) teacher prompt.
    solution: s.solution ? [{ id: "solution-1", prompt: s.solution.prompt.trim() }] : [],
    // The document upload needs no content to be valid — the student uploads; a
    // present element ships with its (optional) teacher prompt.
    document: s.document ? [{ id: "document-1", prompt: s.document.prompt.trim() }] : [],
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
    defs.solution.length > 0 ||
    defs.document.length > 0
  );
}
