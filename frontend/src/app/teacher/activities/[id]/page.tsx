"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Save } from "lucide-react";

import {
  type ClassPayload,
  NotFoundError,
  fetchActivity,
  fetchMyActivityConfig,
  listClasses,
  saveActivityConfig,
  updateActivity,
} from "@/lib/teacherApi";
import type { ActivityPayload } from "@/lib/teacherApi";
import { ActingForOwnerBanner } from "@/components/teacher/ActingForOwnerBanner";
import { StudentsLanguageBadge } from "@/components/teacher/StudentsLanguageBadge";
import { ClassTutorSummary, tutorSettingsHref } from "@/components/teacher/InheritedTutor";
import { ModelTierControl } from "@/components/teacher/ModelTierControl";
import { TryAsStudentButton } from "@/components/teacher/TryAsStudentButton";
import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { useActivityBuilder } from "@/hooks/useActivityBuilder";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";
import { AuthoringCopilot } from "./_AuthoringCopilot";
import { applyCopilotProposal } from "../applyCopilotProposal";
import { runGoalLint } from "@/lib/teachingGoalLint";
import { useLocaleMode, useT } from "@/i18n";

type LoadState = "loading" | "ready" | "error";

const FORM_ID = "activity-editor-form";

/**
 * The activity editor.
 *
 * UI sweep 2026-11-11: no tabs. The "Code" tab was a roadmap mock showing
 * teachers fake Boldkast source and an internal note to M/JB (the design it
 * previews lives in docs/design/aipla/post-pilot/teacher-artefact-authoring.md);
 * History is one line under the title. The h1 is the activity's name, Try as
 * student sits in the header, and the tutor row names the tutor in every class
 * that runs the activity instead of guessing from the URL.
 *
 * UI sweep 2026-11-12: ONE Save. It used to sit in the header and again at the
 * end of the form, so the top of a short activity showed two identical red
 * buttons. It is now a sticky bar at the bottom of the form column — on screen
 * wherever the teacher has scrolled to, which is what the second copy was for.
 */
