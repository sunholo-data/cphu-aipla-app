"use client";

import { useState, type Ref } from "react";

import { TeachingGoalLint } from "@/components/teacher/TeachingGoalLint";
import { TemplatePicker, featuredTemplates, templateFamily, templateFeatures } from "@/components/teacher/TemplatePicker";
import type { ActivityBuilder } from "@/hooks/useActivityBuilder";
import { useT } from "@/i18n";
import { ACTIVITY_TEMPLATES, type ActivityTemplate } from "@/lib/activityTemplates";
import type { ClassPayload } from "@/lib/teacherApi";
import { runGoalLint } from "@/lib/teachingGoalLint";
import { cn } from "@/lib/utils";

/**
 * Wizard step 1 — "What should the students learn?" (2026-11-12). The goal is
 * the page's one question; the class and the name are prefilled (smart
 * defaults over questions, ui-simplify rule 7) and the examples sit below as
 * the alternative to typing.
 */
export function GoalStep({
  builder: b,
  classes,
  classId,
  onClassChange,
  goalRef,
  onGoalChange,
  onNameChange,
  nameSuggested,
  appliedTemplateId,
  onPickTemplate,
  onStartBlank,
}: {
  builder: ActivityBuilder;
  classes: ClassPayload[];
  classId: string;
  onClassChange: (classId: string) => void;
  goalRef?: Ref<HTMLTextAreaElement>;
  onGoalChange: (goal: string) => void;
  onNameChange: (name: string) => void;
  /** The name was filled from the goal, not typed. */
  nameSuggested: boolean;
  appliedTemplateId: string | null;
  onPickTemplate: (tpl: ActivityTemplate) => void;
  onStartBlank: () => void;
}) {
  const t = useT("ActivityWizard");
  const [pickingClass, setPickingClass] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const cls = classes.find((c) => c.classId === classId);

  return (
    <>
      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p className="flex flex-wrap items-center gap-x-2">
          <span>{t.rich("forClass", { className: cls?.name ?? "", b: (chunks) => <strong className="text-foreground">{chunks}</strong> })}</span>
          {classes.length > 1 ? (
            <>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                aria-expanded={pickingClass}
                aria-controls="wizard-class-picker"
                onClick={() => setPickingClass((v) => !v)}
                className="font-medium text-primary hover:underline"
              >
                {t("changeClass")}
              </button>
            </>
          ) : null}
        </p>
        {pickingClass ? (
          <div id="wizard-class-picker" className="flex max-w-sm flex-col gap-1">
            <label htmlFor="activity-class" className="text-sm font-medium text-foreground">
              {t("classLabel")}
            </label>
            <select
              id="activity-class"
              value={classId}
              onChange={(e) => {
                onClassChange(e.target.value);
                setPickingClass(false);
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
            >
              {classes.map((c) => (
                <option key={c.classId} value={c.classId}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          <label htmlFor="activity-goal">{t("goalHeading")}</label>
        </h1>
        <textarea
          ref={goalRef}
          id="activity-goal"
          aria-describedby="activity-goal-help"
          value={b.teachingGoal}
          onChange={(e) => onGoalChange(e.target.value)}
          // 1.1.141 M2 — lint once the teacher leaves the field; skipped when
          // this exact text was already linted (the backend caches too).
          onBlur={() => {
            if (b.goalLint?.text !== b.teachingGoal.trim()) {
              void runGoalLint(b.setGoalLint, b.teachingGoal, { classId });
            }
          }}
          placeholder={t("goalPlaceholder")}
          rows={6}
          maxLength={2000}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
        />
        <p id="activity-goal-help" className="text-sm text-muted-foreground">
          {t("goalHelp")}
        </p>
        <TeachingGoalLint builder={b} />
      </div>

      <div className="flex max-w-xl flex-col gap-1">
        <label htmlFor="activity-title" className="text-sm font-medium text-foreground">
          {t("name")}
        </label>
        <input
          id="activity-title"
          type="text"
          value={b.title}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("namePlaceholder")}
          maxLength={200}
          autoComplete="off"
          aria-describedby={nameSuggested && b.title ? "activity-title-help" : undefined}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {nameSuggested && b.title ? (
          <p id="activity-title-help" className="text-xs text-muted-foreground">
            {t("nameSuggested")}
          </p>
        ) : null}
      </div>

      <section aria-labelledby="wizard-examples" className="flex flex-col gap-3 border-t border-border pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="wizard-examples" className="text-sm font-semibold text-foreground">
            {t("examplesHeading")}
          </h2>
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showAll ? t("seeFewer") : t("seeAll", { count: ACTIVITY_TEMPLATES.length })}
          </button>
        </div>
        {showAll ? (
          <TemplatePicker onPick={onPickTemplate} onStartBlank={onStartBlank} appliedId={appliedTemplateId} />
        ) : (
          <ul aria-label={t("examplesAria")} className="grid gap-2 sm:grid-cols-2">
            {featuredTemplates().map((tpl) => (
              <li key={tpl.id}>
                <ExampleCard template={tpl} applied={appliedTemplateId === tpl.id} onPick={() => onPickTemplate(tpl)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ExampleCard({
  template: tpl,
  applied,
  onPick,
}: {
  template: ActivityTemplate;
  applied: boolean;
  onPick: () => void;
}) {
  const t = useT("ActivityWizard");
  const tTpl = useT("TemplatePicker");
  const fam = templateFamily(tpl);
  const Icon = fam.icon;
  const tools = templateFeatures(tpl).map((f) => tTpl(`feature_${f.key}`));
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={applied}
      className={cn(
        "flex h-full w-full items-start gap-3 rounded-lg border bg-background p-3 text-left transition-colors",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        applied ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40 hover:bg-primary/5",
      )}
    >
      <span aria-hidden="true" className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", fam.tile)}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{tpl.name}</span>
        <span className="text-xs text-muted-foreground">{tools.length ? tools.join(" · ") : t("conversationOnly")}</span>
      </span>
    </button>
  );
}
