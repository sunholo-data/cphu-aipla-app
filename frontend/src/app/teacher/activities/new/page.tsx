"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowLeft, FilePlus2, LayoutTemplate, Save, Sparkles } from "lucide-react";

import {
  type ClassPayload,
  createActivity,
  listAccessibleSkills,
  listClasses,
} from "@/lib/teacherApi";
import { ClassTutorSummary, tutorSettingsHref } from "@/components/teacher/InheritedTutor";
import { TemplatePicker } from "@/components/teacher/TemplatePicker";
import { ActivityBuilderBody } from "@/components/teacher/ActivityBuilderBody";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { LoadError } from "@/components/ui/load-error";
import { PageSkeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { useActivityBuilder, type ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { ACTIVITY_TEMPLATES, type ActivityTemplate } from "@/lib/activityTemplates";
import { conceptMapDefault, languageSeed, useTeacherPrefs } from "@/hooks/useTeacherPrefs";
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

/** How the teacher chose to start (UI sweep 2026-11-11). */
type Start =
  | { mode: "choose" }
  | { mode: "picking"; appliedId?: string }
  | { mode: "template"; id: string; name: string }
  | { mode: "blank" };

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
 *  Seeds (the `?brief=` goal, the account's language and empty concept map)
 *  are in the baseline, so they do not count. */
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

// Wrapped in Suspense because the form reads useSearchParams() — Next.js
// requires a Suspense boundary for that during static prerender.
export default function NewActivityPage() {
  const t = useT("NewActivityPage");
  return (
    <Suspense fallback={<PageSkeleton label={t("loading")} />}>
      <NewActivityForm />
    </Suspense>
  );
}

function NewActivityForm() {
  const t = useT("NewActivityPage");
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

  const builder = useActivityBuilder();
  useEffect(() => {
    if (brief && !builder.teachingGoal) builder.setTeachingGoal(brief.slice(0, 2000));
    // Seed exactly once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 1.1.58 — seed the language from the account default, CREATE-time only and
  // only while the form is untouched (an explicit choice is never overridden).
  const { prefs, loaded: prefsLoaded } = useTeacherPrefs();
  useEffect(() => {
    if (!prefsLoaded) return;
    const seed = languageSeed(prefs, builder);
    if (seed) builder.setLanguage(seed);
    // CONCEPT-2 M3 — open a new activity WITH a concept-map section unless the
    // teacher turned the default off. Seeding (not forcing): if the builder
    // already carries a map — a template was picked first — it is left alone.
    if (conceptMapDefault(prefs) && !builder.conceptMap) builder.setConceptMap({ title: "", nodes: [] });
    // Seed exactly once, when prefs resolve — not on later builder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefsLoaded]);

  // What a template would overwrite, as it stood after the last template (or
  // seed). Re-taken on the render AFTER a template applies, when the builder
  // holds the template's values.
  const [baseline, setBaseline] = useState<Baseline>(() => ({
    title: "",
    goal: (brief ?? "").slice(0, 2000).trim(),
    count: 0,
  }));
  const rebase = useRef(false);
  useEffect(() => {
    if (!rebase.current) return;
    rebase.current = false;
    setBaseline(snapshot(builder));
  }, [builder]);

  const [start, setStart] = useState<Start>({ mode: "choose" });
  const [classesState, setClassesState] = useState<ClassesState>({ status: "loading" });
  const [classesAttempt, setClassesAttempt] = useState(0);
  const [classId, setClassId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  const canSubmit = builder.isFormValid() && classId.length > 0 && !isSaving;

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
    rebase.current = true;
    setStart({ mode: "template", id: tpl.id, name: tpl.name });
  }

  async function startBlank() {
    if (hasOwnWork(builder, baseline)) {
      if (
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
      // every element (hydrate reads each field with a `?? default`).
      builder.hydrate({} as Parameters<typeof builder.hydrate>[0]);
      rebase.current = true;
    } else if (start.mode === "template") {
      builder.hydrate({} as Parameters<typeof builder.hydrate>[0]);
      rebase.current = true;
    }
    setStart({ mode: "blank" });
  }

  async function handleSave(ev: React.FormEvent) {
    ev.preventDefault();
    if (!canSubmit || classesState.status !== "ready") return;
    const conceptSkillId = classesState.conceptSkillId;
    setIsSaving(true);
    setSaveError(null);
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
      const cls = classesState.classes.find((c) => c.classId === classId);
      const title = builder.title.trim();
      // UI sweep 2026-11-11 — straight to the editor (the success panel's
      // "Configure" sent the teacher to the builder they had just used); the
      // toast carries "Create another".
      notify.success(t("createdToast", { title, className: cls?.name ?? classId }), {
        action: {
          label: t("another"),
          onClick: () => router.push(`/teacher/activities/new?classId=${encodeURIComponent(classId)}`),
        },
      });
      router.push(
        `/teacher/activities/${encodeURIComponent(activity.activityId)}?classId=${encodeURIComponent(classId)}&title=${encodeURIComponent(title)}`,
      );
    } catch (err) {
      console.error("[teacher-ui] create activity failed:", err);
      setSaveError(t("saveFailed"));
      setIsSaving(false);
    }
  }

  const selectedClass = classesState.status === "ready" ? classesState.classes.find((c) => c.classId === classId) : null;
  const tutorClasses = selectedClass ? [selectedClass] : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/teacher/activities"
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {t("back")}
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          <Sparkles className="h-6 w-6 text-primary" aria-hidden="true" /> {t("title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      {classesState.status === "loading" ? (
        <PageSkeleton label={t("loadingClasses")} />
      ) : classesState.status === "error" ? (
        <LoadError what={t("classesWhat")} onRetry={() => setClassesAttempt((n) => n + 1)} />
      ) : classesState.status === "no-skill" ? (
        <PanelMessage tone="error">{t("noSkill")}</PanelMessage>
      ) : classesState.status === "empty" ? (
        <PanelMessage>
          {t.rich("noClass", {
            link: (chunks) => (
              <Link href="/teacher/classes" className="font-medium text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </PanelMessage>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-5">
          <ActivityBuilderBody
            builder={builder}
            templateSlot={
              <StartChoice
                start={start}
                onChoose={(mode) => (mode === "blank" ? void startBlank() : setStart({ mode: "picking" }))}
                onPick={(tpl) => void pickTemplate(tpl)}
                onReopen={() =>
                  setStart(start.mode === "template" ? { mode: "picking", appliedId: start.id } : { mode: "choose" })
                }
              />
            }
            activityId={classesState.conceptSkillId}
            classControl={
              <label htmlFor="activity-class" className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">{t("class")}</span>
                <select
                  id="activity-class"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  {classesState.classes.map((c) => (
                    <option key={c.classId} value={c.classId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            }
            tutorSummary={<ClassTutorSummary classes={tutorClasses} showClassNames={false} />}
            tutorChangeHref={tutorSettingsHref(tutorClasses)}
            lintContext={{ classId }}
            error={
              saveError ? (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              ) : null
            }
            footer={
              <div>
                <Button type="submit" variant="primary" disabled={!canSubmit} pending={isSaving} pendingLabel={t("creating")}>
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {t("create")}
                </Button>
              </div>
            }
          />
        </form>
      )}
      {/* COPILOT-1/2: the authoring co-pilot on the CREATE page. Dark-flagged
          (renders null when NEXT_PUBLIC_AUTHORING_COPILOT !== "1"). No activity_id
          yet — it proposes into the draft (the Save is owner-scoped). */}
      {classesState.status === "ready" ? (
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
      ) : null}
    </div>
  );
}

/**
 * "Start from a template" / "Start from scratch" (UI sweep 2026-11-11). The
 * 23-card strip opens only on the first choice, and an applied template
 * collapses to one line with Change.
 */
function StartChoice({
  start,
  onChoose,
  onPick,
  onReopen,
}: {
  start: Start;
  onChoose: (mode: "template" | "blank") => void;
  onPick: (tpl: ActivityTemplate) => void;
  onReopen: () => void;
}) {
  const t = useT("NewActivityPage");
  if (start.mode === "picking") {
    return <TemplatePicker onPick={onPick} onStartBlank={() => onChoose("blank")} appliedId={start.appliedId} />;
  }
  if (start.mode === "template" || start.mode === "blank") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="font-medium text-foreground">
          {start.mode === "template" ? t("templateApplied", { name: start.name }) : t("blankChosen")}
        </span>
        <button type="button" onClick={onReopen} className="font-medium text-primary hover:underline">
          {t("changeStart")}
        </button>
      </div>
    );
  }
  return (
    <div role="group" aria-label={t("startAria")} className="grid gap-3 sm:grid-cols-2">
      <ChoiceCard
        icon={<LayoutTemplate className="h-5 w-5" aria-hidden="true" />}
        title={t("startTemplate")}
        help={t("startTemplateHelp", { count: ACTIVITY_TEMPLATES.length })}
        onClick={() => onChoose("template")}
      />
      <ChoiceCard
        icon={<FilePlus2 className="h-5 w-5" aria-hidden="true" />}
        title={t("startBlank")}
        help={t("startBlankHelp")}
        onClick={() => onChoose("blank")}
      />
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  help,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  help: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{help}</span>
      </span>
    </button>
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
