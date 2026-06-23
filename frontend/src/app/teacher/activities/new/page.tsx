"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, MessageCircle, Plus, Save, Sparkles, X } from "lucide-react";

import {
  type ClassPayload,
  type Language,
  type MaterialRef,
  listAccessibleSkills,
  listClasses,
  patchLessons,
  saveActivityConfig,
} from "@/lib/teacherApi";
import { ActivityPreview } from "@/components/teacher/ActivityPreview";
import { builderToElementDefs } from "@/lib/activityPreview";
import { MaterialsSection } from "@/components/teacher/MaterialsSection";
import { SettingsMap } from "@/components/teacher/SettingsMap";
import { InheritedPersona } from "@/components/teacher/InheritedPersona";
import { TableEditor, type TableEditorValue } from "@/components/teacher/TableEditor";
import { ChartEditor, type ChartEditorValue } from "@/components/teacher/ChartEditor";
import { CalculatorEditor, type CalculatorEditorValue } from "@/components/teacher/CalculatorEditor";
import { NoteEditor, type NoteEditorValue } from "@/components/teacher/NoteEditor";
import { TemplatePicker } from "@/components/teacher/TemplatePicker";
import { type ActivityTemplate } from "@/lib/activityTemplates";

// TAA-1 M0: a from-scratch activity runs the `concept-dialogue` base
// skill (chat-only Socratic tutor). The teacher's title + lesson prompt
// become the activity's identity + injected {teacher_focus}. Minting a
// distinct id per activity is M3 (decouple); M0 binds to the base skill
// so the activity is immediately student-runnable.
//
// NOTE: platform skills are keyed by a per-environment UUID skill_id, NOT
// by name — so we resolve the real skill_id from the catalogue at runtime
// and use it for BOTH the activity-config activityId AND the lesson
// binding. Passing the name 404s the lessons PATCH (get_skill(name)->None).
const CONCEPT_SKILL_NAME = "concept-dialogue";

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "da", label: "Dansk" },
  { value: "en", label: "English" },
];
const GOAL_PLACEHOLDER =
  "e.g. Guide students to discover why the horizontal and vertical components of projectile motion are independent — without giving the answer.";

// Tutor interaction style (1.1.20). Socratic is the untouched default; the
// others change the tutor's voice for this activity (AR confirms wording).

type ClassesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "no-skill" } // concept-dialogue base skill not seeded in this env
  | { status: "empty" }
  | { status: "ready"; classes: ClassPayload[]; conceptSkillId: string };

// Wrapped in Suspense because the form reads useSearchParams() — Next.js
// requires a Suspense boundary for that during static prerender.
export default function NewActivityPage() {
  return (
    <Suspense fallback={<div className="px-1 py-6 text-sm text-slate-500">Loading…</div>}>
      <NewActivityForm />
    </Suspense>
  );
}

