"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import type { ActivityConfigPayload, Language, MaterialRef, StxLevel, WorkbenchType } from "@/lib/teacherApi";
import { builderToElementDefs } from "@/lib/activityPreview";
import type { TableEditorValue } from "@/components/teacher/TableEditor";
import type { ChartEditorValue } from "@/components/teacher/ChartEditor";
import type { CalculatorEditorValue } from "@/components/teacher/CalculatorEditor";
import type { ConceptMapEditorValue } from "@/components/teacher/ConceptMapEditor";
import type { NoteEditorValue } from "@/components/teacher/NoteEditor";
import type { WritingEditorRow } from "@/components/teacher/WritingEditor";
import type { SolutionEditorValue } from "@/components/teacher/SolutionEditor";
import type { DocumentEditorValue } from "@/components/teacher/DocumentEditor";
import type { ActivityTemplate } from "@/lib/activityTemplates";

// Shared activity-builder state (1.1.40 M1). Both the create page and the edit
// page drive their workspace from this one hook, so they can't drift: the
// element/sim state shape, the template fill, the load-from-saved hydration, and
// — critically — the save slice (`elementPayload`) all live here. The data-loss
// bug it fixes: the edit page used to POST only {title, goal, language,
// materials}; because POST is a full overwrite, that silently wiped every
// element + the attached sim. There is now ONE place that assembles the element
// slice, used by both pages.

export interface ChecklistRow {
  key: number;
  label: string;
}

/** The element + sim slice of the save payload — the data-loss-critical part.
 *  Same shape the live preview reads, so preview === saved activity. */
export interface ElementPayload {
  artefactId: string | null;
  checklist: { id: string; label: string }[];
  table: ReturnType<typeof builderToElementDefs>["table"];
  chart: ReturnType<typeof builderToElementDefs>["chart"];
  calculator: ReturnType<typeof builderToElementDefs>["calculator"];
  note: ReturnType<typeof builderToElementDefs>["note"];
  writing: ReturnType<typeof builderToElementDefs>["writing"];
  solution: ReturnType<typeof builderToElementDefs>["solution"];
  document: ReturnType<typeof builderToElementDefs>["document"];
  conceptMap: ReturnType<typeof builderToElementDefs>["conceptMap"];
}

/** The full payload both the create and edit pages POST/PATCH. Page-specific
 *  fields (skillId, classId on create) are added by the caller. Title + goal are
 *  trimmed; the element slice is the COMPLETE set (a partial wipes data — the
 *  POST is a full overwrite). */
export interface SavePayload extends ElementPayload {
  title: string;
  teachingGoal: string;
  language: Language;
  workbenchType: WorkbenchType;
  materials: MaterialRef[];
  /** 1.1.61 — the activity's OWN facets. Carried through the builder purely so
   *  a save cannot wipe them: a teacher files an activity from the library row
   *  (a screen that shows subject/level/tags) and then edits it here, on a screen
   *  that does not. Because the save is a FULL OVERWRITE, omitting these would
   *  clear them silently. The builder never *edits* them — filing happens in the
   *  library — it just refuses to lose them.
   *
   *  INHERITED facets are deliberately absent: they belong to the cited
   *  documents, and writing them back would freeze a derived value into a stored
   *  one, which is the whole thing this design avoids. */
  tags: string[];
  subject: string | null;
  level: StxLevel | null;
}

export interface ActivityBuilder {
  title: string;
  setTitle: (v: string) => void;
  teachingGoal: string;
  setTeachingGoal: (v: string) => void;
  language: Language;
  setLanguage: (v: Language) => void;
  /** Runtime workbench surface (1.1.48): "app" = a sim iframe, "none" = the
   *  standard element workspace. No longer teacher-chosen (document-feedback is
   *  now the `document` element); kept for round-trip + the sim backfill. */
  workbenchType: WorkbenchType;
  setWorkbenchType: (v: WorkbenchType) => void;

  checklist: ChecklistRow[];
  addChecklistItem: () => void;
  /** Append a batch of labelled steps (the co-pilot's add_element Apply target). */
  addChecklistItems: (labels: string[]) => void;
  removeChecklistItem: (key: number) => void;
  setChecklistLabel: (key: number, label: string) => void;

