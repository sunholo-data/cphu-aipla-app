"use client";

import { useMemo, useRef, useState } from "react";

import type { ActivityConfigPayload, Language, MaterialRef, StxLevel, WorkbenchType } from "@/lib/teacherApi";
import { builderToElementDefs } from "@/lib/activityPreview";
import type { TableEditorValue } from "@/components/teacher/TableEditor";
import type { ChartEditorValue } from "@/components/teacher/ChartEditor";
import type { CalculatorEditorValue } from "@/components/teacher/CalculatorEditor";
import type { ConceptMapEditorValue } from "@/components/teacher/ConceptMapEditor";
import type { NoteEditorValue } from "@/components/teacher/NoteEditor";
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

  table: TableEditorValue | null;
  setTable: (v: TableEditorValue | null) => void;
  chart: ChartEditorValue | null;
  setChart: (v: ChartEditorValue | null) => void;
  calculator: CalculatorEditorValue | null;
  setCalculator: (v: CalculatorEditorValue | null) => void;
  note: NoteEditorValue | null;
  setNote: (v: NoteEditorValue | null) => void;
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
  const [table, setTable] = useState<TableEditorValue | null>(null);
  const [chart, setChart] = useState<ChartEditorValue | null>(null);
  const [calculator, setCalculator] = useState<CalculatorEditorValue | null>(null);
  const [note, setNote] = useState<NoteEditorValue | null>(null);
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
        ? {
            title: t.table.title,
            columns: t.table.columns.map((c) => ({
              key: nextKeyRef.current++,
              label: c.label,
              unit: c.unit ?? "",
              kind: c.kind,
            })),
            rows: t.table.rows,
          }
        : null,
    );
    setChart(t.chart ? { title: t.chart.title, chartKind: t.chart.chartKind } : null);
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

    const t = cfg.table?.[0];
    setTable(
      t
        ? {
            title: t.title ?? "",
            columns: t.columns.map((c) => ({
              key: nextKeyRef.current++,
              label: c.label,
              unit: c.unit ?? "",
              kind: c.kind ?? "number",
            })),
            rows: t.rows,
          }
        : null,
    );

    const ch = cfg.chart?.[0];
    setChart(ch ? { title: ch.title ?? "", chartKind: ch.chartKind } : null);

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
      ...builderToElementDefs({ checklist, table, chart, calculator, note, solution, document, conceptMap }),
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
    (table ? 1 : 0) +
    (chart ? 1 : 0) +
    (calculator ? 1 : 0) +
    (note ? 1 : 0) +
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
      setTable,
      chart,
      setChart,
      calculator,
      setCalculator,
      note,
      setNote,
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
      workspaceCount,
      applyTemplate,
      hydrate,
      elementPayload,
      toSavePayload,
      isFormValid,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, teachingGoal, language, workbenchType, checklist, table, chart, calculator, note, solution, document, conceptMap, artefactId, materials],
  );
}
