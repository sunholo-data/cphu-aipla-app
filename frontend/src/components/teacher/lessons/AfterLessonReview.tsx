"use client";

// AfterLessonReview — the after-lesson guided read, in the right order
// (1.1.139 M3). JB's worry: teachers use the pieces in the wrong order, or not
// at all. Offered on the class page's Latest lesson card when the lesson had at
// least two groups and has not been reviewed; skippable, and remembered (per
// lesson, in this browser) either way.
//
// 1 what the class covered · 2 where it struggled · 3 how the tutor taught ·
// 4 which groups to look at · 5 next lesson, with "Add to next activity",
// which opens a new activity with the class "next time" as its teaching goal —
// the draft the authoring co-pilot reads as its starting brief.
//
// Reads only the lesson it is handed (a cached-only read): no model call.

import Link from "next/link";
import { useEffect, useState } from "react";

import { useT } from "@/i18n";
import type { LessonDetail } from "@/lib/lessonOverviewApi";

import { groupReportHref } from "./LessonOverview";

const STEPS = ["covered", "struggled", "approach", "groups", "next"] as const;

export function lessonReviewKey(lesson: Pick<LessonDetail, "classId" | "activityId" | "date">): string {
  return `aipla.lessonReview.${lesson.classId}.${lesson.activityId}.${lesson.date}`;
}

function readReviewed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function writeReviewed(key: string, value: "done" | "skipped"): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the review is offered again next visit, nothing worse.
  }
}

export function shouldOfferReview(lesson: LessonDetail): boolean {
  return lesson.coverage.groups >= 2;
}

export function newActivityBriefHref(lesson: LessonDetail, brief: string): string {
  const q = new URLSearchParams({ classId: lesson.classId, brief });
  return `/teacher/activities/new?${q.toString()}`;
}

export function AfterLessonReview({ lesson }: { lesson: LessonDetail }) {
  const t = useT("AfterLessonReview");
  const key = lessonReviewKey(lesson);
  // Start hidden; decide after mount so server and client render the same.
  const [offered, setOffered] = useState(false);
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    setOffered(shouldOfferReview(lesson) && !readReviewed(key));
    setStep(null);
  }, [key, lesson]);

  if (!offered) return null;

  const close = (value: "done" | "skipped") => {
    writeReviewed(key, value);
    setOffered(false);
    setStep(null);
  };

  if (step === null) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-muted/40 p-2 text-sm" data-testid="review-offer">
        <span>{t("offer")}</span>
        <button
          type="button"
          onClick={() => setStep(0)}
          className="rounded border border-border bg-background px-2.5 py-0.5 font-medium hover:bg-accent"
        >
          {t("start")}
        </button>
        <button type="button" onClick={() => close("skipped")} className="text-muted-foreground hover:underline">
          {t("skip")}
        </button>
      </div>
    );
  }

  const name = STEPS[step];
  const nextTime = lesson.synthesis?.nextTime || lesson.nextTime.groups[0]?.text || "";
  return (
    <section
      aria-label={t("label")}
      data-testid="review-wizard"
      className="flex flex-col gap-2 rounded border border-border bg-muted/30 p-3 text-sm"
    >
      <p className="text-xs text-muted-foreground">{t("progress", { n: step + 1, total: STEPS.length })}</p>
      <h3 className="font-semibold">{t(`step_${name}`)}</h3>
      <StepBody lesson={lesson} step={name} nextTime={nextTime} />
      <div className="flex flex-wrap items-center gap-2">
        {step > 0 ? (
          <button type="button" onClick={() => setStep(step - 1)} className="rounded border border-border px-2.5 py-0.5 hover:bg-accent">
            {t("back")}
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            className="rounded border border-border bg-background px-2.5 py-0.5 font-medium hover:bg-accent"
          >
            {t("next")}
          </button>
        ) : (
          <>
            {nextTime ? (
              <Link
                href={newActivityBriefHref(lesson, nextTime)}
                onClick={() => writeReviewed(key, "done")}
                className="rounded border border-primary px-2.5 py-0.5 font-medium text-primary hover:bg-accent"
              >
                {t("addToNext")}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => close("done")}
              className="rounded border border-border bg-background px-2.5 py-0.5 font-medium hover:bg-accent"
            >
              {t("finish")}
            </button>
          </>
        )}
        <button type="button" onClick={() => close("skipped")} className="ml-auto text-xs text-muted-foreground hover:underline">
          {t("skip")}
        </button>
      </div>
    </section>
  );
}

function StepBody({ lesson, step, nextTime }: { lesson: LessonDetail; step: (typeof STEPS)[number]; nextTime: string }) {
  const t = useT("AfterLessonReview");
  if (step === "covered") {
    const top = [...lesson.concepts]
      .sort(
        (a, b) =>
          b.counts.discussed + b.counts.struggled + b.counts.demonstrated -
          (a.counts.discussed + a.counts.struggled + a.counts.demonstrated),
      )
      .slice(0, 6);
    return top.length === 0 ? (
      <p className="text-muted-foreground">{t("noConcepts")}</p>
    ) : (
      <ul className="list-disc pl-5">
        {top.map((c) => (
          <li key={c.key}>
            {t("conceptGroups", {
              concept: c.label,
              n: c.counts.discussed + c.counts.struggled + c.counts.demonstrated,
            })}
          </li>
        ))}
      </ul>
    );
  }
  if (step === "struggled") {
    const hard = lesson.concepts.filter((c) => c.counts.struggled > 0);
    return hard.length === 0 ? (
      <p className="text-muted-foreground">{t("noStruggle")}</p>
    ) : (
      <ul className="list-disc pl-5">
        {hard.map((c) => (
          <li key={c.key}>{t("conceptGroups", { concept: c.label, n: c.counts.struggled })}</li>
        ))}
      </ul>
    );
  }
  if (step === "approach") {
    const a = lesson.approach;
    if (a.state === "no_framework") return <p>{t("noFramework")}</p>;
    return (
      <>
        <p className="text-muted-foreground">
          {t("coverage", { assessed: a.coverage.assessed ?? 0, groups: a.coverage.groups })}
        </p>
        <p>{lesson.synthesis?.approach || t("approachPending")}</p>
      </>
    );
  }
  if (step === "groups") {
    const flagged = lesson.groups.filter((g) => g.flags.length > 0);
    return flagged.length === 0 ? (
      <p className="text-muted-foreground">{t("noOutliers")}</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {flagged.map((g) => (
          <li key={g.groupCode}>
            <Link href={groupReportHref(lesson, g)} className="font-mono text-xs text-primary hover:underline">
              {g.groupCode}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return nextTime ? <p>{nextTime}</p> : <p className="text-muted-foreground">{t("noNext")}</p>;
}
