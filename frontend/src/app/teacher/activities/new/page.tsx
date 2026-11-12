"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Rocket } from "lucide-react";

import {
  type ClassPayload,
  type Language,
  createActivity,
  listAccessibleSkills,
  listClasses,
  setActivityVisibility,
} from "@/lib/teacherApi";
import { GoalStep } from "@/components/teacher/activity-wizard/GoalStep";
import { ReviewStep } from "@/components/teacher/activity-wizard/ReviewStep";
import {
  WizardColumns,
  WizardFooter,
  WizardHeader,
  WizardPreview,
  WizardStepper,
  type WizardStep,
} from "@/components/teacher/activity-wizard/WizardFrame";
import { WorkspaceSection } from "@/components/teacher/WorkspaceElements";
import { useCopilotEntry } from "@/components/teacher/copilot";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { LoadError } from "@/components/ui/load-error";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { useActivityBuilder, type ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useT } from "@/i18n";
import type { ActivityTemplate } from "@/lib/activityTemplates";
import { suggestActivityTitle } from "@/lib/suggestActivityTitle";
import { conceptMapDefault, studentLanguageDefault, useTeacherPrefs } from "@/hooks/useTeacherPrefs";
import { AuthoringCopilot } from "../[id]/_AuthoringCopilot";
import { applyCopilotProposal } from "../applyCopilotProposal";
import { runGoalLint } from "@/lib/teachingGoalLint";

// TAA-1 M0: a from-scratch activity runs the `concept-dialogue` base
// skill (chat-only Socratic tutor). The teacher's title + lesson prompt
// become the activity's identity + injected {teacher_focus}.
//
// NOTE: platform skills are keyed by a per-environment UUID skill_id, NOT
// by name — so we resolve the real skill_id from the catalogue at runtime.
// Passing the name 404s the lessons PATCH (get_skill(name)->None).
const CONCEPT_SKILL_NAME = "concept-dialogue";

type ClassesState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "no-skill" } // concept-dialogue base skill not seeded in this env
  | { status: "empty" }
  | { status: "ready"; classes: ClassPayload[]; conceptSkillId: string };

/** The step, kept in the URL (`?step=`) so the browser's Back steps back. */
const STEP_PARAMS = ["1", "2", "3"] as const;
type StepParam = (typeof STEP_PARAMS)[number];

/** The part of the form a template or "start over" would overwrite. */
interface Baseline {
  title: string;
  goal: string;
  count: number;
}

function snapshot(b: ActivityBuilder): Baseline {
  return { title: b.title.trim(), goal: b.teachingGoal.trim(), count: b.workspaceCount };
}

/** Has the teacher typed or added anything a template would silently replace?
 *  Seeds (the `?brief=` goal and the name suggested from it, the language and
 *  the empty concept map) are in the baseline, so they do not count. */
function hasOwnWork(b: ActivityBuilder, base: Baseline): boolean {
  return (
    b.title.trim() !== base.title ||
    b.teachingGoal.trim() !== base.goal ||
    b.workspaceCount !== base.count ||
    b.tutorNotes.trim() !== "" ||
    b.studentOpening.trim() !== "" ||
    b.starterPrompts.some((p) => p.trim()) ||
    b.materials.length > 0
  );
}

// Wrapped in Suspense because the wizard reads useSearchParams() — Next.js
// requires a Suspense boundary for that during static prerender.
export default function NewActivityPage() {
  const t = useT("NewActivityPage");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <NewActivityWizard />
    </Suspense>
  );
}

/**
 * Create an activity in three steps (2026-11-12): what students should learn,
 * what they work with, check and start. Replaces the long form; the EDITOR
 * (`activities/[id]`) keeps its sections. The state is the same
 * `useActivityBuilder` the editor uses, so the save payload cannot drift.
 */