export default function TeacherActivityConfigPage() {
  const t = useT("ActivityConfigPage");
  const params = useParams();
  const searchParams = useSearchParams();
  const activityId = typeof params?.id === "string" ? params.id : "";

  // An act- activity loads by id alone. A legacy per-class config (the
  // dual-read window) needs the classId, so arriving without one is an error
  // state there, never mock data.
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
  const displayName = builder.title || titleParam || t("untitled");
  const [isSaving, setIsSaving] = useState(false);
  // The loaded activity's provenance + lifecycle metadata (visibility, source_*,
  // timestamps) for the history line. Null for a not-yet-saved (404) activity.
  const [meta, setMeta] = useState<ActivityPayload | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(isActivityStore || classId ? "loading" : "error");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { user } = useTeacherAuth({ redirectOnSignedOut: false });

  // Load the saved activity. This IS the data source — a 404 means a not-yet-saved
  // activity (render an empty form so the teacher can save it).
  useEffect(() => {
    if (!activityId || (!isActivityStore && !classId)) {
      setLoadState("error");
      return;
    }
    let alive = true;
    setLoadState("loading");
    // Seed the title from the deep-link param so the header + name field show
    // something before the load resolves (and for a 404 fresh form).
    if (titleParam) builder.setTitle(titleParam);
    const loader = isActivityStore ? fetchActivity(activityId) : fetchMyActivityConfig(classId, activityId);
    loader
      .then((saved) => {
        if (!alive) return;
        // Hydrate the FULL builder — goal, language, every element, the sim,
        // materials — so editing round-trips instead of wiping (1.1.40 M1).
        builder.hydrate(saved);
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
  }, [classId, activityId, loadAttempt]);

  // The classes that RUN this activity — its assignments — so the tutor row can
  // name the tutor in each. A researcher editing someone else's activity reads
  // across every teacher's classes, or the owner's would never be found.
  const ownerUid = meta?.ownerUid ?? "";
  const viewerUid = user?.uid ?? "";
  const classScope: "own" | "all" = ownerUid && viewerUid && ownerUid !== viewerUid ? "all" : "own";
  const [assigned, setAssigned] = useState<ClassPayload[] | null>(null);
  const [classesFailed, setClassesFailed] = useState(false);
  const [classesAttempt, setClassesAttempt] = useState(0);
  useEffect(() => {
    if (loadState !== "ready") return;
    let alive = true;
    setClassesFailed(false);
    listClasses(classScope)
      .then((cls) => {
        if (!alive) return;
        setAssigned(
          isActivityStore
            ? cls.filter((c) => (c.activityIds ?? []).includes(activityId))
            : cls.filter((c) => c.classId === classId),
        );
      })
      .catch(() => {
        if (alive) setClassesFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [loadState, classScope, activityId, classId, isActivityStore, classesAttempt]);

  // Try as student opens the class the editor came from, else the one class
  // that runs the activity; with several, the server picks.
  const previewClassId = classId || (assigned?.length === 1 ? assigned[0].classId : "");

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    setIsSaving(true);
    try {
      // builder.toSavePayload() assembles the COMPLETE payload (title/goal/
      // language/workbenchType + element+sim slice + materials) in one place,
      // shared with the create page. The save is a full overwrite, so sending the
      // whole element slice is what stops a goal edit from wiping the activity's
      // tables, charts, calculators, notes and attached sim (1.1.40 M1).
      // Edit-only: keep the existing title if the field was cleared.
      const payload = builder.toSavePayload();
      const elementSlice = { ...payload, title: payload.title || displayName };
      if (isActivityStore) {
        // ALS-1 M0: PATCH the class-independent activity, preserving its skill.
        const saved = await updateActivity(activityId, { skillId: loadedSkillId, ...elementSlice });
        // Only the timestamp moves the history line; the rest of `meta` is
        // provenance, which a save does not change.
        const updatedAt = (saved as { updatedAt?: string } | undefined)?.updatedAt;
        if (updatedAt) setMeta((prev) => (prev ? { ...prev, updatedAt } : prev));
      } else {
        // Legacy per-class config (dual-read window).
        await saveActivityConfig({ activityId, classId, ...elementSlice });
      }
      notify.success(t("saved"));
      // 1.1.141 M2 — once per save (cached by text), never per turn. Advisory:
      // the save above has already succeeded whatever this returns.
      void runGoalLint(builder.setGoalLint, payload.teachingGoal, { classId, activityId });
    } catch (err) {
      console.error("[teacher-ui] activity save failed:", err);
      notify.error(t("saveFailed"));
    } finally {
      setIsSaving(false);
    }
  }

  const breadcrumb = (
    <nav aria-label={t("breadcrumb")} className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
      <Link href="/teacher/activities" className="flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("activities")}
      </Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page" className="text-foreground">
        {displayName}
      </span>
    </nav>
  );

  if (loadState === "loading") {
    return (
      <div className="flex flex-col gap-6">
        {breadcrumb}
        <PageSkeleton label={t("loading")} />
      </div>
    );
  }

  if (loadState === "error") {
    const canRetry = Boolean(activityId) && (isActivityStore || Boolean(classId));
    return (
      <div className="flex flex-col gap-4">
        {breadcrumb}
        <LoadError what={t("what")} onRetry={canRetry ? () => setLoadAttempt((n) => n + 1) : undefined} />
        <Link
          href="/teacher/activities"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("backToActivities")}
        </Link>
      </div>
    );
  }

  const saveButton = (
    <Button type="submit" form={FORM_ID} variant="primary" pending={isSaving} pendingLabel={t("saving")}>
      <Save className="h-4 w-4" aria-hidden="true" />
      {t("save")}
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      {breadcrumb}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold sm:text-2xl">
            {displayName}
            {/* 1.1.151 F2b — the students' language, visible from the top. */}
            <StudentsLanguageBadge language={builder.language} />
          </h1>
          <HistoryLine meta={meta} />
        </div>
        {/* 1.1.133 — the whole student view, tutor included, no code.
            Activity-store ids only: the legacy composite config has no
            activity to mint a preview group for. */}
        {isActivityStore ? (
          <div className="flex flex-wrap items-start gap-2">
            <TryAsStudentButton activityId={activityId} classId={previewClassId} />
          </div>
        ) : null}
      </header>

      {/* 1.1.123 M0 — a researcher editing another teacher's activity is told
          so here; the owner sees nothing. `meta` is the saved payload, so a
          not-yet-saved activity (no owner yet) shows no banner either. */}
      {meta ? <ActingForOwnerBanner resource={meta} kind="activity" /> : null}

      {/* The scroll margin keeps a field the teacher tabs to clear of the
          sticky Save bar instead of focusing it underneath. */}
      <form
        id={FORM_ID}
        onSubmit={handleSave}
        className="flex flex-col gap-5 [&_button]:scroll-mb-20 [&_input]:scroll-mb-20 [&_select]:scroll-mb-20 [&_textarea]:scroll-mb-20"
      >
        <ActivityBuilderBody
          builder={builder}
          activityId={activityId}
          tutorSummary={
            <ClassTutorSummary
              classes={assigned}
              failed={classesFailed}
              onRetry={() => setClassesAttempt((n) => n + 1)}
            />
          }
          tutorChangeHref={tutorSettingsHref(assigned)}
          lintContext={{ classId, activityId }}
          // The one Save: sticky at the bottom of the form column, so it is in
          // reach at every scroll position (see the page comment).
          footer={
            <div className="sticky bottom-0 z-10 -mx-1 border-t border-border bg-background/95 px-1 py-3 backdrop-blur">
              {saveButton}
            </div>
          }
        />
      </form>

      {/* 1.1.142 M3 — researcher-only smart-model opt-in; renders nothing
          for anyone else. Saves through its own route, not handleSave. */}
      {isActivityStore && meta ? (
        <ModelTierControl key={meta.activityId} activityId={activityId} initialTier={meta.modelTier} />
      ) : null}
      {/* COPILOT-1/2: the authoring co-pilot (dark-flagged → renders null
          when NEXT_PUBLIC_AUTHORING_COPILOT !== "1", so the builder is
          unaffected). The Apply router maps each proposal kind to a builder
          setter; an applied element shows up as its workspace card. */}
      <AuthoringCopilot
        activityId={activityId}
        draft={builder.toSavePayload()}
        onApplyProposal={(p) => {
          applyCopilotProposal(p, builder);
          // 1.1.141 M3 — a drafted goal is linted and its how-to-teach
          // lines are moved into tutor notes, visibly and with Undo.
          if (p.kind === "set_lesson_prompt") {
            void runGoalLint(builder.setGoalLint, p.value, { classId, activityId }, "move");
          }
        }}
      />
    </div>
  );
}

// The date follows the teacher's chosen language, never the browser's (M4.3).
function formatStamp(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "da-DK", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * What used to be the History tab, as one line under the title (M-HIST,
 * ALS-SHARE; UI sweep 2026-11-11): created, last edited (and by whom, when it
 * was not the owner — 1.1.123 M3), whether it is shared, and where it was
 * adapted from.
 */
function HistoryLine({ meta }: { meta: ActivityPayload | null }) {
  const t = useT("ActivityConfigPage");
  const tOwner = useT("ActingForOwnerBanner");
  const mode = useLocaleMode();
  const locale = mode === "en" ? "en" : "da";
  const parts: string[] = [];
  if (!meta) {
    parts.push(t("historyNew"));
  } else {
    const created = formatStamp(meta.createdAt, locale);
    if (created) parts.push(t("historyCreated", { date: created }));
    const updated = formatStamp(meta.updatedAt, locale);
    // `lastEditedBy` is stamped only when someone other than the owner wrote
    // the activity; it names them only while it is still the latest edit.
    const stamp = meta.lastEditedBy;
    const stampIsLatest =
      stamp && (!meta.updatedAt || new Date(stamp.at).getTime() >= new Date(meta.updatedAt).getTime() - 60_000);
    if (stamp && stampIsLatest) {
      parts.push(
        t("historyEditedBy", {
          date: formatStamp(stamp.at, locale) || updated,
          who: meta.lastEditedByLabel ?? tOwner("someoneElse"),
        }),
      );
    } else if (updated) {
      parts.push(t("historyEdited", { date: updated }));
    }
    parts.push(t(`vis_${meta.visibility ?? "draft"}`));
    if (meta.sourceOwnerUid) {
      parts.push(t("historyAdapted", { source: meta.sourceOwnerLabel ?? meta.sourceOwnerUid ?? t("anotherTeacher") }));
    }
  }
  return (
    <p data-testid="activity-history" className="mt-1 text-sm text-muted-foreground">
      {parts.join(" · ")}
    </p>
  );
}
