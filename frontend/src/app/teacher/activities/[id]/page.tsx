"use client";

import Link from "next/link";
import { useToast } from "@/hooks/useToast";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Code2,
  Eye,
  GitBranch,
  History,
  Loader2,
  Save,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";

import {
  NotFoundError,
  fetchActivity,
  fetchMyActivityConfig,
  saveActivityConfig,
  updateActivity,
} from "@/lib/teacherApi";
import type { ActivityPayload } from "@/lib/teacherApi";
import { SettingsMap } from "@/components/teacher/SettingsMap";
import { InheritedPersona } from "@/components/teacher/InheritedPersona";
import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { useActivityBuilder } from "@/hooks/useActivityBuilder";
import { AuthoringCopilot } from "./_AuthoringCopilot";
import { applyCopilotProposal } from "../applyCopilotProposal";

type TabId = "goal" | "parameters" | "code" | "history";

type TabDescriptor = {
  id: TabId;
  label: string;
  icon: typeof Target;
  status: "active" | "v1.1" | "v2";
};

const TABS: TabDescriptor[] = [
  { id: "goal", label: "Teaching goal", icon: Target, status: "active" },
  { id: "code", label: "Code", icon: Code2, status: "v2" },
  // History ships a real read-only provenance + lifecycle panel (M-HIST); the
  // version-timeline + rollback half stays a Year-2 roadmap note inside it.
  { id: "history", label: "History", icon: History, status: "active" },
];

type LoadState = "loading" | "ready" | "error";

export default function TeacherActivityConfigPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const activityId = typeof params?.id === "string" ? params.id : "";

  // The editor is real-only: the activity is loaded from the live
  // /api/activity-configs endpoint, keyed by (classId, activityId). All
  // navigation here (activities list "Configure", new→edit handoff) carries
  // the classId. Arriving without one is an error state, never mock data.
  const classId = searchParams.get("classId") ?? "";
  const titleParam = searchParams.get("title") ?? "";

  // ALS-1 M0: a minted `act-…` id lives in the class-independent Activity store;
  // a legacy skill-id id is still in the per-class activity_configs store (dual-read
  // window). Branch load + save on the prefix so both keep working through cutover.
  const isActivityStore = activityId.startsWith("act-");
  // The running skill of the loaded activity — needed to PATCH it back (the
  // Activity carries its own skill_id; the editor must preserve it).
  const [loadedSkillId, setLoadedSkillId] = useState("");

  // The activity builder — the SAME hook the create page uses, so create and
  // edit render identical config + preview and assemble identical save payloads.
  const builder = useActivityBuilder();
  const displayName = builder.title || titleParam || "Activity";
  const { toast, showToast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("goal");
  // The loaded activity's provenance + lifecycle metadata (visibility, source_*,
  // timestamps), surfaced read-only in the History tab (M-HIST). Null for a
  // not-yet-saved (404) activity — the panel shows a "no history yet" state.
  const [meta, setMeta] = useState<ActivityPayload | null>(null);
  // Block the form on the network load. An act- activity loads by id alone; a
  // legacy config needs the classId, so a missing one is an error there only.
  const [loadState, setLoadState] = useState<LoadState>(
    isActivityStore || classId ? "loading" : "error",
  );

  // Load the saved activity. This IS the data source — a 404 means a not-yet-saved
  // activity (render an empty form so the teacher can save it).
  useEffect(() => {
    if (!activityId || (!isActivityStore && !classId)) {
      setLoadState("error");
      return;
    }
    let alive = true;
    // Seed the title from the deep-link param so the header + name field show
    // something before the load resolves (and for a 404 fresh form).
    if (titleParam) builder.setTitle(titleParam);
    const loader = isActivityStore
      ? fetchActivity(activityId)
      : fetchMyActivityConfig(classId, activityId);
    loader
      .then((saved) => {
        if (!alive) return;
        // Hydrate the FULL builder — goal, language, every element, the sim,
        // materials — so editing round-trips instead of wiping (1.1.40 M1).
        builder.hydrate(saved);
        // Keep the raw payload for the History panel's provenance + lifecycle.
        setMeta(saved as ActivityPayload);
        // Preserve the running skill for the PATCH back (Activity store only).
        if (isActivityStore) setLoadedSkillId((saved as { skillId?: string }).skillId ?? "");
        setLoadState("ready");
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof NotFoundError) {
          // No saved config yet — fresh activity. The empty form (title seeded
          // from the param) is ready for the teacher to fill in and save.
          setLoadState("ready");
          return;
        }
        console.warn("[teacher-ui] activity load failed:", err);
        setLoadState("error");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, activityId]);

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    setIsSaving(true);
    try {
      const elementSlice = {
        title: builder.title.trim() || displayName,
        teachingGoal: builder.teachingGoal,
        language: builder.language,
        workbenchType: builder.workbenchType,
        // The full element + sim slice. The save is a full overwrite, so sending
        // this is what stops a goal edit from wiping the activity's tables,
        // charts, calculators, notes and attached sim (1.1.40 M1).
        ...builder.elementPayload(),
        materials: builder.materials,
      };
      if (isActivityStore) {
        // ALS-1 M0: PATCH the class-independent activity, preserving its skill.
        await updateActivity(activityId, { skillId: loadedSkillId, ...elementSlice });
      } else {
        // Legacy per-class config (dual-read window).
        await saveActivityConfig({ activityId, classId, ...elementSlice });
      }
      showToast("Saved — students see your teaching goal on their next turn", 4000);
    } catch (err) {
      console.error("[teacher-ui] activity save failed:", err);
      showToast("Save failed — your changes were not stored", 4000);
    } finally {
      setIsSaving(false);
    }
  }

  const breadcrumb = (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <Link
        href="/teacher/activities"
        className="flex items-center gap-1 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Activities
      </Link>
      <span aria-hidden="true">/</span>
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
        <p className="max-w-3xl text-sm text-muted-foreground">
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
          <form onSubmit={handleSave} className="flex flex-col gap-5">
            <SettingsMap highlight="activity" classId={classId} />
            <ActivityBuilderBody
              builder={builder}
              activityId={activityId}
              personaSlot={<InheritedPersona classId={classId} />}
              footer={
                <div className="flex flex-wrap gap-2">
                  {/* The live preview (+ its full-screen pop-out) replaces the
                      old defunct "Preview as student" affordance (1.1.40). */}
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" aria-hidden="true" />
                    {isSaving ? "Saving…" : "Save configuration"}
                  </button>
                </div>
              }
            />
          </form>
          {/* COPILOT-1/2: the authoring co-pilot (dark-flagged → renders null
              when NEXT_PUBLIC_AUTHORING_COPILOT !== "1", so the builder is
              unaffected). The Apply router maps each proposal kind to a builder
              setter (M0: lesson prompt; M1/M2 add element + sim). */}
          <AuthoringCopilot activityId={activityId} onApplyProposal={(p) => applyCopilotProposal(p, builder)} />
        </section>
      ) : null}

      {activeTab === "code" ? <CodeTabPreview /> : null}

      {activeTab === "history" ? <HistoryPanel meta={meta} /> : null}

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