  table: TableEditorValue[];
  setTable: (v: TableEditorValue[]) => void;
  chart: ChartEditorValue[];
  setChart: (v: ChartEditorValue[]) => void;
  calculator: CalculatorEditorValue | null;
  setCalculator: (v: CalculatorEditorValue | null) => void;
  note: NoteEditorValue | null;
  setNote: (v: NoteEditorValue | null) => void;
  writing: WritingEditorRow[];
  setWriting: (v: WritingEditorRow[]) => void;
  solution: SolutionEditorValue | null;
  setSolution: (v: SolutionEditorValue | null) => void;
  document: DocumentEditorValue | null;
  setDocument: (v: DocumentEditorValue | null) => void;
  conceptMap: ConceptMapEditorValue | null;
  setConceptMap: (v: ConceptMapEditorValue | null) => void;
  /** Mints a unique client key (checklist rows, concept nodes/questions). */
  nextElementKey: () => number;
  artefactId: string | null;
  setArtefactId: (v: string | null) => void;
  materials: MaterialRef[];
  setMaterials: (v: MaterialRef[]) => void;
  /** 1.1.61 — the activity's OWN facets. Held so a save cannot wipe them; the
   *  setters exist for the authoring co-pilot's `set_activity_facets` Apply,
   *  which files the activity it just composed. Routine filing happens on the
   *  library row, not here. */
  tags: string[];
  setTags: (v: string[]) => void;
  subject: string | null;
  setSubject: (v: string | null) => void;
  level: StxLevel | null;
  setLevel: (v: StxLevel | null) => void;

  /** How many additive workspace things are configured (sim + each element). */
  workspaceCount: number;
  /** Fill every field from a starter template. */
  applyTemplate: (t: ActivityTemplate) => void;
  /** Load element/sim/materials state from a saved config (the edit page). */
  hydrate: (cfg: ActivityConfigPayload) => void;
  /** The element + sim slice of the save payload — the SAME shape the live
   *  preview reads, so preview === saved activity, on BOTH pages. */
  elementPayload: () => ElementPayload;
  /** The full save payload (title/goal/language/workbenchType + element slice +
   *  materials) both pages send. Centralized here so the two pages can't drift
   *  on which fields they persist — the data-loss footgun this hook exists for. */
  toSavePayload: () => SavePayload;
  /** Whether the form is submittable on its own terms: non-empty title + goal.
   *  Pages add their own gates (e.g. a selected class on create). */
  isFormValid: () => boolean;
}

