"use client";

import { MessageCircle, Plus, X } from "lucide-react";
import type { ReactNode } from "react";

import { ActivityPreview } from "@/components/teacher/ActivityPreview";
import { BuilderSection, BuilderSectionNav, SECTION } from "@/components/teacher/BuilderLayout";
import { CalculatorEditor } from "@/components/teacher/CalculatorEditor";
import { ChartEditor } from "@/components/teacher/ChartEditor";
import { ConceptMapEditor } from "@/components/teacher/ConceptMapEditor";
import { DocumentEditor } from "@/components/teacher/DocumentEditor";
import { MaterialsSection } from "@/components/teacher/MaterialsSection";
import { NoteEditor } from "@/components/teacher/NoteEditor";
import { SimPicker } from "@/components/teacher/SimPicker";
import { SolutionEditor } from "@/components/teacher/SolutionEditor";
import { TableEditor } from "@/components/teacher/TableEditor";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";

// Living concept map (CONCEPT-1 M1) — dark-flagged like the authoring co-pilot;
// bakes at build time (cloudbuild `_CONCEPT_MAP`), on for dev.
const CONCEPT_MAP_ENABLED = process.env.NEXT_PUBLIC_CONCEPT_MAP === "1";

interface ActivityBuilderBodyProps {
  builder: ActivityBuilder;
  /** The activity id, threaded to the Materials section so image uploads can be
   *  attached to the activity slot (1.1.44). Edit page: route param; create
   *  page: the resolved concept skill id. */
  activityId?: string;
  /** The class control for the Setup section — a `<select>` on the create page,
   *  a read-only line on the edit page (class is fixed once an activity exists). */
  classControl?: ReactNode;
  /** The read-only inherited persona — needs the page's classId, so it's passed
   *  in rather than resolved here. */
  personaSlot?: ReactNode;
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
  activityId,
  classControl,
  personaSlot,
  footer,
  error,
}: ActivityBuilderBodyProps) {
  const b = builder;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,46rem)_minmax(0,1fr)]">
      {/* LEFT — configuration, grouped into four colour-coded sections. */}
      <div className="flex min-w-0 flex-col gap-4">
        <BuilderSectionNav
          counts={{
            [SECTION.workspace.id]: b.workspaceCount,
            [SECTION.materials.id]: b.materials.length,
          }}
        />

        <BuilderSection section={SECTION.setup}>
          <Field label="Activity name" htmlFor="activity-title">
            <input
              id="activity-title"
              type="text"
              value={b.title}
              onChange={(e) => b.setTitle(e.target.value)}
              placeholder="e.g. Energibevarelse — gruppe 7B"
              maxLength={200}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          {classControl}

          <Field label="Language" htmlFor="activity-language">
            <select
              id="activity-language"
              value={b.language}
              onChange={(e) => b.setLanguage(e.target.value as ActivityBuilder["language"])}
              className="w-fit rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="da">Dansk</option>
              <option value="en">English</option>
            </select>
          </Field>

          {/* Persona is class-default-only (1.1.32 Q4): set once in class
              settings, inherited by every activity. Shown read-only here so the
              teacher knows which tutor + where to change it. */}
          {personaSlot}
        </BuilderSection>

        <BuilderSection section={SECTION.lesson}>
          <Field label="Lesson prompt (Socratic teaching goal)" htmlFor="activity-goal">
            <textarea
              id="activity-goal"
              value={b.teachingGoal}
              onChange={(e) => b.setTeachingGoal(e.target.value)}
              placeholder="e.g. Guide students to discover why the horizontal and vertical components of projectile motion are independent — without giving the answer."
              rows={6}
              maxLength={2000}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>
          <p className="text-xs text-slate-500">
            This shapes how the tutor guides — it never gives the answer away. Write the goal, not the
            solution.
          </p>
        </BuilderSection>

        <BuilderSection section={SECTION.workspace}>
          <p className="flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Optionally host a vetted simulation — the same sim can power many activities with
              different goals — or keep it chat-only. Add a checklist, data table, chart, calculator,
              or note to structure the student&apos;s work.
            </span>
          </p>

          <SimPicker value={b.artefactId} onChange={b.setArtefactId} />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Checklist (optional)</span>
              <button
                type="button"
                onClick={b.addChecklistItem}
                className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add step
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Sub-steps students tick off as they work. Shown in the workspace; the tutor can see
              what&apos;s done.
            </p>
            {b.checklist.length === 0 ? (
              <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                No checklist — the activity is a free Socratic dialogue. Add steps to give students a
                visible structure.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {b.checklist.map((item, idx) => (
                  <li key={item.key} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-slate-400">{idx + 1}.</span>
                    <input
                      type="text"
                      aria-label={`Checklist step ${idx + 1}`}
                      value={item.label}
                      onChange={(e) => b.setChecklistLabel(item.key, e.target.value)}
                      placeholder="e.g. Identify the system"
                      maxLength={200}
                      className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => b.removeChecklistItem(item.key)}
                      aria-label={`Remove step ${idx + 1}`}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <TableEditor value={b.table} onChange={b.setTable} />

          <ChartEditor
            value={b.chart}
            onChange={b.setChart}
            hasTable={
              !!b.table &&
              b.table.columns.filter((c) => c.kind === "number" && c.label.trim()).length >= 2
            }
          />

          <CalculatorEditor value={b.calculator} onChange={b.setCalculator} />

          <NoteEditor value={b.note} onChange={b.setNote} />

          <SolutionEditor value={b.solution} onChange={b.setSolution} />

          <DocumentEditor value={b.document} onChange={b.setDocument} />

          {CONCEPT_MAP_ENABLED && (
            <ConceptMapEditor value={b.conceptMap} onChange={b.setConceptMap} nextKey={b.nextElementKey} />
          )}
        </BuilderSection>

        <BuilderSection section={SECTION.materials}>
          <MaterialsSection materials={b.materials} onChange={b.setMaterials} activityId={activityId} />
        </BuilderSection>

        {error}
        {footer}
      </div>

      {/* RIGHT — the live student preview, pinned beside the config on wide
          screens (1.1.40 M2) so the result is never hidden. */}
      <div className="lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
        <ActivityPreview
          artefactId={b.artefactId}
          materials={b.materials}
          activityId={activityId}
          state={{
            checklist: b.checklist,
            table: b.table,
            chart: b.chart,
            calculator: b.calculator,
            note: b.note,
            solution: b.solution,
            document: b.document,
            conceptMap: b.conceptMap,
          }}
        />
      </div>
    </div>
  );
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