function NewActivityForm() {
  const router = useRouter();
  // Pre-select the class the teacher came from (the "New activity" button on
  // the class-detail page passes ?classId=…).
  const preferredClassId = useSearchParams().get("classId");

  const [classesState, setClassesState] = useState<ClassesState>({ status: "loading" });
  const [classId, setClassId] = useState("");
  const [title, setTitle] = useState("");
  const [teachingGoal, setTeachingGoal] = useState("");
  const [language, setLanguage] = useState<Language>("da");
  // Persona is class-default-only (1.1.32 Q4): set in class settings, inherited
  // by every activity. The form shows it read-only (InheritedPersona) and does
  // not write persona / interaction_style — leaving them unset lets the backend
  // resolve the class default (avatar + name + voice + style together).
  // Optional teacher-authored checklist. `key` is a stable client id for
  // React; the persisted item id is positional, assigned on save.
  const [checklist, setChecklist] = useState<{ key: number; label: string }[]>([]);
  // Curriculum materials (1.1.25): documents the tutor grounds this activity in.
  // Teachers browse/cite the A/B/C library or upload their own here at creation.
  const [materials, setMaterials] = useState<MaterialRef[]>([]);
  const nextKeyRef = useRef(1);
  const addChecklistItem = () => setChecklist((cur) => [...cur, { key: nextKeyRef.current++, label: "" }]);
  const removeChecklistItem = (key: number) => setChecklist((cur) => cur.filter((i) => i.key !== key));
  const setChecklistLabel = (key: number, label: string) =>
    setChecklist((cur) => cur.map((i) => (i.key === key ? { ...i, label } : i)));
  // Optional teacher-defined data table (1.1.38 M1). `null` = no table.
  const [table, setTable] = useState<TableEditorValue | null>(null);
  // Optional chart that plots the data table (1.1.38 M2). `null` = no chart.
  const [chart, setChart] = useState<ChartEditorValue | null>(null);
  // Optional formula calculator (1.1.38 M3). `null` = no calculator.
  const [calculator, setCalculator] = useState<CalculatorEditorValue | null>(null);
  // Optional instructions / reference note (1.1.38 M4). `null` = no note.
  const [note, setNote] = useState<NoteEditorValue | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedClassName, setSavedClassName] = useState<string | null>(null);
  // Deep link into the real edit page for the activity we just created, so
  // the teacher can add curriculum materials / refine the goal immediately.
  const [savedActivityHref, setSavedActivityHref] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([listClasses(), listAccessibleSkills()])
      .then(([classes, skills]) => {
        if (!alive) return;
        // Resolve the base skill's real (per-env) UUID — never the name.
        const concept = skills.find((s) => s.name === CONCEPT_SKILL_NAME);
        if (!concept) {
          setClassesState({ status: "no-skill" });
          return;
        }
        if (classes.length === 0) {
          setClassesState({ status: "empty" });
          return;
        }
        setClassesState({ status: "ready", classes, conceptSkillId: concept.skillId });
        const preferred = classes.find((c) => c.classId === preferredClassId);
        setClassId(preferred?.classId ?? classes[0].classId);
      })
      .catch(() => {
        if (alive) setClassesState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [preferredClassId]);

  // Apply a starter template (1.1.38 follow-up): pre-fill every builder field
  // from the template, converting to the editor value shapes (client `key`s
  // allocated from the shared counter). The teacher edits everything after.
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
  }

  const canSubmit = title.trim().length > 0 && teachingGoal.trim().length > 0 && classId.length > 0 && !isSaving;

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSubmit || classesState.status !== "ready") return;
    const conceptSkillId = classesState.conceptSkillId;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveActivityConfig({
        activityId: conceptSkillId,
        classId,
        title: title.trim(),
        teachingGoal: teachingGoal.trim(),
        language,
        // Same converter the live preview uses, so preview === saved activity.
        ...builderToElementDefs({ checklist, table, chart, calculator, note }),
        materials,
      });
      // Bind the concept-dialogue lesson to the class so students in it
      // actually see the activity. Idempotent — adding it again is a no-op.
      // Without this, a class with a lesson allowlist filters it out
      // (see frontend/src/app/lessons/page.tsx). Must use the real skill_id
      // (UUID), not the name, or the lessons PATCH 404s.
      await patchLessons(classId, { add: [conceptSkillId] });
      const cls = classesState.classes.find((c) => c.classId === classId);
      setSavedClassName(cls?.name ?? classId);
      setSavedActivityHref(
        `/teacher/activities/${encodeURIComponent(conceptSkillId)}?classId=${encodeURIComponent(classId)}&title=${encodeURIComponent(title.trim())}`,
      );
    } catch (err) {
      console.error("[teacher-ui] create activity failed:", err);
      setSaveError("Could not create the activity — your changes were not saved. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => router.push("/teacher/classes")}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to classes
        </button>
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <Sparkles className="h-6 w-6 text-primary" /> New activity
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a chat-only Socratic concept activity. Students join with a group code and explore the
          topic in dialogue — no simulator required.
        </p>
      </div>

      {savedClassName ? (
        <SuccessPanel
          className={savedClassName}
          title={title.trim()}
          configureHref={savedActivityHref}
          onAnother={() => {
            setSavedClassName(null);
            setSavedActivityHref(null);
            setTitle("");
            setTeachingGoal("");
          }}
        />
      ) : classesState.status === "loading" ? (
        <PanelMessage>
          <span className="animate-pulse">Loading your classes…</span>
        </PanelMessage>
      ) : classesState.status === "error" ? (
        <PanelMessage tone="error">
          Could not load your classes. Refresh the page to try again.
        </PanelMessage>
      ) : classesState.status === "no-skill" ? (
        <PanelMessage tone="error">
          The concept-dialogue tutor isn&apos;t available in this environment yet. It needs to be seeded by
          an admin (<code>scripts/seed-platform-skills.sh</code>) before concept activities can be created.
        </PanelMessage>
      ) : classesState.status === "empty" ? (
        <PanelMessage>
          You don&apos;t have a class yet. {""}
          <Link href="/teacher/classes" className="font-medium text-indigo-600 hover:underline">
            Create a class first
          </Link>{" "}
          — an activity belongs to a class.
        </PanelMessage>
      ) : (
        <form onSubmit={handleSave} className="flex max-w-2xl flex-col gap-5">
          <SettingsMap highlight="activity" classId={classId} />
          <TemplatePicker onPick={applyTemplate} />
          <Field label="Activity name" htmlFor="activity-title">
            <input
              id="activity-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Energibevarelse — gruppe 7B"
              maxLength={200}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          <Field label="Class" htmlFor="activity-class">
            <select
              id="activity-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {classesState.classes.map((c) => (
                <option key={c.classId} value={c.classId}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <p className="flex items-start gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This creates a chat-only concept activity (plus any checklist and
              materials below). The Boldkast, LED&nbsp;Planck and KineBot
              simulators are their own activities — a simulator is the tutor it
              runs, not a setting you attach here.
            </span>
          </p>

          <Field label="Lesson prompt (Socratic teaching goal)" htmlFor="activity-goal">
            <textarea
              id="activity-goal"
              value={teachingGoal}
              onChange={(e) => setTeachingGoal(e.target.value)}
              placeholder={GOAL_PLACEHOLDER}
              rows={5}
              maxLength={2000}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </Field>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Checklist (optional)</span>
              <button
                type="button"
                onClick={addChecklistItem}
                className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add step
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Sub-steps students tick off as they work. Shown in the workspace; the tutor can see what&apos;s
              done.
            </p>
            {checklist.length === 0 ? (
              <p className="rounded border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                No checklist — the activity is a free Socratic dialogue. Add steps to give students a visible
                structure.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {checklist.map((item, idx) => (
                  <li key={item.key} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-slate-400">{idx + 1}.</span>
                    <input
                      type="text"
                      aria-label={`Checklist step ${idx + 1}`}
                      value={item.label}
                      onChange={(e) => setChecklistLabel(item.key, e.target.value)}
                      placeholder="e.g. Identify the system"
                      maxLength={200}
                      className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(item.key)}
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

          <TableEditor value={table} onChange={setTable} />

          <ChartEditor
            value={chart}
            onChange={setChart}
            hasTable={!!table && table.columns.filter((c) => c.kind === "number" && c.label.trim()).length >= 2}
          />

          <CalculatorEditor value={calculator} onChange={setCalculator} />

          <NoteEditor value={note} onChange={setNote} />

          <MaterialsSection materials={materials} onChange={setMaterials} />

          <div className="flex gap-4">
            <Field label="Language" htmlFor="activity-language">
              <select
                id="activity-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {LANGUAGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Persona is class-default-only (1.1.32 Q4): set once in class
              settings, inherited by every activity. Shown read-only here so
              the teacher knows which tutor + where to change it — no duplicate
              per-activity picker. */}
          <InheritedPersona classId={classId} />

          <ActivityPreview state={{ checklist, table, chart, calculator, note }} />

          {saveError ? (
            <p role="alert" className="text-sm text-red-600">
              {saveError}
            </p>
          ) : null}

          <div>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Creating…" : "Create activity"}
            </button>
          </div>
        </form>
      )}
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
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function PanelMessage({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "error";
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-6 text-sm ${
        tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      {children}
    </div>
  );
}

function SuccessPanel({
  className,
  title,
  configureHref,
  onAnother,
}: {
  className: string;
  title: string;
  configureHref: string | null;
  onAnother: () => void;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-6">
      <p className="text-sm font-medium text-green-800">
        Activity “{title}” is live for <span className="font-semibold">{className}</span>.
      </p>
      <p className="text-sm text-green-700">
        Students who join this class&apos;s group code can now open the concept dialogue and explore the topic
        you set. Want to ground it in curriculum materials? Configure it next.
      </p>
      <div className="flex flex-wrap gap-3">
        {configureHref ? (
          <Link
            href={configureHref}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
          >
            Configure &amp; add materials
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onAnother}
          className="rounded-md border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          Create another
        </button>
        <Link
          href="/teacher/classes"
          className="rounded-md border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          Back to classes
        </Link>
      </div>
    </div>
  );
}
