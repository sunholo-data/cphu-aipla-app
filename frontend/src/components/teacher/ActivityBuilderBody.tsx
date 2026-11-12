"use client";

import { ArrowUpRight, ChevronUp, Pencil } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { ActivityPreview } from "@/components/teacher/ActivityPreview";
import { ActivityOpeningEditor } from "@/components/teacher/ActivityOpeningEditor";
import { BuilderHints } from "@/components/teacher/BuilderHints";
import { BuilderSection, BuilderSectionNav, SECTION } from "@/components/teacher/BuilderLayout";
import { MaterialsSection } from "@/components/teacher/MaterialsSection";
import { StudentViewPicker } from "@/components/teacher/StudentViewPicker";
import { WorkspaceSection } from "@/components/teacher/WorkspaceElements";
import { useCopilotEntry } from "@/components/teacher/copilot";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { TeachingGoalLint, TutorNotesField } from "@/components/teacher/TeachingGoalLint";
import { useT } from "@/i18n";
import { languageHint, tableHints, type BuilderHint } from "@/lib/builderHints";
import { runGoalLint, type GoalLintContext } from "@/lib/teachingGoalLint";

interface ActivityBuilderBodyProps {
  builder: ActivityBuilder;
  /** The template choice (create page only), rendered at the top of the config
   *  column so the live preview sits BESIDE it — clicking through templates
   *  re-renders the student view, which is the preview a teacher chooses by. */
  templateSlot?: ReactNode;
  /** The activity id, threaded to the Materials section so image uploads can be
   *  attached to the activity slot (1.1.44). Edit page: route param; create
   *  page: the resolved concept skill id. */
  activityId?: string;
  /** The class control for the Setup section — a `<select>` on the create page.
   *  The edit page has none: an activity's classes are its assignments. */
  classControl?: ReactNode;
  /** The tutor summary row's value — who teaches this activity in each class
   *  that runs it (`ClassTutorSummary`). Resolved by the page, which knows the
   *  classes; the row itself is rendered here (UI sweep 2026-11-11). */
  tutorSummary?: ReactNode;
  /** Where the tutor row's "Change in the class" link goes. */
  tutorChangeHref?: string;
  /** 1.1.141 M2 — the class (and activity) the teaching goal is linted
   *  against: its tutor's approach decides which lines would conflict. */
  lintContext?: GoalLintContext;
  /** Actions row under the config column (optional). The edit page puts its one
   *  Save here, as a sticky bar (UI sweep 2026-11-12). */
  footer?: ReactNode;
  /** Optional error/alert node rendered above the footer. */
  error?: ReactNode;
}

/**
 * The activity-builder workspace, shared by the create and edit pages (1.1.40
 * M1) so they can't drift. Two columns on wide screens: a summary block and
 * four sections on the left, the live student preview pinned beside them on
 * the right. Both pages feed it the same `useActivityBuilder` state.
 *
 * UI sweep 2026-11-11: the "where settings live" map is gone (the tutor row
 * names the tutor per class and links there); the tutor, the student view and
 * the opening are one summary block; the workspace adds on demand.
 */
