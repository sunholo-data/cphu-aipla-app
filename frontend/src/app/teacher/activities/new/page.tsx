"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, MessageCircle, Save, Sparkles } from "lucide-react";

import {
  type ClassPayload,
  type Difficulty,
  type Language,
  type WorkbenchType,
  listClasses,
  patchLessons,
  saveActivityConfig,
} from "@/lib/teacherApi";

// TAA-1 M0: a from-scratch activity runs the `concept-dialogue` base
// skill (chat-only Socratic tutor). The teacher's title + lesson prompt
// become the activity's identity + injected {teacher_focus}. Minting a
// distinct id per activity is M3 (decouple); M0 binds to the base skill
// so the activity is immediately student-runnable.
const CONCEPT_SKILL_ID = "concept-dialogue";

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: "da", label: "Dansk" },
  { value: "en", label: "English" },
];
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "guided", label: "Guided" },
];
// M0 ships the no-workbench (concept) type. Other types are declared so
// the picker signals direction-of-travel, but are disabled until M4.
const WORKBENCH_OPTIONS: { value: WorkbenchType; label: string; enabled: boolean }[] = [
  { value: "none", label: "None — chat-only concept dialogue", enabled: true },
  { value: "notebook", label: "Lab notebook (coming soon)", enabled: false },
  { value: "drawing", label: "Drawing board (coming soon)", enabled: false },
  { value: "app", label: "Simulator (paired sim)", enabled: false },
];

const GOAL_PLACEHOLDER =
  "e.g. Guide students to discover why the horizontal and vertical components of projectile motion are independent — without giving the answer.";

type ClassesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "empty" }
  | { status: "ready"; classes: ClassPayload[] };

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
  const [difficulty, setDifficulty] = useState<Difficulty>("standard");
  // First-run default: the concept (no-workbench) path is pre-selected so
  // the happy path to a working activity is the default, not a blank form.
  const [workbenchType] = useState<WorkbenchType>("none");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedClassName, setSavedClassName] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listClasses()
      .then((classes) => {
        if (!alive) return;
        if (classes.length === 0) {
          setClassesState({ status: "empty" });
          return;
        }
        setClassesState({ status: "ready", classes });
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

  const canSubmit = title.trim().length > 0 && teachingGoal.trim().length > 0 && classId.length > 0 && !isSaving;

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSubmit) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveActivityConfig({
        activityId: CONCEPT_SKILL_ID,
        classId,
        title: title.trim(),
        teachingGoal: teachingGoal.trim(),
        language,
        difficulty,
        pairedWorkbench: null,
        workbenchType,
      });
      // Bind the concept-dialogue lesson to the class so students in it
      // actually see the activity. Idempotent — adding it again is a no-op.
      // Without this, a class with a lesson allowlist filters it out
      // (see frontend/src/app/lessons/page.tsx).
      await patchLessons(classId, { add: [CONCEPT_SKILL_ID] });
      const cls =
        classesState.status === "ready"
          ? classesState.classes.find((c) => c.classId === classId)
          : undefined;
      setSavedClassName(cls?.name ?? classId);
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
          className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Back to classes
        </button>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900">
          <Sparkles className="h-6 w-6 text-indigo-500" /> New activity
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a chat-only Socratic concept activity. Students join with a group code and explore the
          topic in dialogue — no simulator required.
        </p>
      </div>

      {savedClassName ? (
        <SuccessPanel
          className={savedClassName}
          title={title.trim()}
          onAnother={() => {
            setSavedClassName(null);
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

          <Field label="Workbench" htmlFor="activity-workbench">
            <select
              id="activity-workbench"
              value={workbenchType}
              disabled
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
            >
              {WORKBENCH_OPTIONS.map((w) => (
                <option key={w.value} value={w.value} disabled={!w.enabled}>
                  {w.label}
                </option>
              ))}
            </select>
            <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
              <MessageCircle className="h-3.5 w-3.5" /> Chat-only for now — other workbench types arrive in a
              later release.
            </p>
          </Field>

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
            <Field label="Difficulty" htmlFor="activity-difficulty">
              <select
                id="activity-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {DIFFICULTY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

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
  onAnother,
}: {
  className: string;
  title: string;
  onAnother: () => void;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-6">
      <p className="text-sm font-medium text-green-800">
        Activity “{title}” is live for <span className="font-semibold">{className}</span>.
      </p>
      <p className="text-sm text-green-700">
        Students who join this class&apos;s group code can now open the concept dialogue and explore the topic
        you set.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onAnother}
          className="rounded-md border border-green-300 bg-white px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100"
        >
          Create another
        </button>
        <Link
          href="/teacher/classes"
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          Back to classes
        </Link>
      </div>
    </div>
  );
}
