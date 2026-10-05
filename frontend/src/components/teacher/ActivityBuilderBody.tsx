"use client";

import { MessageCircle, Plus, X } from "lucide-react";
import type { ReactNode } from "react";

import { ActivityPreview } from "@/components/teacher/ActivityPreview";
import { BuilderHints } from "@/components/teacher/BuilderHints";
import { BuilderSection, BuilderSectionNav, SECTION } from "@/components/teacher/BuilderLayout";
import { CalculatorEditor } from "@/components/teacher/CalculatorEditor";
import { ChartEditor } from "@/components/teacher/ChartEditor";
import { ConceptMapEditor } from "@/components/teacher/ConceptMapEditor";
import { DocumentEditor } from "@/components/teacher/DocumentEditor";
import { MaterialsSection } from "@/components/teacher/MaterialsSection";
import { NoteEditor } from "@/components/teacher/NoteEditor";
import { WritingEditor } from "@/components/teacher/WritingEditor";
import { SimPicker } from "@/components/teacher/SimPicker";
import { SolutionEditor } from "@/components/teacher/SolutionEditor";
import { TableEditor } from "@/components/teacher/TableEditor";
import { useCopilotEntry } from "@/components/teacher/copilot";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { languageHint, tableHints, type BuilderHint } from "@/lib/builderHints";

// Living concept map (CONCEPT-1 M1) — dark-flagged like the authoring co-pilot;
// bakes at build time (cloudbuild `_CONCEPT_MAP`), on for dev.
const CONCEPT_MAP_ENABLED = process.env.NEXT_PUBLIC_CONCEPT_MAP === "1";

interface ActivityBuilderBodyProps {
  builder: ActivityBuilder;
  /** The template strip (create page only), rendered at the top of the config
   *  column so the live preview sits BESIDE it — clicking through templates
   *  re-renders the student view, which is the preview a teacher chooses by. */
  templateSlot?: ReactNode;
  /** The activity id, threaded to the Materials section so image uploads can be
   *  attached to the activity slot (1.1.44). Edit page: route param; create
   *  page: the resolved concept skill id. */
  activityId?: string;
  /** The class control for the Setup section — a `<select>` on the create page,
   *  a read-only line on the edit page (class is fixed once an activity exists). */
  classControl?: ReactNode;
  /** The read-only inherited tutor — needs the page's classId, so it's passed
   *  in rather than resolved here. */
  tutorSlot?: ReactNode;
  /** Actions row (Create / Save), rendered under the config column. */
  footer: ReactNode;
  /** Optional error/alert node rendered above the footer. */
  error?: ReactNode;
}

/**
 * The activity-builder workspace, shared by the create and edit pages (1.1.40
 * M1) so they can't drift. Two columns on wide screens: four colour-coded
 * config sections on the left, the live student preview pinned beside them on
 * the right. Both pages feed it the same `useActivityBuilder` state.
 */