export function ActivityBuilderBody({
  builder,
  templateSlot,
  activityId,
  classControl,
  tutorSummary,
  tutorChangeHref = "/teacher/classes",
  lintContext,
  footer,
  error,
}: ActivityBuilderBodyProps) {
  const t = useT("ActivityBuilderBody");
  const b = builder;
  const hints = collectBuilderHints(b);
  // CONCEPT-2 M3 — "Foreslå begrebskort" asks the page's co-pilot for a draft.
  // `useCopilotEntry` is null outside the teacher shell and `ask` returns false
  // when no work co-pilot is mounted, so the button only appears where it can
  // actually do something. The co-pilot already receives the builder's draft as
  // hidden context, so the request needs no arguments.
  const entry = useCopilotEntry();
  const proposeConceptMap = entry?.registered
    ? () => {
        // Sent as the teacher's own turn, so it is in the teacher's language.
        entry.ask(t("proposeConceptMap"));
      }
    : undefined;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,46rem)_minmax(0,1fr)]">
      {/* LEFT — configuration. */}
      <div className="flex min-w-0 flex-col gap-4">
        {templateSlot}

        {/* Three settings that used to sit in three different sections (or,
            for the tutor, said "Default tutor" whenever the URL carried no
            class) as one block. Each row says what is set and opens its
            existing editor in place. */}
        <SummaryBlock builder={b} tutorSummary={tutorSummary} tutorChangeHref={tutorChangeHref} />

        <BuilderSectionNav
          counts={{
            [SECTION.workspace.id]: b.workspaceCount,
            [SECTION.materials.id]: b.materials.length,
          }}
        />

        <BuilderSection section={SECTION.setup}>
          {/* 1.1.151 F2b — the students' language sits NEXT TO the title: two
              activities of a Danish class ran an English tutor because this
              field sat lower down and nobody saw its value. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <Field label={t("name")} htmlFor="activity-title">
                <input
                  id="activity-title"
                  type="text"
                  value={b.title}
                  onChange={(e) => b.setTitle(e.target.value)}
                  placeholder={t("namePlaceholder")}
                  maxLength={200}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </Field>
            </div>
            {/* The STUDENTS' language (data on the activity) — not the teacher's own
                DA | EN setting, which only changes this screen (1.1.108). */}
            <div className="sm:w-44">
              <Field label={t("language")} htmlFor="activity-language">
                <select
                  id="activity-language"
                  value={b.language}
                  onChange={(e) => b.setLanguage(e.target.value as ActivityBuilder["language"])}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  {/* Endonyms: each language named in itself, never translated. */}
                  <option value="da" translate="no">
                    Dansk
                  </option>
                  <option value="en" translate="no">
                    English
                  </option>
                </select>
              </Field>
            </div>
          </div>
          <span className="-mt-2 text-xs text-muted-foreground">{t("languageHelp")}</span>

          {classControl}
        </BuilderSection>

        <BuilderSection section={SECTION.lesson}>
          <Field label={t("goal")} htmlFor="activity-goal">
            <textarea
              id="activity-goal"
              value={b.teachingGoal}
              onChange={(e) => b.setTeachingGoal(e.target.value)}
              // 1.1.141 M2 — lint once the teacher leaves the field; skipped
              // when this exact text was already linted (the backend caches too).
              onBlur={() => {
                if (b.goalLint?.text !== b.teachingGoal.trim()) {
                  void runGoalLint(b.setGoalLint, b.teachingGoal, lintContext ?? {});
                }
              }}
              placeholder={t("goalPlaceholder")}
              rows={6}
              maxLength={2000}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
            />
          </Field>
          <p className="text-xs text-muted-foreground">{t("goalHelp")}</p>
          <TeachingGoalLint builder={b} />
          <TutorNotesField builder={b} />
        </BuilderSection>

        <BuilderSection section={SECTION.workspace}>
          <WorkspaceSection builder={b} activityId={activityId} onProposeConceptMap={proposeConceptMap} />
        </BuilderSection>

        <BuilderSection section={SECTION.materials}>
          <MaterialsSection materials={b.materials} onChange={b.setMaterials} activityId={activityId} showHeading={false} />
        </BuilderSection>

        {/* 1.1.151 — soft hints; never blocking. */}
        <BuilderHints hints={hints} />
        {error}
        {footer}
      </div>

      {/* RIGHT — the live student preview, pinned beside the config on wide
          screens (1.1.40 M2) so the result is never hidden. */}
      <div className="lg:sticky lg:top-2 lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
        <ActivityPreview
          artefactId={b.artefactId}
          language={b.language}
          materials={b.materials}
          activityId={activityId}
          state={{
            checklist: b.checklist,
            table: b.table,
            chart: b.chart,
            calculator: b.calculator,
            note: b.note,
            writing: b.writing,
            solution: b.solution,
            document: b.document,
            conceptMap: b.conceptMap,
          }}
        />
      </div>
    </div>
  );
}

