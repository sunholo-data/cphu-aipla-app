/**
 * Canonical workbench element types — ONE TypeScript definition shared by the
 * teacher-side wire/save shape (`lib/teacherApi`) and the student-side render
 * shape (`components/workspace/*`, historically the `*Def` types).
 *
 * These were defined twice in parallel ("Mirrors the backend TableElement"
 * comments), and had silently drifted: `SolutionElement`/`DocumentElement`
 * `prompt` was optional on the wire but declared REQUIRED in the renderers.
 * Reconciled here to optional (the wire/backend truth — both renderers already
 * guard `prompt`). The backend Pydantic models (`db/models/activity_config.py`)
 * remain the wire source of truth; this is the single TypeScript mirror.
 *
 * The old names are re-exported from their original modules (teacherApi + each
 * workspace file expose `*Def` aliases) so existing imports keep working.
 */

export interface ChecklistItem {
  id: string;
  label: string;
}

/** A column of a teacher-defined data table (1.1.38 M1). Mirrors the backend
 *  `TableColumn`. `kind` gates the student input control (numeric vs text). */
export interface TableColumn {
  id: string;
  label: string;
  unit?: string;
  kind?: "number" | "text";
}

/** A teacher-defined data table the student fills in (1.1.38 M1). Mirrors the
 *  backend `TableElement`; capped server-side (columns 1-8, rows 1-50). */
export interface TableElement {
  id: string;
  title?: string;
  columns: TableColumn[];
  rows: number;
}

/** A chart plotting columns of the activity's data table (1.1.38 M2, extended
 *  1.1.64). `tableId`/`xColumn`/`yColumn` are OPTIONAL: unset auto-binds to the
 *  first table's first two numeric columns (the 1.1.38 behaviour, so charts
 *  authored before 1.1.64 render unchanged with no backfill). Set them to plot
 *  a specific variable pair — which is what makes several charts on one
 *  activity worth having. Resolution + the dangling-reference fallback live in
 *  `lib/resolveChartBinding`. */
export interface ChartElement {
  id: string;
  title?: string;
  chartKind: "scatter" | "line" | "bar";
  tableId?: string | null;
  xColumn?: string | null;
  yColumn?: string | null;
}

/** A named variable a calculator formula references (1.1.38 M3). */
export interface CalcInput {
  id: string;
  label: string;
  unit?: string;
}

/** A teacher-authored formula calculator (1.1.38 M3). The formula is evaluated
 *  client-side by a safe whitelisted-grammar parser (no eval). */
export interface CalculatorElement {
  id: string;
  title?: string;
  formula: string;
  inputs: CalcInput[];
}

/** A teacher-authored instructions / reference note (1.1.38 M4). Markdown body,
 *  rendered read-only in the workspace. Distinct from uploaded `materials`. */
export interface NoteElement {
  id: string;
  title?: string;
  body: string;
}

/** A student writing surface (1.1.73, JB 2026-08-11). The teacher authors the
 *  prompt + bounds; the student's TEXT is per-group state (`writing_progress`),
 *  not stored on the config.
 *
 *  Not a `NoteElement` (teacher text the student reads) and not a
 *  `SolutionElement` (physics working, drawn or photographed — 1.1.48 removed
 *  the typed version because students do not type LaTeX). This is prose, which
 *  is the thing a 16-year-old types fluently. It gets no maths input for that
 *  reason. `minWords` is a target shown to the student, never a save gate. */
export interface WritingElement {
  id: string;
  title?: string;
  prompt?: string;
  placeholder?: string;
  minWords?: number;
  maxChars?: number;
}

/** A solution element (1.1.45 M4 → image-based 1.1.48, JB-2). The teacher authors
 *  the `prompt`; the student DRAWS their solution (or uploads a photo). The
 *  student's work is session state, not persisted on the config. */
export interface SolutionElement {
  id: string;
  prompt?: string;
}

/** A document-upload element (1.1.48 — reconciled from workbench_type="document").
 *  The teacher authors the `prompt`; the student uploads their own file(s). */
export interface DocumentElement {
  id: string;
  prompt?: string;
}

/** A node-bound check question for a chat-native checkpoint (living-concept-map).
 *  The tutor asks it IN CONVERSATION (`options` optional); `expectedAnswer` is
 *  the judging rubric. Mirrors the backend `CheckQuestion`. */
export interface ConceptCheckQuestion {
  id: string;
  prompt: string;
  options?: { id: string; label: string; correct?: boolean }[];
  expectedAnswer?: string;
  explanation?: string;
}

/** One concept in the activity's prerequisite graph. Mirrors the backend
 *  `ConceptNode`; `id` is stable (edges + checkpoint state key on it). */
export interface ConceptMapNode {
  id: string;
  label: string;
  level?: "A" | "B" | "C" | null;
  dra?: string | null;
  checkQuestions?: ConceptCheckQuestion[];
}

/** A prerequisite edge (`from` must be demonstrated before `to`). Mirrors the
 *  backend `ConceptEdge` wire shape. */
export interface ConceptMapEdge {
  from: string;
  to: string;
  kind?: "prerequisite";
}

/** The living concept map (living-concept-map M0) — one per activity (cap 1),
 *  cycle-guarded server-side. Mirrors the backend `ConceptMapElement`. */
export interface ConceptMapElement {
  id: string;
  title?: string;
  nodes: ConceptMapNode[];
  edges: ConceptMapEdge[];
}