// -----------------------------------------------------------------------------
// History — real read-only provenance + lifecycle panel (M-HIST, ALS-SHARE)
// -----------------------------------------------------------------------------
// Where an activity came from (original vs adapted-from another teacher) and its
// lifecycle (visibility + created/updated stamps). Backed by the activity GET,
// which enriches an adopted activity with `sourceOwnerLabel`. The richer
// per-edit version timeline + rollback stays a Year-2 roadmap note below.

const VISIBILITY_COPY: Record<ActivityPayload["visibility"], string> = {
  draft: "Draft — not shared yet",
  private: "Private — your classes only",
  published: "Published — in the shared catalogue",
};

function formatStamp(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function HistoryPanel({ meta }: { meta: ActivityPayload | null }) {
  const visibility = meta?.visibility ?? "draft";
  const adapted = Boolean(meta?.sourceOwnerUid);
  const sourceLabel = meta?.sourceOwnerLabel ?? meta?.sourceOwnerUid ?? "another teacher";

  return (
    <section
      role="tabpanel"
      id="tabpanel-history"
      aria-labelledby="tab-history"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-3 rounded border border-border bg-background p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-4 w-4" aria-hidden="true" />
          Provenance
        </h2>
        {meta == null ? (
          <p className="text-sm text-muted-foreground">
            No history yet — save this activity to start its record.
          </p>
        ) : adapted ? (
          <p className="flex items-start gap-2 text-sm">
            <GitBranch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>
              Adapted from{" "}
              <span className="font-medium text-foreground">{sourceLabel}</span>
              ’s activity. Your copy is independent — the original owner’s later
              edits don’t change it.
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Created from scratch — this is an original activity.</span>
          </p>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-px overflow-hidden rounded border border-border bg-border text-sm sm:grid-cols-3">
        <div className="flex flex-col gap-0.5 bg-background p-3">
          <dt className="text-xs text-muted-foreground">Visibility</dt>
          <dd className="font-medium capitalize">{visibility}</dd>
          <dd className="text-xs text-muted-foreground">{VISIBILITY_COPY[visibility]}</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-background p-3">
          <dt className="text-xs text-muted-foreground">Created</dt>
          <dd className="font-medium">{formatStamp(meta?.createdAt)}</dd>
        </div>
        <div className="flex flex-col gap-0.5 bg-background p-3">
          <dt className="text-xs text-muted-foreground">Last updated</dt>
          <dd className="font-medium">{formatStamp(meta?.updatedAt)}</dd>
        </div>
      </dl>

      <RoadmapBanner
        version="v2"
        description="A per-edit version timeline with one-click rollback is Year-2. The previous version would stay live for existing student sessions until they refresh."
      />
    </section>
  );
}