/** The "what is set, and change it here" rows at the top of the builder. */
function SummaryBlock({
  builder: b,
  tutorSummary,
  tutorChangeHref,
}: {
  builder: ActivityBuilder;
  tutorSummary?: ReactNode;
  tutorChangeHref: string;
}) {
  const t = useT("ActivitySummary");
  const tView = useT("StudentViewPicker");
  const [viewOpen, setViewOpen] = useState(false);
  // The opening auto-opens while any of its fields carries something, so a
  // teacher who wrote an introduction sees it, not a summary of it. Their own
  // open/close click wins from then on.
  const [openingChoice, setOpeningChoice] = useState<boolean | null>(null);
  const prompts = b.starterPrompts.filter((p) => p.trim()).length;
  const openingSet = Boolean(b.studentOpening.trim() || b.openingByTeacher || b.starterPrompts.length > 0);
  const openingOpen = openingChoice ?? openingSet;
  const openingParts = [
    b.openingByTeacher ? t("openingByTeacher") : b.studentOpening.trim() ? t("openingOwn") : t("openingDefault"),
    prompts > 0 ? t("openingPrompts", { count: prompts }) : t("openingDefaultPrompts"),
  ];

  return (
    <div
      data-testid="activity-summary"
      className="divide-y divide-border rounded-lg border border-border bg-background text-sm"
    >
      {tutorSummary !== undefined ? (
        <SummaryRow
          label={t("tutor")}
          value={tutorSummary}
          action={
            <Link
              href={tutorChangeHref}
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {t("changeInClass")}
            </Link>
          }
        />
      ) : null}
      <SummaryRow
        label={t("studentView")}
        value={
          <>
            <span className="font-medium text-foreground">{tView(`${b.studentView}_title`)}</span>
            <span className="text-muted-foreground"> · {tView(`${b.studentView}_desc`)}</span>
          </>
        }
        action={
          <ToggleLink
            open={viewOpen}
            onClick={() => setViewOpen((v) => !v)}
            controls="summary-student-view"
            label={t("studentView")}
          />
        }
      >
        {viewOpen ? (
          <div id="summary-student-view">
            <StudentViewPicker value={b.studentView} onChange={b.setStudentView} />
          </div>
        ) : null}
      </SummaryRow>
      <SummaryRow
        label={t("opening")}
        value={<span className="text-foreground">{openingParts.join(" · ")}</span>}
        action={
          <ToggleLink
            open={openingOpen}
            onClick={() => setOpeningChoice(!openingOpen)}
            controls="summary-opening"
            label={t("opening")}
          />
        }
      >
        {openingOpen ? (
          <div id="summary-opening">
            <ActivityOpeningEditor builder={b} />
          </div>
        ) : null}
      </SummaryRow>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  action,
  children,
}: {
  label: string;
  value: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 px-3 py-2.5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
        <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-36 sm:pt-0.5">
          {label}
        </span>
        <div className="min-w-0 flex-1">{value}</div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ToggleLink({
  open,
  onClick,
  controls,
  label,
}: {
  open: boolean;
  onClick: () => void;
  controls: string;
  label: string;
}) {
  const t = useT("ActivitySummary");
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={open ? t("closeAria", { label }) : t("changeAria", { label })}
      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
    >
      {open ? (
        <ChevronUp className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Pencil className="h-4 w-4" aria-hidden="true" />
      )}
      {open ? t("close") : t("change")}
    </button>
  );
}

/** Every hint the builder's current state earns (1.1.151). */
function collectBuilderHints(b: ActivityBuilder): BuilderHint[] {
  const labels = [
    ...b.table.flatMap((tbl) => [tbl.title, ...tbl.columns.map((c) => c.label)]),
    ...b.checklist.map((c) => c.label),
    ...b.writing.map((w) => w.title),
  ].filter((s): s is string => typeof s === "string" && s.trim() !== "");
  const hints: BuilderHint[] = [];
  const lang = languageHint({ language: b.language, title: b.title, teachingGoal: b.teachingGoal, labels });
  if (lang) hints.push(lang);
  // 1.1.151 F9 — duplicate column labels, untitled tables among several.
  hints.push(...tableHints(b.table));
  return hints;
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
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