export function ActivityBuilderBody({
  builder,
  templateSlot,
  activityId,
  classControl,
  tutorSlot,
  footer,
  error,
}: ActivityBuilderBodyProps) {
  const t = useT("ActivityBuilderBody");
  const b = builder;
  const hints = collectBuilderHints(b);
  // CONCEPT-2 M3 — "Foreslå begrebskort" asks the page's co-pilot for a draft.
  // `useCopilotEntry` is null outside the teacher shell and `ask` returns false
  // when no work co-pilot is mounted, so the button only appears where it can
  // actually do something. The co-pilot already receives the builder's draft as
  // hidden context, so the request needs no arguments.
  const entry = useCopilotEntry();
  const proposeConceptMap = entry?.registered
    ? () => {
        // Sent as the teacher's own turn, so it is in the teacher's language.
        entry.ask(t("proposeConceptMap"));
      }
    : undefined;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,46rem)_minmax(0,1fr)]">
      {/* LEFT — configuration, grouped into four colour-coded sections. */}
      <div className="flex min-w-0 flex-col gap-4">
        {templateSlot}
        <BuilderSectionNav
          counts={{
            [SECTION.workspace.id]: b.workspaceCount,
            [SECTION.materials.id]: b.materials.length,
          }}
        />

        <BuilderSection section={SECTION.setup}>
          {/* 1.1.151 F2b — the students' language sits NEXT TO the title: two
              activities of a Danish class ran an English tutor because this
              field sat lower down and nobody saw its value. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <Field label={t("name")} htmlFor="activity-title">
                <input
                  id="activity-title"
                  type="text"
                  value={b.title}
                  onChange={(e) => b.setTitle(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  maxLength={200}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </Field>
            </div>
            {/* The STUDENTS' language (data on the activity) — not the teacher's own
                DA | EN setting, which only changes this screen (1.1.108). */}
            <div className="sm:w-44">
              <Field label={t("language")} htmlFor="activity-language">
                <select
                  id="activity-language"
                  value={b.language}
                  onChange={(e) => b.setLanguage(e.target.value as ActivityBuilder["language"])}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="da">Dansk</option>
                  <option value="en">English</option>
                </select>
              </Field>
            </div>
          </div>
          <span className="-mt-2 text-xs text-slate-500">{t("languageHelp")}</span>

          {classControl}

          {/* The tutor is class-default-only (1.1.32 Q4): chosen once in class
              settings, inherited by every activity. Shown read-only here so the
              teacher knows which tutor teaches this + where to change it. */}
          {tutorSlot}
        </BuilderSection>

        <BuilderSection section={SECTION.lesson}>
          <Field label={t("goal")} htmlFor="activity-goal">
            <textarea
              id="activity-goal"
              value={b.teachingGoal}
              onChange={(e) => b.setTeachingGoal(e.target.value)}
              placeholder={t("goalPlaceholder")}
              rows={6}
              maxLength={2000}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <p className="text-xs text-slate-500">
            {t("goalHelp")}
          </p>
        </BuilderSection>

        <BuilderSection section={SECTION.workspace}>
          <p className="flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {t("workspaceIntro")}
            </span>
          </p>

          <SimPicker value={b.artefactId} onChange={b.setArtefactId} />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{t("checklist")}</span>
              <button
                type="button"
                onClick={b.addChecklistItem}
                className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" /> {t("addStep")}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {t("checklistHelp")}
            </p>
            {b.checklist.length === 0 ? (
              <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                {t("noChecklist")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {b.checklist.map((item, idx) => (
                  <li key={item.key} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-slate-400">{idx + 1}.</span>
                    <input
                      type="text"
                      aria-label={t("stepAria", { n: idx + 1 })}
                      value={item.label}
                      onChange={(e) => b.setChecklistLabel(item.key, e.target.value)}
                      placeholder={t("stepPlaceholder")}
                      maxLength={200}
                      className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => b.removeChecklistItem(item.key)}
                      aria-label={t("removeStep", { n: idx + 1 })}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <TableEditor value={b.table} onChange={b.setTable} nextKey={b.nextElementKey} />

          <ChartEditor value={b.chart} onChange={b.setChart} tables={b.table} />

          <CalculatorEditor value={b.calculator} onChange={b.setCalculator} />

          <NoteEditor value={b.note} onChange={b.setNote} />
          <WritingEditor value={b.writing} onChange={b.setWriting} nextKey={b.nextElementKey} />

          <SolutionEditor value={b.solution} onChange={b.setSolution} />

          <DocumentEditor value={b.document} onChange={b.setDocument} />

          {CONCEPT_MAP_ENABLED && (
            <ConceptMapEditor
              value={b.conceptMap}
              onChange={b.setConceptMap}
              nextKey={b.nextElementKey}
              onPropose={proposeConceptMap}
            />
          )}
        </BuilderSection>

        <BuilderSection section={SECTION.materials}>
          <MaterialsSection materials={b.materials} onChange={b.setMaterials} activityId={activityId} />
        </BuilderSection>

        {/* 1.1.151 — soft hints beside save; never blocking. */}
        <BuilderHints hints={hints} />
        {error}
        {footer}
      </div>

      {/* RIGHT — the live student preview, pinned beside the config on wide
          screens (1.1.40 M2) so the result is never hidden. */}
      <div className="lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
        <ActivityPreview
          artefactId={b.artefactId}
          language={b.language}
          materials={b.materials}
          activityId={activityId}
          state={{
            checklist: b.checklist,
            table: b.table,
            chart: b.chart,
            calculator: b.calculator,
            note: b.note,
            writing: b.writing,
            solution: b.solution,
            document: b.document,
            conceptMap: b.conceptMap,
          }}
        />
      </div>
    </div>
  );
}

/** Every hint the builder's current state earns (1.1.151). */
function collectBuilderHints(b: ActivityBuilder): BuilderHint[] {
  const labels = [
    ...b.table.flatMap((tbl) => [tbl.title, ...tbl.columns.map((c) => c.label)]),
    ...b.checklist.map((c) => c.label),
    ...b.writing.map((w) => w.title),
  ].filter((s): s is string => typeof s === "string" && s.trim() !== "");
  const hints: BuilderHint[] = [];
  const lang = languageHint({ language: b.language, title: b.title, teachingGoal: b.teachingGoal, labels });
  if (lang) hints.push(lang);
  // 1.1.151 F9 — duplicate column labels, untitled tables among several.
  hints.push(...tableHints(b.table));
  return hints;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
