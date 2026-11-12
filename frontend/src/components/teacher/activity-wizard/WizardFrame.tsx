"use client";

import { Check, ChevronRight, ClipboardCheck, LayoutGrid, Target, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ActivityPreview } from "@/components/teacher/ActivityPreview";
import { useCopilotBottomInset } from "@/components/teacher/copilot/CopilotEntryContext";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The frame every step of the new-activity wizard sits in (2026-11-12): the
 * title and the stepper on top, the step's column beside the live student
 * preview, and one sticky footer with the step's single primary action.
 *
 * Steps for a first-time flow, sections for editing (ui-simplify rule 6): the
 * editor (`activities/[id]`) keeps `ActivityBuilderBody`'s sections.
 */

export type WizardStep = 1 | 2 | 3;
export const WIZARD_STEPS: readonly WizardStep[] = [1, 2, 3];

const STEP_META: Record<WizardStep, { key: "step_goal" | "step_tools" | "step_review"; icon: LucideIcon }> = {
  1: { key: "step_goal", icon: Target },
  2: { key: "step_tools", icon: LayoutGrid },
  3: { key: "step_review", icon: ClipboardCheck },
};

export function WizardStepper({
  step,
  reachable,
  onGo,
}: {
  step: WizardStep;
  /** The furthest step the teacher may jump to from here. */
  reachable: WizardStep;
  onGo: (step: WizardStep) => void;
}) {
  const t = useT("ActivityWizard");
  return (
    <nav aria-label={t("stepsAria")}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-xs sm:gap-x-2 sm:text-sm">
        {WIZARD_STEPS.map((n, i) => {
          const { key, icon: Icon } = STEP_META[n];
          const current = n === step;
          const done = n < step;
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  current && "border-primary bg-primary text-primary-foreground",
                  done && "border-primary text-primary",
                  !current && !done && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span>{t(key)}</span>
              {done ? <span className="sr-only">{` (${t("stepDone")})`}</span> : null}
            </>
          );
          const tone = current
            ? "font-semibold text-primary"
            : done
              ? "font-medium text-foreground"
              : "text-muted-foreground";
          return (
            <li key={n} className="flex items-center gap-1 sm:gap-2">
              {!current && n <= reachable ? (
                <button
                  type="button"
                  onClick={() => onGo(n)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
                    tone,
                  )}
                >
                  {body}
                </button>
              ) : (
                <span aria-current={current ? "step" : undefined} className={cn("flex items-center gap-1.5 px-1 py-0.5", tone)}>
                  {body}
                </span>
              )}
              {i < WIZARD_STEPS.length - 1 ? (
                <ChevronRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The title row: "New activity" and the stepper. The step's own question is
 *  its h1, so this title is not a heading. */
export function WizardHeader({ stepper }: { stepper: ReactNode }) {
  const t = useT("ActivityWizard");
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
      <p className="text-base font-semibold text-foreground">{t("title")}</p>
      {stepper}
    </div>
  );
}

/** Step column beside the live preview; on step 3 the preview gets the room. */
export function WizardColumns({ big = false, main, preview }: { big?: boolean; main: ReactNode; preview: ReactNode }) {
  return (
    <div
      className={cn(
        "grid items-start gap-6",
        big ? "lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,44rem)_minmax(0,1fr)]",
      )}
    >
      <div className="flex min-w-0 flex-col gap-5">{main}</div>
      <div className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">{preview}</div>
    </div>
  );
}

/** The live student preview, fed from the builder exactly as the editor's is. */
export function WizardPreview({ builder: b, activityId }: { builder: ActivityBuilder; activityId?: string }) {
  return (
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
  );
}

/** The sticky footer: one secondary action, where the teacher is, one primary. */
export function WizardFooter({
  step,
  secondary,
  primary,
  hint,
  hintId,
}: {
  step: WizardStep;
  secondary: ReactNode;
  primary: ReactNode;
  /** Why the primary action is not available yet, when it is not. */
  hint?: string | null;
  hintId?: string;
}) {
  const t = useT("ActivityWizard");
  return (
    <div
      // Lifts the co-pilot's pill and panel above this footer's primary action.
      ref={useCopilotBottomInset<HTMLDivElement>()}
      data-testid="wizard-footer"
      className="sticky bottom-0 z-10 mt-2 border-t border-border bg-background/95 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="shrink-0">{secondary}</div>
        <p className="order-last w-full text-center text-xs text-muted-foreground sm:order-none sm:w-auto sm:flex-1">
          {t("stepOf", { n: step, total: WIZARD_STEPS.length })}
          {hint ? (
            <span id={hintId} className="block">
              {hint}
            </span>
          ) : null}
        </p>
        <div className="flex min-w-0 justify-end">{primary}</div>
      </div>
    </div>
  );
}
