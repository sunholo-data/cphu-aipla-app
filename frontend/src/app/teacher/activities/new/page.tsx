"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, Save, Sparkles } from "lucide-react";

import {
  type ClassPayload,
  listAccessibleSkills,
  listClasses,
  patchLessons,
  saveActivityConfig,
} from "@/lib/teacherApi";
import { SettingsMap } from "@/components/teacher/SettingsMap";
import { InheritedPersona } from "@/components/teacher/InheritedPersona";
import { TemplatePicker } from "@/components/teacher/TemplatePicker";
import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { useActivityBuilder } from "@/hooks/useActivityBuilder";

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

  const builder = useActivityBuilder();
  const [classesState, setClassesState] = useState<ClassesState>({ status: "loading" });
  const [classId, setClassId] = useState("");

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

  const canSubmit =
    builder.title.trim().length > 0 &&
    builder.teachingGoal.trim().length > 0 &&
    classId.length > 0 &&
    !isSaving;

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
        title: builder.title.trim(),
        teachingGoal: builder.teachingGoal.trim(),
        language: builder.language,
        // The shared element + sim slice (same converter the live preview uses,
        // so preview === saved activity).
        ...builder.elementPayload(),
        materials: builder.materials,
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
        `/teacher/activities/${encodeURIComponent(conceptSkillId)}?classId=${encodeURIComponent(classId)}&title=${encodeURIComponent(builder.title.trim())}`,
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
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Build a guided activity: set the lesson, add a workspace (simulation, tables, charts, tools),
          and watch the live preview update as you go. Students join with a group code.
        </p>
      </div>

      {savedClassName ? (
        <SuccessPanel
          className={savedClassName}
          title={builder.title.trim()}
          configureHref={savedActivityHref}
          onAnother={() => {
            setSavedClassName(null);
            setSavedActivityHref(null);
            builder.setTitle("");
            builder.setTeachingGoal("");
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
        <form onSubmit={handleSave} className="flex flex-col gap-5">
          <SettingsMap highlight="activity" classId={classId} />
          <TemplatePicker onPick={builder.applyTemplate} />

          <ActivityBuilderBody
            builder={builder}
            activityId={classesState.conceptSkillId}
            classControl={
              <label htmlFor="activity-class" className="flex flex-col gap-1">
                <span className="text-sm font-medium text-slate-700">Class</span>
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
              </label>
            }
            personaSlot={<InheritedPersona classId={classId} />}
            error={
              saveError ? (
                <p role="alert" className="text-sm text-red-600">
                  {saveError}
                </p>
              ) : null
            }
            footer={
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
            }
          />
        </form>
      )}
    </div>
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
