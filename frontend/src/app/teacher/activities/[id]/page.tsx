"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Eye,
  Save,
} from "lucide-react";

import {
  MOCK_DEFAULT_CLASS_ID,
  getMockActivityConfig,
  getMockClass,
} from "../../_mock-data";
import {
  NotFoundError,
  fetchMyActivityConfig,
  saveActivityConfig,
} from "@/lib/teacherApi";

const LANGUAGE_OPTIONS = [
  { value: "da", label: "Dansk" },
  { value: "en", label: "English" },
];

const DIFFICULTY_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "guided", label: "Guided" },
];

const WORKBENCH_NONE = "none";
const WORKBENCH_BOLDKAST = "boldkast-simulator-v1";

export default function TeacherActivityConfigPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const maybeConfig = getMockActivityConfig(id);
  if (!maybeConfig) {
    notFound();
  }
  const config = maybeConfig as NonNullable<typeof maybeConfig>;

  const parentClass = useMemo(
    () => getMockClass(config.classId) ?? getMockClass(MOCK_DEFAULT_CLASS_ID),
    [config.classId],
  );

  const [teachingGoal, setTeachingGoal] = useState(config.defaultTeachingGoal);
  const [language, setLanguage] = useState<"da" | "en">(config.language);
  const [difficulty, setDifficulty] = useState<"standard" | "guided">(
    config.difficulty,
  );
  const [pairedWorkbench, setPairedWorkbench] = useState<string>(
    config.pairedWorkbench ?? WORKBENCH_NONE,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load the teacher's saved config (if any) on mount. 404 = use the
  // mock defaults already loaded into state — Phase 2 onboards first-
  // time teachers with no prior config without an error toast.
  useEffect(() => {
    let alive = true;
    fetchMyActivityConfig(config.classId, config.id)
      .then((saved) => {
        if (!alive) return;
        setTeachingGoal(saved.teachingGoal || config.defaultTeachingGoal);
        setLanguage(saved.language);
        setDifficulty(saved.difficulty);
        setPairedWorkbench(saved.pairedWorkbench ?? WORKBENCH_NONE);
      })
      .catch((err) => {
        if (!alive || err instanceof NotFoundError) {
          return;
        }
        // Network or unexpected error — surface it but keep the form
        // populated with mock defaults so the teacher can still save.
        console.warn("[teacher-ui] activity-config load failed:", err);
      });
    return () => {
      alive = false;
    };
  }, [config.classId, config.id, config.defaultTeachingGoal]);

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    setIsSaving(true);
    try {
      await saveActivityConfig({
        activityId: config.id,
        classId: config.classId,
        teachingGoal,
        language,
        difficulty,
        pairedWorkbench:
          pairedWorkbench === WORKBENCH_NONE ? null : pairedWorkbench,
      });
      setToast("Saved — students see your teaching goal on their next turn");
    } catch (err) {
      console.error("[teacher-ui] activity-config save failed:", err);
      setToast("Save failed — your changes were not stored");
    } finally {
      setIsSaving(false);
      window.setTimeout(() => setToast(null), 4000);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {parentClass ? (
          <>
            <Link
              href={`/teacher/classes/${parentClass.id}`}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {parentClass.name}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <span className="text-foreground">Configure: {config.name}</span>
      </nav>

      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">
          Configure {config.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          Teachers don&apos;t write system prompts — write a teaching intention.
          The tutor handles the Socratic scaffolding.
        </p>
      </header>

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-2">
          <label
            htmlFor="teaching-goal"
            className="text-sm font-medium"
          >
            Teaching goal
          </label>
          <textarea
            id="teaching-goal"
            value={teachingGoal}
            onChange={(e) => setTeachingGoal(e.target.value)}
            rows={6}
            maxLength={1000}
            className="rounded border border-border bg-background px-3 py-2 text-sm leading-relaxed"
            placeholder="What do you want students to discover in this session?"
          />
          <p className="text-xs text-muted-foreground">{config.helperText}</p>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Paired workbench</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="workbench"
                value={WORKBENCH_BOLDKAST}
                checked={pairedWorkbench === WORKBENCH_BOLDKAST}
                onChange={() => setPairedWorkbench(WORKBENCH_BOLDKAST)}
              />
              Boldkast simulator
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="workbench"
                value={WORKBENCH_NONE}
                checked={pairedWorkbench === WORKBENCH_NONE}
                onChange={() => setPairedWorkbench(WORKBENCH_NONE)}
              />
              None (chat only)
            </label>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "da" | "en")}
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Difficulty
            <select
              value={difficulty}
              onChange={(e) =>
                setDifficulty(e.target.value as "standard" | "guided")
              }
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              {DIFFICULTY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            title="Preview lands in Phase 3"
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            Preview as student
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {isSaving ? "Saving…" : "Save configuration"}
          </button>
        </div>
      </form>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 text-sm"
      >
        {toast ? (
          <div className="pointer-events-auto rounded border border-border bg-background px-4 py-2 shadow-md">
            {toast}
          </div>
        ) : null}
      </div>
    </div>
  );
}
