"use client";

import { useMemo, useRef, useState } from "react";

import type { ActivityConfigPayload, Language, MaterialRef, WorkbenchType } from "@/lib/teacherApi";
import { builderToElementDefs } from "@/lib/activityPreview";
import type { TableEditorValue } from "@/components/teacher/TableEditor";
import type { ChartEditorValue } from "@/components/teacher/ChartEditor";
import type { CalculatorEditorValue } from "@/components/teacher/CalculatorEditor";
import type { NoteEditorValue } from "@/components/teacher/NoteEditor";
import type { SolutionEditorValue } from "@/components/teacher/SolutionEditor";
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

export interface ActivityBuilder {
  title: string;
  setTitle: (v: string) => void;
  teachingGoal: string;
  setTeachingGoal: (v: string) => void;
  language: Language;
  setLanguage: (v: Language) => void;
  /** The activity type (1.1.45 M3b). "document" = a document-feedback activity
   *  (student uploads work for tutor critique); "none" = the standard workspace. */
  workbenchType: WorkbenchType;
  setWorkbenchType: (v: WorkbenchType) => void;

  checklist: ChecklistRow[];
  addChecklistItem: () => void;
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
  elementPayload: () => {
    artefactId: string | null;
    checklist: { id: string; label: string }[];
    table: ReturnType<typeof builderToElementDefs>["table"];
    chart: ReturnType<typeof builderToElementDefs>["chart"];
    calculator: ReturnType<typeof builderToElementDefs>["calculator"];
    note: ReturnType<typeof builderToElementDefs>["note"];
    solution: ReturnType<typeof builderToElementDefs>["solution"];
  };
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
  const [artefactId, setArtefactId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<MaterialRef[]>([]);
  const nextKeyRef = useRef(1);

  const addChecklistItem = () =>
    setChecklist((cur) => [...cur, { key: nextKeyRef.current++, label: "" }]);
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
    setSolution(null);
    setArtefactId(t.artefactId ?? null);
    // Templates are standard workspace activities — leaving document mode.
    setWorkbenchType("none");
  }

  // The inverse of `elementPayload` — saved element arrays → editor values.
  // Each element type persists as an array but the builder edits a single one
  // (the [0] convention `builderToElementDefs` produces), so hydrate reads [0].
  function hydrate(cfg: ActivityConfigPayload) {
    setTitle(cfg.title ?? "");
    setTeachingGoal(cfg.teachingGoal ?? "");
    setLanguage(cfg.language);
    setWorkbenchType(cfg.workbenchType ?? "none");
    setArtefactId(cfg.artefactId ?? null);
    setMaterials(cfg.materials ?? []);
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
  }

  function elementPayload() {
    return {
      artefactId,
      ...builderToElementDefs({ checklist, table, chart, calculator, note, solution }),
    };
  }

  const workspaceCount =
    (artefactId ? 1 : 0) +
    (checklist.length > 0 ? 1 : 0) +
    (table ? 1 : 0) +
    (chart ? 1 : 0) +
    (calculator ? 1 : 0) +
    (note ? 1 : 0) +
    (solution ? 1 : 0);

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
      artefactId,
      setArtefactId,
      materials,
      setMaterials,
      workspaceCount,
      applyTemplate,
      hydrate,
      elementPayload,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, teachingGoal, language, workbenchType, checklist, table, chart, calculator, note, solution, artefactId, materials],
  );
}