export function useActivityBuilder(): ActivityBuilder {
  const [title, setTitle] = useState("");
  const [teachingGoal, setTeachingGoal] = useState("");
  const [language, setLanguage] = useState<Language>("da");
  const [workbenchType, setWorkbenchType] = useState<WorkbenchType>("none");
  // `key` is a stable client id for React; the persisted id is positional.
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [table, setTable] = useState<TableEditorValue[]>([]);
  const [chart, setChart] = useState<ChartEditorValue[]>([]);

  // 1.1.64 — column ids USED to be minted positionally (`col-{n}` over the
  // label-bearing columns), so deleting a column SHIFTED every later id and a
  // chart bound to `col-3` would silently plot what used to be `col-4`. The
  // render-side fallback cannot catch that, because the id still resolves. This
  // reconcile closed it by clearing any binding that no longer named the SAME
  // column label.
  //
  // 1.1.71 removed the CAUSE: ids are minted at creation (`col-k{key}`) and
  // preserved on load, so nothing renames when anything is deleted. The
  // reconcile stays for activities authored BEFORE that, whose columns still
  // carry positional ids — but it must now be id-aware, or it would start
  // clearing perfectly valid stable bindings. A binding whose id is still
  // present in the new column set is correct by construction and is left alone;
  // only the legacy positional case falls through to label matching.
  const setTableReconciling = useCallback(
    (next: TableEditorValue[]) => {
      setTable((prev) => {
        const allColumnIds = (tables: TableEditorValue[]) => {
          const ids = new Set<string>();
          for (const t of tables) for (const c of t.columns) if (c.id) ids.add(c.id);
          return ids;
        };
        const nextIds = allColumnIds(next);

        // Positional label lookup, scoped to the table the binding names — the
        // pre-1.1.71 behaviour, unchanged for the activities that need it.
        const labelFor = (tables: TableEditorValue[], tableId: string | null | undefined, mintedId: string | null | undefined) => {
          if (!mintedId) return null;
          const t = tables.find((x) => x.id === tableId) ?? tables[0];
          if (!t) return null;
          const cols = t.columns.filter((c) => c.label.trim());
          const idx = Number(String(mintedId).replace("col-", "")) - 1;
          if (!Number.isInteger(idx) || idx < 0) return null;
          return cols[idx]?.label.trim() ?? null;
        };

        setChart((cs) =>
          cs.map((c) => {
            // Stable ids: still present ⇒ still correct. Nothing to reconcile.
            const stableX = c.xColumn ? nextIds.has(c.xColumn) : true;
            const stableY = c.yColumn ? nextIds.has(c.yColumn) : true;
            if (stableX && stableY) return c;
            const keepX = stableX || labelFor(prev, c.tableId, c.xColumn) === labelFor(next, c.tableId, c.xColumn);
            const keepY = stableY || labelFor(prev, c.tableId, c.yColumn) === labelFor(next, c.tableId, c.yColumn);
            if (keepX && keepY) return c;
            return { ...c, xColumn: keepX ? c.xColumn : null, yColumn: keepY ? c.yColumn : null };
          }),
        );
        return next;
      });
    },
    [],
  );
  const [calculator, setCalculator] = useState<CalculatorEditorValue | null>(null);
  const [note, setNote] = useState<NoteEditorValue | null>(null);
  const [writing, setWriting] = useState<WritingEditorRow[]>([]);
  const [solution, setSolution] = useState<SolutionEditorValue | null>(null);
  const [document, setDocument] = useState<DocumentEditorValue | null>(null);
  const [conceptMap, setConceptMap] = useState<ConceptMapEditorValue | null>(null);
  const [artefactId, setArtefactId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialRef[]>([]);
  // 1.1.61 — held, not edited (see SavePayload). Round-trip only.
  const [tags, setTags] = useState<string[]>([]);
  const [subject, setSubject] = useState<string | null>(null);
  const [level, setLevel] = useState<StxLevel | null>(null);
  const nextKeyRef = useRef(1);
  const nextElementKey = () => nextKeyRef.current++;

  const addChecklistItem = () =>
    setChecklist((cur) => [...cur, { key: nextKeyRef.current++, label: "" }]);
  const addChecklistItems = (labels: string[]) =>
    setChecklist((cur) => [...cur, ...labels.map((label) => ({ key: nextKeyRef.current++, label }))]);
  const removeChecklistItem = (key: number) =>
    setChecklist((cur) => cur.filter((i) => i.key !== key));
  const setChecklistLabel = (key: number, label: string) =>
    setChecklist((cur) => cur.map((i) => (i.key === key ? { ...i, label } : i)));

  function applyTemplate(t: ActivityTemplate) {
    setTitle(t.title);
    setTeachingGoal(t.teachingGoal);
    setLanguage(t.language);
    setChecklist(t.checklist.map((label) => ({ key: nextKeyRef.current++, label })));
    setTable(
      t.table
        ? [
            {
              key: nextKeyRef.current++,
              title: t.table.title,
              columns: t.table.columns.map((c) => ({
                key: nextKeyRef.current++,
                label: c.label,
                unit: c.unit ?? "",
                kind: c.kind,
              })),
              rows: t.table.rows,
            },
          ]
        : [],
    );
    setChart(t.chart ? [{ id: "chart-1", title: t.chart.title, chartKind: t.chart.chartKind }] : []);
    setCalculator(
      t.calculator
        ? {
            title: t.calculator.title,
            formula: t.calculator.formula,
            inputs: t.calculator.inputs.map((i) => ({
              key: nextKeyRef.current++,
              id: i.id,
              label: i.label,
              unit: i.unit ?? "",
            })),
          }
        : null,
    );
    setNote(t.note ? { title: t.note.title, body: t.note.body } : null);
    // `id: ""` marks each row unsaved, so `elementPayload()` mints a stable id
    // from the client key rather than the row's position — the same path the
    // co-pilot's Apply takes, and the reason deleting a row cannot silently
    // re-point another one's student text (1.1.71).
    setWriting(
      (t.writing ?? []).map((w) => ({
        key: nextKeyRef.current++,
        id: "",
        title: w.title,
        prompt: w.prompt,
        minWords: w.minWords ?? 0,
      })),
    );
    setSolution(t.solution ? { prompt: t.solution.prompt } : null);
    setDocument(t.document ? { prompt: t.document.prompt } : null);
    setConceptMap(
      t.conceptMap
        ? {
            title: t.conceptMap.title,
            nodes: t.conceptMap.nodes.map((n) => ({
              key: nextKeyRef.current++,
              id: n.id,
              label: n.label,
              dependsOn: n.dependsOn ?? [],
              questions: (n.questions ?? []).map((q) => ({
                key: nextKeyRef.current++,
                prompt: q.prompt,
                expectedAnswer: q.expectedAnswer,
              })),
            })),
          }
        : null,
    );
    setArtefactId(t.artefactId ?? null);
    setWorkbenchType("none");
  }

  // The inverse of `elementPayload` — saved element arrays → editor values.
  // Each element type persists as an array but the builder edits a single one
  // (the [0] convention `builderToElementDefs` produces), so hydrate reads [0].
  function hydrate(cfg: ActivityConfigPayload) {
    setTitle(cfg.title ?? "");
    setTeachingGoal(cfg.teachingGoal ?? "");
    // Default like every other field — an empty hydrate ("Create another")
    // must reset language to the default, not leave it undefined.
    setLanguage(cfg.language ?? "da");
    setWorkbenchType(cfg.workbenchType ?? "none");
    setArtefactId(cfg.artefactId ?? null);
    setMaterials(cfg.materials ?? []);
    // Own facets only. `inherited*` on the payload is display data derived from
    // the cited documents and must never round-trip into a write.
    setTags(cfg.tags ?? []);
    setSubject(cfg.subject ?? null);
    setLevel(cfg.level ?? null);
    setChecklist((cfg.checklist ?? []).map((c) => ({ key: nextKeyRef.current++, label: c.label })));

    // 1.1.71 — load EVERY table, not just the first, and PRESERVE the saved
    // ids. Reading only [0] here while the payload round-trips the whole array
    // is exactly how a save silently drops the rest (the full-overwrite
    // footgun, which has now bitten subject, language and charts). Carrying the
    // ids across is what makes deleting a table safe: nothing is re-minted, so
    // no chart binding moves.
    setTable(
      (cfg.table ?? []).map((t) => ({
        key: nextKeyRef.current++,
        id: t.id,
        title: t.title ?? "",
        columns: t.columns.map((c) => ({
          key: nextKeyRef.current++,
          id: c.id,
          label: c.label,
          unit: c.unit ?? "",
          kind: c.kind ?? "number",
        })),
        rows: t.rows,
      })),
    );

    // 1.1.64 — load EVERY chart, not just the first. Reading only [0] here
    // while the payload round-trips the whole array is exactly how a save
    // silently drops the others (the full-overwrite footgun).
    setChart(
      (cfg.chart ?? []).map((ch, idx) => ({
        id: ch.id || `chart-${idx + 1}`,
        title: ch.title ?? "",
        chartKind: ch.chartKind,
        tableId: ch.tableId ?? null,
        xColumn: ch.xColumn ?? null,
        yColumn: ch.yColumn ?? null,
      })),
    );

    const calc = cfg.calculator?.[0];
    setCalculator(
      calc
        ? {
            title: calc.title ?? "",
            formula: calc.formula,
            inputs: calc.inputs.map((i) => ({
              key: nextKeyRef.current++,
              id: i.id,
              label: i.label,
              unit: i.unit ?? "",
            })),
          }
        : null,
    );

    const n = cfg.note?.[0];
    setNote(n ? { title: n.title ?? "", body: n.body } : null);

    setWriting(
      (cfg.writing ?? []).map((w) => ({
        key: nextKeyRef.current++,
        // Preserve the SAVED id — the group's text is keyed by it.
        id: w.id,
        title: w.title ?? "",
        prompt: w.prompt ?? "",
        minWords: w.minWords ?? 0,
      })),
    );

    const sol = cfg.solution?.[0];
    setSolution(sol ? { prompt: sol.prompt ?? "" } : null);

    const doc = cfg.document?.[0];
    setDocument(doc ? { prompt: doc.prompt ?? "" } : null);

    // Node ids are PRESERVED (edges + the M3 checkpoint state key on them);
    // dependsOn is the list projection of the stored edges (from = prerequisite).
    const cm = cfg.conceptMap?.[0];
    setConceptMap(
      cm
        ? {
            title: cm.title ?? "",
            nodes: cm.nodes.map((n) => ({
              key: nextKeyRef.current++,
              id: n.id,
              label: n.label,
              dependsOn: (cm.edges ?? []).filter((e) => e.to === n.id).map((e) => e.from),
              questions: (n.checkQuestions ?? []).map((q) => ({
                key: nextKeyRef.current++,
                prompt: q.prompt,
                expectedAnswer: q.expectedAnswer ?? "",
              })),
            })),
          }
        : null,
    );
  }

  function elementPayload(): ElementPayload {
    return {
      artefactId,
      ...builderToElementDefs({ checklist, table, chart, calculator, note, writing, solution, document, conceptMap }),
    };
  }

  function toSavePayload(): SavePayload {
    return {
      title: title.trim(),
      teachingGoal: teachingGoal.trim(),
      language,
      workbenchType,
      ...elementPayload(),
      materials,
      tags,
      subject,
      level,
    };
  }

  function isFormValid(): boolean {
    return title.trim().length > 0 && teachingGoal.trim().length > 0;
  }

  const workspaceCount =
    (artefactId ? 1 : 0) +
    (checklist.length > 0 ? 1 : 0) +
    // 1.1.71 — tables are a LIST and each is its own workspace element, so this
    // counts them like charts. Note `table ? 1 : 0` would be WRONG twice over
    // now: an empty array is truthy, so every activity would count one table it
    // does not have.
    table.length +
    chart.length +
    (calculator ? 1 : 0) +
    (note ? 1 : 0) +
    writing.length +
    (solution ? 1 : 0) +
    (document ? 1 : 0) +
    (conceptMap ? 1 : 0);

  return useMemo(
    () => ({
      title,
      setTitle,
      teachingGoal,
      setTeachingGoal,
      language,
      setLanguage,
      workbenchType,
      setWorkbenchType,
      checklist,
      addChecklistItem,
      addChecklistItems,
      removeChecklistItem,
      setChecklistLabel,
      table,
      setTable: setTableReconciling,
      chart,
      setChart,
      calculator,
      setCalculator,
      note,
      setNote,
      writing,
      setWriting,
      solution,
      setSolution,
      document,
      setDocument,
      conceptMap,
      setConceptMap,
      nextElementKey,
      artefactId,
      setArtefactId,
      materials,
      setMaterials,
      tags,
      setTags,
      subject,
      setSubject,
      level,
      setLevel,
      workspaceCount,
      applyTemplate,
      hydrate,
      elementPayload,
      toSavePayload,
      isFormValid,
    }),
    // NOTE: exhaustive-deps is disabled here, so EVERY piece of state above must
    // be listed by hand. Miss one and the returned object silently keeps a stale
    // value — the hook looks like it ignored your setter. 1.1.61's tags/subject/
    // level were missed exactly this way and only surfaced because a test asserted
    // the value after Apply rather than asserting the setter was called.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      title,
      teachingGoal,
      language,
      workbenchType,
      checklist,
      table,
      chart,
      calculator,
      note,
      writing,
      solution,
      document,
      conceptMap,
      artefactId,
      materials,
      tags,
      subject,
      level,
    ],
  );
}