function NewActivityWizard() {
  const t = useT("NewActivityPage");
  const tw = useT("ActivityWizard");
  const tBody = useT("ActivityBuilderBody");
  const router = useRouter();
  const confirm = useConfirm();
  // Pre-select the class the teacher came from (the "New activity" button on
  // the class-detail page passes ?classId=…).
  const searchParams = useSearchParams();
  const preferredClassId = searchParams.get("classId");
  // 1.1.139 M3 — "Add to next activity" from the after-lesson review carries
  // the class's "next time" here as the teaching goal: the draft the authoring
  // co-pilot reads as its starting brief. Seeded once, never over typed text.
  const brief = searchParams.get("brief");
  const briefGoal = (brief ?? "").slice(0, 2000);

  const builder = useActivityBuilder();
  // The name follows the goal until the teacher types one (or a template
  // names it). Never overwrites a typed name.
  const [nameSuggested, setNameSuggested] = useState(false);
  useEffect(() => {
    if (briefGoal && !builder.teachingGoal) {
      builder.setTeachingGoal(briefGoal);
      const name = suggestActivityTitle(briefGoal);
      if (name && !builder.title) {
        builder.setTitle(name);
        setNameSuggested(true);
      }
    }
    // Seed exactly once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { prefs, loaded: prefsLoaded } = useTeacherPrefs();
  useEffect(() => {
    if (!prefsLoaded) return;
    // CONCEPT-2 M3 — open a new activity WITH a concept-map section unless the
    // teacher turned the default off. Seeding (not forcing): if the builder
    // already carries a map — a template was picked first — it is left alone.
    if (conceptMapDefault(prefs) && !builder.conceptMap) builder.setConceptMap({ title: "", nodes: [] });
    // Seed exactly once, when prefs resolve — not on later builder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded]);

  // What a template would overwrite, as it stood after the last template (or
  // seed). Re-taken once the builder HOLDS the template's name and goal: an
  // unrelated update (the prefs seed) can re-render first, and snapshotting
  // that render kept the old baseline, so switching examples asked to
  // overwrite the example itself.
  const [baseline, setBaseline] = useState<Baseline>(() => ({
    title: briefGoal ? suggestActivityTitle(briefGoal) : "",
    goal: briefGoal.trim(),
    count: 0,
  }));
  const rebase = useRef<{ title: string; goal: string } | null>(null);
  useEffect(() => {
    const expected = rebase.current;
    if (!expected) return;
    if (builder.title.trim() !== expected.title || builder.teachingGoal.trim() !== expected.goal) return;
    rebase.current = null;
    setBaseline(snapshot(builder));
  }, [builder]);

  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [classesState, setClassesState] = useState<ClassesState>({ status: "loading" });
  const [classesAttempt, setClassesAttempt] = useState(0);
  const [classId, setClassId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [share, setShare] = useState(false);

  useEffect(() => {
    let alive = true;
    setClassesState({ status: "loading" });
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
  }, [preferredClassId, classesAttempt]);

  const classes = classesState.status === "ready" ? classesState.classes : [];
  const selectedClass = classes.find((c) => c.classId === classId) ?? null;

  // The students' language is the CLASS's when it has one, else the account
  // default (2026-11-12). It follows a class switch until the teacher picks a
  // language under "More settings"; a template never changes it.
  const languageChosen = useRef(false);
  const classLanguage = selectedClass?.voice?.language ?? null;
  useEffect(() => {
    if (!prefsLoaded || !selectedClass || languageChosen.current) return;
    const next = studentLanguageDefault(classLanguage, prefs);
    if (next !== builder.language) builder.setLanguage(next);
    // Re-derived when the class or the prefs change — not on builder edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded, classId, classLanguage]);

  // ── Steps ────────────────────────────────────────────────────────────────
  const [stepParam, setStepParam] = useUrlTab<StepParam>("step", STEP_PARAMS, "1", { history: "push" });
  const goalReady = builder.teachingGoal.trim().length > 0 && builder.title.trim().length > 0 && classId.length > 0;
  // A step past the goal is reachable only once the goal step is complete — a
  // refreshed or shared `?step=3` link lands on step 1 rather than an empty
  // review.
  const step: WizardStep = goalReady ? (Number(stepParam) as WizardStep) : 1;
  const reachable: WizardStep = goalReady ? 3 : 1;
  const goTo = (n: WizardStep) => setStepParam(String(n) as StepParam);

  // Focus the step's question when the step changes (not on first paint).
  const goalRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const lastStep = useRef<WizardStep | null>(null);
  useEffect(() => {
    if (classesState.status !== "ready") return;
    if (lastStep.current !== null && lastStep.current !== step) {
      if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
        try {
          window.scrollTo({ top: 0 });
        } catch {
          /* jsdom */
        }
      }
      if (step === 1) goalRef.current?.focus();
      else headingRef.current?.focus();
    }
    lastStep.current = step;
  }, [step, classesState.status]);

  // ── Goal and name ────────────────────────────────────────────────────────
  function changeGoal(goal: string) {
    builder.setTeachingGoal(goal);
    if (nameSuggested || !builder.title.trim()) {
      builder.setTitle(suggestActivityTitle(goal));
      setNameSuggested(true);
    }
  }

  function changeName(name: string) {
    builder.setTitle(name);
    setNameSuggested(false);
  }

  // ── Templates ────────────────────────────────────────────────────────────
  async function pickTemplate(tpl: ActivityTemplate) {
    // Applying a template replaces the title, the goal and every element. It
    // used to do that silently, so a teacher who typed first and browsed
    // second lost their work to one click.
    if (
      hasOwnWork(builder, baseline) &&
      !(await confirm({
        title: t("confirmTemplateTitle"),
        description: t("confirmTemplateBody"),
        confirmLabel: t("confirmTemplateOk"),
        destructive: true,
      }))
    ) {
      return;
    }
    builder.applyTemplate(tpl);
    setNameSuggested(false);
    rebase.current = { title: tpl.title.trim(), goal: tpl.teachingGoal.trim() };
    setAppliedTemplateId(tpl.id);
  }

  async function startBlank() {
    if (
      hasOwnWork(builder, baseline) &&
      !(await confirm({
        title: t("confirmBlankTitle"),
        description: t("confirmBlankBody"),
        confirmLabel: t("confirmBlankOk"),
        destructive: true,
      }))
    ) {
      return;
    }
    // A blank draft: hydrating an empty config clears the title, goal and
    // every element (hydrate reads each field with a `?? default`) — but the
    // students' language and the concept-map default are seeds, not work, so
    // they are put back.
    const language = builder.language;
    builder.hydrate({} as Parameters<typeof builder.hydrate>[0]);
    builder.setLanguage(language);
    if (conceptMapDefault(prefs)) builder.setConceptMap({ title: "", nodes: [] });
    setNameSuggested(false);
    rebase.current = { title: "", goal: "" };
    setAppliedTemplateId("__blank__");
  }

  // ── Leave / create ───────────────────────────────────────────────────────
  async function cancel() {
    if (
      hasOwnWork(builder, baseline) &&
      !(await confirm({
        title: tw("discardTitle"),
        description: tw("discardBody"),
        confirmLabel: tw("discardOk"),
        destructive: true,
      }))
    ) {
      return;
    }
    router.push("/teacher/activities");
  }

  const canCreate = goalReady && !isSaving && classesState.status === "ready";

  async function create() {
    if (!canCreate || classesState.status !== "ready") return;
    const conceptSkillId = classesState.conceptSkillId;
    setIsSaving(true);
    setSaveError(null);
    let activityId: string;
    try {
      // ALS-1 M0: create a NEW activity in the class-independent store. The backend
      // mints a distinct `act-…` id every time, so creating a second activity in
      // the same class can never overwrite the first. `classId` makes the POST
      // also assign it to the class.
      const activity = await createActivity({
        skillId: conceptSkillId,
        classId,
        // Title/goal/language/workbenchType + the element+sim slice + materials,
        // all assembled in one place (builder.toSavePayload) so create and edit
        // can't drift on which fields they persist.
        ...builder.toSavePayload(),
      });
      activityId = activity.activityId;
    } catch (err) {
      console.error("[teacher-ui] create activity failed:", err);
      setSaveError(t("saveFailed"));
      setIsSaving(false);
      return;
    }
    // Sharing is a second call. If it fails the activity still exists: say so,
    // and never roll the create back.
    if (share) {
      try {
        await setActivityVisibility(activityId, "published");
      } catch (err) {
        console.error("[teacher-ui] share new activity failed:", err);
        notify.error(tw("shareFailed"));
      }
    }
    const title = builder.title.trim();
    // UI sweep 2026-11-11 — straight to the editor; the toast carries
    // "Create another".
    notify.success(t("createdToast", { title, className: selectedClass?.name ?? classId }), {
      action: {
        label: t("another"),
        onClick: () => router.push(`/teacher/activities/new?classId=${encodeURIComponent(classId)}`),
      },
    });
    router.push(
      `/teacher/activities/${encodeURIComponent(activityId)}?classId=${encodeURIComponent(classId)}&title=${encodeURIComponent(title)}`,
    );
  }

  // CONCEPT-2 M3 — "Propose a concept map" asks the page's co-pilot; only
  // offered where a work co-pilot is mounted (see ActivityBuilderBody).
  const entry = useCopilotEntry();
  const proposeConceptMap = entry?.registered ? () => entry.ask(tBody("proposeConceptMap")) : undefined;

  // ── Render ───────────────────────────────────────────────────────────────
  const stepper = <WizardStepper step={step} reachable={reachable} onGo={goTo} />;

  if (classesState.status !== "ready") {
    return (
      <div className="flex flex-col gap-6">
        <WizardHeader stepper={stepper} />
        {classesState.status === "loading" ? (
          <PageSkeleton label={t("loadingClasses")} />
        ) : classesState.status === "error" ? (
          <LoadError what={t("classesWhat")} onRetry={() => setClassesAttempt((n) => n + 1)} />
        ) : classesState.status === "no-skill" ? (
          <PanelMessage tone="error">{t("noSkill")}</PanelMessage>
        ) : (
          <PanelMessage>
            {t.rich("noClass", {
              link: (chunks) => (
                <Link href="/teacher/classes" className="font-medium text-primary hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </PanelMessage>
        )}
      </div>
    );
  }

  const previewActivityId = classesState.conceptSkillId;
  const preview = <WizardPreview builder={builder} activityId={previewActivityId} />;

  const secondary =
    step === 1 ? (
      <Button variant="secondary" onClick={() => void cancel()}>
        {tw("cancel")}
      </Button>
    ) : (
      <Button variant="secondary" onClick={() => goTo((step - 1) as WizardStep)}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {tw("back")}
      </Button>
    );

  const blocked = step === 1 && !goalReady;
  const primary =
    step === 1 ? (
      <Button type="submit" variant="primary" disabled={blocked} aria-describedby={blocked ? "wizard-blocked" : undefined}>
        {tw("nextTools")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    ) : step === 2 ? (
      <Button variant="primary" onClick={() => goTo(3)}>
        {tw("nextReview")}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    ) : (
      <Button
        variant="primary"
        onClick={() => void create()}
        disabled={!canCreate}
        pending={isSaving}
        pendingLabel={tw("creating")}
        className="h-auto min-h-9 whitespace-normal py-2 text-left"
      >
        <Rocket className="h-4 w-4" aria-hidden="true" />
        {tw("create", { className: selectedClass?.name ?? "" })}
      </Button>
    );

  return (
    <div className="flex flex-col gap-6">
      <WizardHeader stepper={stepper} />
      <form
        className="flex flex-col gap-6"
        onSubmit={(ev) => {
          ev.preventDefault();
          // Enter in the name field moves on from step 1. Later steps hold the
          // element editors, where Enter must not leave (or create) — those
          // steps act only on their button.
          if (step === 1 && goalReady) goTo(2);
        }}
      >
        {step === 1 ? (
          <WizardColumns
            main={
              <GoalStep
                builder={builder}
                classes={classes}
                classId={classId}
                onClassChange={setClassId}
                goalRef={goalRef}
                onGoalChange={changeGoal}
                onNameChange={changeName}
                nameSuggested={nameSuggested}
                appliedTemplateId={appliedTemplateId}
                onPickTemplate={(tpl) => void pickTemplate(tpl)}
                onStartBlank={() => void startBlank()}
              />
            }
            preview={preview}
          />
        ) : step === 2 ? (
          <WizardColumns
            main={
              <>
                <div className="flex flex-col gap-1">
                  <h1
                    ref={headingRef}
                    tabIndex={-1}
                    className="text-xl font-semibold text-foreground outline-none sm:text-2xl"
                  >
                    {tw("toolsHeading")}
                  </h1>
                  <p className="text-sm text-muted-foreground">{tw("toolsHelp")}</p>
                </div>
                <WorkspaceSection
                  builder={builder}
                  activityId={previewActivityId}
                  onProposeConceptMap={proposeConceptMap}
                  variant="tiles"
                />
              </>
            }
            preview={preview}
          />
        ) : (
          <WizardColumns
            big
            main={
              <ReviewStep
                builder={builder}
                selectedClass={selectedClass}
                activityId={previewActivityId}
                headingRef={headingRef}
                onEditStep={goTo}
                onLanguageChange={(language: Language) => {
                  languageChosen.current = true;
                  builder.setLanguage(language);
                }}
                share={share}
                onShareChange={setShare}
                error={
                  saveError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {saveError}
                    </p>
                  ) : null
                }
              />
            }
            preview={preview}
          />
        )}

        <WizardFooter
          step={step}
          secondary={secondary}
          primary={primary}
          hint={blocked ? tw("blocked") : null}
          hintId="wizard-blocked"
        />
      </form>

      {/* COPILOT-1/2: the authoring co-pilot on the CREATE page. Dark-flagged
          (renders null when NEXT_PUBLIC_AUTHORING_COPILOT !== "1"). No activity_id
          yet — it proposes into the draft (the Save is owner-scoped). Mounted
          across all three steps, reached from the header's Help menu. */}
      <AuthoringCopilot
        activityId=""
        draft={builder.toSavePayload()}
        onApplyProposal={(p) => {
          applyCopilotProposal(p, builder);
          // 1.1.141 M3 — the co-pilot's drafted goal: how-to-teach lines move
          // into tutor notes, visibly and with Undo.
          if (p.kind === "set_lesson_prompt") {
            void runGoalLint(builder.setGoalLint, p.value, { classId }, "move");
          }
        }}
      />
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
        tone === "error"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : "border-border bg-muted/40 text-muted-foreground"
      }`}
    >
      {children}
    </div>
  );
}
