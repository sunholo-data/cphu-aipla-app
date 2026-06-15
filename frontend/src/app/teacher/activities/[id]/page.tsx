"use client";

import Link from "next/link";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Code2,
  Eye,
  History,
  Loader2,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";

import {
  MOCK_DEFAULT_CLASS_ID,
  getMockActivityConfig,
  getMockClass,
} from "../../_mock-data";
import {
  type MaterialRef,
  NotFoundError,
  fetchMyActivityConfig,
  saveActivityConfig,
} from "@/lib/teacherApi";
import { MaterialsSection } from "@/components/teacher/MaterialsSection";

type TabId = "goal" | "parameters" | "code" | "history";

type TabDescriptor = {
  id: TabId;
  label: string;
  icon: typeof Target;
  status: "active" | "v1.1" | "v2";
};

const TABS: TabDescriptor[] = [
  { id: "goal", label: "Teaching goal", icon: Target, status: "active" },
  { id: "parameters", label: "Parameters", icon: Sliders, status: "v1.1" },
  { id: "code", label: "Code", icon: Code2, status: "v2" },
  { id: "history", label: "History", icon: History, status: "v2" },
];

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

// Real-mode helper text — shown when the activity is loaded from the live
// /api/activity-configs endpoint (no per-activity mock flavour text).
const GENERIC_HELPER =
  "Describe what you want students to discover. The tutor turns this into Socratic scaffolding — you never write the prompt yourself.";

type LoadState = "loading" | "ready" | "error";

