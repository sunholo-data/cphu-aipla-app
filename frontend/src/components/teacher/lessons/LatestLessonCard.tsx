"use client";

// LatestLessonCard — the class page opens on its most recent lesson (1.1.139 M2).
//
// Sits at the top of the class page, directly above "Concepts across the class"
// (ClassConceptsOverview). It does NOT repeat the concept graph: it names the
// latest lesson, what the class struggled with in it, the class "next time"
// when one is already synthesised, and links to the full lesson overview.
//
// Cost: it asks for the lesson with `synthesis: "cached"`, so opening a class
// page never makes a model call. Renders nothing while loading, on a failed
// read, or for a class with no lessons yet — an empty card at the top of the
// page would be worse than none.

import Link from "next/link";
import { useEffect, useState } from "react";

import { AfterLessonReview } from "@/components/teacher/lessons/AfterLessonReview";
import { useT } from "@/i18n";
import {
  type LessonDetail,
  fetchClassLessons,
  fetchLesson,
  lessonHref,
} from "@/lib/lessonOverviewApi";

export function LatestLessonCard({ classId }: { classId: string }) {
  const t = useT("LatestLessonCard");
  const [lesson, setLesson] = useState<LessonDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLesson(null);
    fetchClassLessons(classId)
      .then((rows) => {
        const latest = rows[0];
        if (!latest || cancelled) return null;
        return fetchLesson(classId, latest.activityId, latest.date, { synthesis: "cached" });
      })
      .then((detail) => {
        if (!cancelled && detail) setLesson(detail);
      })
      .catch(() => {
        // Best-effort: the class page is fully usable without this card.
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  if (!lesson) return null;

  const struggled = lesson.concepts.filter((c) => c.counts.struggled > 0).slice(0, 4);
  const discussed = lesson.concepts.slice(0, 4);
  const shown = struggled.length > 0 ? struggled : discussed;
  const nextTime = lesson.synthesis?.nextTime || lesson.nextTime.groups[0]?.text || null;

  return (
    <section
      aria-labelledby="latest-lesson-title"
      data-testid="latest-lesson-card"
      className="flex flex-col gap-2 rounded border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="latest-lesson-title" className="text-base font-semibold">
          {t("title")}: {lesson.activityTitle}
        </h2>
        <span className="text-xs text-muted-foreground">
          {t("meta", { date: lesson.date, n: lesson.coverage.groups })}
          {lesson.coverage.pendingSessions > 0 ? ` · ${t("pending", { n: lesson.coverage.pendingSessions })}` : null}
        </span>
      </div>
      {shown.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <span className="text-xs text-muted-foreground">
            {struggled.length > 0 ? t("struggled") : t("discussed")}
          </span>
          {shown.map((c) => (
            <span key={c.key} className="rounded-full border border-border px-2 py-0.5 text-xs">
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
      {nextTime ? (
        <p className="text-sm">
          <span className="text-xs text-muted-foreground">{t("nextTime")}: </span>
          {nextTime}
        </p>
      ) : null}
      <AfterLessonReview lesson={lesson} />
      <div className="flex flex-wrap gap-3 text-sm">
        <Link href={lessonHref(classId, lesson.activityId, lesson.date)} className="font-medium text-primary hover:underline">
          {t("open")}
        </Link>
        <Link
          href={`/teacher/insights/lessons?class=${encodeURIComponent(classId)}`}
          className="text-muted-foreground hover:underline"
        >
          {t("allLessons")}
        </Link>
      </div>
    </section>
  );
}