export default function TeacherActivityConfigPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const activityId = typeof params?.id === "string" ? params.id : "";

  // Real mode whenever a classId is supplied in the URL — all production
  // navigation (activities list, new→edit redirect) passes it. Without a
  // classId we fall back to the legacy mock wireframe path keyed by a known
  // mock activity id (LOCAL_MODE / Phase-2 demos), which 404s for unknown ids.
  const classIdParam = searchParams.get("classId") ?? "";
  const titleParam = searchParams.get("title") ?? "";
  const isRealMode = classIdParam.length > 0;

  const mockConfig = isRealMode ? undefined : getMockActivityConfig(activityId);
  if (!isRealMode && !mockConfig) {
    notFound();
  }

  const classId = isRealMode ? classIdParam : mockConfig!.classId;
  const helperText = isRealMode ? GENERIC_HELPER : mockConfig!.helperText;

  const parentClass = useMemo(
    () =>
      isRealMode
        ? undefined
        : getMockClass(mockConfig!.classId) ??
          getMockClass(MOCK_DEFAULT_CLASS_ID),
    [isRealMode, mockConfig],
  );

  const [displayName, setDisplayName] = useState(
    isRealMode ? titleParam || "Activity" : mockConfig!.name,
  );
  const [teachingGoal, setTeachingGoal] = useState(
    isRealMode ? "" : mockConfig!.defaultTeachingGoal,
  );
  const [language, setLanguage] = useState<"da" | "en">(
    isRealMode ? "da" : mockConfig!.language,
  );
  const [difficulty, setDifficulty] = useState<"standard" | "guided">(
    isRealMode ? "standard" : mockConfig!.difficulty,
  );
  const [pairedWorkbench, setPairedWorkbench] = useState<string>(
    isRealMode ? WORKBENCH_NONE : mockConfig!.pairedWorkbench ?? WORKBENCH_NONE,
  );
  const [materials, setMaterials] = useState<MaterialRef[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("goal");
  // In real mode we block the form on the network load; in mock mode the
  // wireframe renders immediately from mock defaults (load is a soft override).
  const [loadState, setLoadState] = useState<LoadState>(
    isRealMode ? "loading" : "ready",
  );

  // Load the teacher's saved config. In real mode this IS the data source
  // (404 = a not-yet-saved activity, render an empty form). In mock mode it
  // soft-overrides the mock defaults so a returning teacher sees their work.
  const mockGoalFallback = isRealMode ? "" : mockConfig!.defaultTeachingGoal;
  useEffect(() => {
    let alive = true;
    fetchMyActivityConfig(classId, activityId)
      .then((saved) => {
        if (!alive) return;
        if (saved.title) setDisplayName(saved.title);
        setTeachingGoal(saved.teachingGoal || mockGoalFallback);
        setLanguage(saved.language);
        setDifficulty(saved.difficulty);
        setPairedWorkbench(saved.pairedWorkbench ?? WORKBENCH_NONE);
        setMaterials(saved.materials ?? []);
        setLoadState("ready");
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof NotFoundError) {
          // No saved config yet — fresh activity (or a first-time mock). The
          // scaffold/empty form is already in state; let the teacher save.
          setLoadState("ready");
          return;
        }
        console.warn("[teacher-ui] activity-config load failed:", err);
        // Real mode can't fall back to mock data, so surface the failure.
        // Mock mode keeps the wireframe usable.
        setLoadState(isRealMode ? "error" : "ready");
      });
    return () => {
      alive = false;
    };
  }, [classId, activityId, mockGoalFallback, isRealMode]);

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    setIsSaving(true);
    try {
      await saveActivityConfig({
        activityId,
        classId,
        title: displayName,
        teachingGoal,
        language,
        difficulty,
        pairedWorkbench:
          pairedWorkbench === WORKBENCH_NONE ? null : pairedWorkbench,
        materials,
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

  const breadcrumb = (
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
      ) : (
        <>
          <Link
            href="/teacher/activities"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Activities
          </Link>
          <span aria-hidden="true">/</span>
        </>
      )}
      <span className="text-foreground">Configure: {displayName}</span>
    </nav>
  );

  if (loadState === "loading") {
    return (
      <div className="flex flex-col gap-6">
        {breadcrumb}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading activity…
        </div>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex flex-col gap-6">
        {breadcrumb}
        <div
          role="alert"
          className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Could not load this activity. Refresh to try again, or return to{" "}
            <Link href="/teacher/activities" className="font-medium underline">
              Activities
            </Link>
            .
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {breadcrumb}

      <header>
        <h1 className="text-xl font-semibold sm:text-2xl">
          Configure {displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Teachers don&apos;t write system prompts — write a teaching intention.
          The tutor handles the Socratic scaffolding.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Configuration tabs"
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`tabpanel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-t border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{tab.label}</span>
              {tab.status !== "active" ? (
                <span
                  className="ml-1 rounded border border-dashed border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
                >
                  {tab.status}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeTab === "goal" ? (
        <section
          role="tabpanel"
          id="tabpanel-goal"
          aria-labelledby="tab-goal"
        >
          <form onSubmit={handleSave} className="flex flex-col gap-6">
            <fieldset className="flex flex-col gap-2">
              <label htmlFor="teaching-goal" className="text-sm font-medium">
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
              <p className="text-xs text-muted-foreground">{helperText}</p>
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

            <MaterialsSection materials={materials} onChange={setMaterials} />

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
        </section>
      ) : null}

      {activeTab === "parameters" ? (
        <ParametersTabPreview activityName={displayName} />
      ) : null}

      {activeTab === "code" ? <CodeTabPreview /> : null}

      {activeTab === "history" ? <HistoryTabPreview /> : null}

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

// -----------------------------------------------------------------------------
// Roadmap preview tabs — Parameters / Code / History
// -----------------------------------------------------------------------------
// These are **wireframe stubs** for the feedback loop with M + JB. They signal
// the direction of teacher control over artefacts without committing to the
// final shape. Each block is read-only; nothing here calls the backend.
//
// Replace with real implementations when the matching design docs ship:
//   docs/design/aipla/post-pilot/teacher-artefact-parameters.md   (v1.1)
//   docs/design/aipla/post-pilot/teacher-artefact-authoring.md    (v2 / Year-2)
//
// Until then, the visual purpose is to surface the affordances JB/AR/M can
// react to: "do I want sliders here?", "what does 'edit with AI assist'
// actually mean?", "where would version history feel right?".

function RoadmapBanner({
  version,
  description,
}: {
  version: "v1.1" | "v2";
  description: string;
}) {
  return (
    <div
      role="note"
      aria-label="Roadmap preview"
      className="flex items-start gap-2 rounded border border-dashed border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <span className="font-semibold">Roadmap preview — {version}</span>
        <span className="leading-relaxed opacity-90">{description}</span>
      </div>
    </div>
  );
}

function ParametersTabPreview({ activityName }: { activityName: string }) {
  return (
    <section
      role="tabpanel"
      id="tabpanel-parameters"
      aria-labelledby="tab-parameters"
      className="flex flex-col gap-4 opacity-90"
    >
      <RoadmapBanner
        version="v1.1"
        description="Post-pilot iteration. First-party artefacts expose a schema of bounded parameters teachers can tune without writing code. Schema-validated server-side."
      />

      <div className="flex flex-col gap-4 rounded border border-border bg-background p-4">
        <h2 className="text-sm font-semibold">{activityName} parameters</h2>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Initial angle range (degrees)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={90}
              defaultValue={20}
              disabled
              aria-label="Min angle"
              className="flex-1"
            />
            <span className="font-mono text-xs">20°</span>
            <span aria-hidden="true">–</span>
            <input
              type="range"
              min={0}
              max={90}
              defaultValue={75}
              disabled
              aria-label="Max angle"
              className="flex-1"
            />
            <span className="font-mono text-xs">75°</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled defaultChecked />
            Show velocity vectors during flight
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled defaultChecked={false} />
            Show trajectory trail after launch
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled defaultChecked />
            Allow students to drag launch position
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Trials per round
            <input
              type="number"
              disabled
              defaultValue={5}
              className="w-20 rounded border border-border bg-background px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Artefact labels language
            <select
              disabled
              defaultValue="da"
              className="rounded border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="da">Dansk</option>
              <option value="en">English</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          disabled
          className="w-fit rounded border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
        >
          Save parameters
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Open question for JB/AR: which parameters per artefact? Should
        per-class overrides be allowed, or class-wide only? Should students
        see which parameters their teacher tuned?
      </p>
    </section>
  );
}

function CodeTabPreview() {
  return (
    <section
      role="tabpanel"
      id="tabpanel-code"
      aria-labelledby="tab-code"
      className="flex flex-col gap-4 opacity-90"
    >
      <RoadmapBanner
        version="v2"
        description="Year-2 / post-contract. Teachers edit artefact source (HTML/JS) via AI-assisted authoring backed by the .claude/skills/mcp-app-artefact skill. Draft → CSP + size validators → human review → publish. Per-teacher artefact namespace. The platform helps teachers create content using their own pedagogical skills — not a developer bottleneck for every simulation."
      />

      <div className="flex flex-col gap-3 rounded border border-border bg-background p-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <Code2 className="h-4 w-4" aria-hidden="true" />
            Boldkast artefact source
          </h2>
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            artefacts/boldkast/v1/index.html · 12.4 KB / 200 KB cap
          </span>
        </header>

        <pre className="overflow-x-auto rounded border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
          {`<!doctype html>
<html lang="da">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self'; script-src 'self' 'unsafe-inline'">
  <title>Boldkast</title>
  <style>
    canvas { width: 100%; max-width: 600px; }
    /* ... */
  </style>
</head>
<body>
  <canvas id="sim" width="600" height="400"></canvas>
  <script type="module">
    const canvas = document.getElementById('sim');
    // ... simulation loop ...
  </script>
</body>
</html>`}
        </pre>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground opacity-60"
          >
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            Edit with AI assist
          </button>
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Code2 className="h-4 w-4" aria-hidden="true" />
            Edit raw source
          </button>
          <button
            type="button"
            disabled
            className="flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            Preview as student
          </button>
        </div>

        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            CSP-safe — no external script sources
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            12.4 KB of 200 KB ADR-013 cap (6%)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            No external fetches detected
          </li>
        </ul>
      </div>

      <p className="text-xs text-muted-foreground">
        Open question for M/JB: review queue model (per-class trusted vs full
        institutional review)? Pedagogical-drift control — should research
        cohorts get a canonical pinned version?
      </p>
    </section>
  );
}

function HistoryTabPreview() {
  const versions = [
    {
      v: "v4",
      when: "2026-09-15",
      author: "you",
      summary: "Tuned default angle range to 20°–75°",
      live: true,
    },
    {
      v: "v3",
      when: "2026-09-12",
      author: "you",
      summary: "Added velocity-vector toggle",
      live: false,
    },
    {
      v: "v2",
      when: "2026-08-04",
      author: "M",
      summary: "Localised labels to Danish",
      live: false,
    },
    {
      v: "v1",
      when: "2026-05-25",
      author: "M",
      summary: "Initial Boldkast release",
      live: false,
    },
  ];
  return (
    <section
      role="tabpanel"
      id="tabpanel-history"
      aria-labelledby="tab-history"
      className="flex flex-col gap-4 opacity-90"
    >
      <RoadmapBanner
        version="v2"
        description="Per-teacher version history of artefact and parameter edits. Rollback is one click; the previous version stays available to existing student sessions until they refresh."
      />

      <ol className="flex flex-col divide-y divide-border rounded border border-border bg-background">
        {versions.map((row) => (
          <li
            key={row.v}
            className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {row.v}
                </code>
                <span className="text-xs text-muted-foreground">{row.when}</span>
                <span className="text-xs text-muted-foreground">by {row.author}</span>
                {row.live ? (
                  <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
                    live
                  </span>
                ) : null}
              </div>
              <span className="text-foreground">{row.summary}</span>
            </div>
            <button
              type="button"
              disabled
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Roll back to this
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
