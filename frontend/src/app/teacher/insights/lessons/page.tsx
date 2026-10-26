/**
 * /teacher/insights/lessons — the first Insights tab (1.1.139 M2).
 *
 * A class's lessons, newest first; a lesson is an (activity, date) pair. Pick
 * a class (remembered in the URL as `?class=`), open a lesson.
 */

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useT } from "@/i18n";
import { type LessonSummaryRow, fetchClassLessons, lessonHref } from "@/lib/lessonOverviewApi";
import { type ClassPayload, listClasses } from "@/lib/teacherApi";

export default function TeacherLessonsPage() {
  return (
    <Suspense fallback={null}>
      <LessonsPageInner />
    </Suspense>
  );
}

function LessonsPageInner() {
  const t = useT("TeacherLessonsPage");
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams?.get("class") ?? null;
  const [classes, setClasses] = useState<ClassPayload[] | null>(null);
  const [lessons, setLessons] = useState<LessonSummaryRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listClasses()
      .then((cs) => {
        if (!cancelled) setClasses(cs);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const classId =
    classes && classes.length > 0
      ? (classes.find((c) => c.classId === requested)?.classId ?? classes[0].classId)
      : null;

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    setLessons(null);
    setError(false);
    fetchClassLessons(classId)
      .then((rows) => {
        if (!cancelled) setLessons(rows);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("dashboard")}
        </Link>
      }
      title={t("title")}
      subtitle={t("subtitle")}
      actions={
        classes && classes.length > 0 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t("classLabel")}</span>
            <select
              value={classId ?? ""}
              onChange={(e) => router.replace(`/teacher/insights/lessons?class=${encodeURIComponent(e.target.value)}`)}
              className="h-8 rounded border border-border bg-background px-2 text-sm"
            >
              {classes.map((c) => (
                <option key={c.classId} value={c.classId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null
      }
    >
      <InsightsTabs />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("failed")}
        </p>
      ) : null}
      {classes && classes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noClasses")}</p> : null}
      {classId && lessons === null && !error ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : null}
      {lessons && lessons.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLessons")}</p> : null}
      {classId && lessons && lessons.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded border border-border" data-testid="lessons-list">
          {lessons.map((l) => (
            <li key={`${l.activityId}:${l.date}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">{l.activityTitle}</span>
                <span className="text-xs text-muted-foreground">
                  {l.date} · {t("groups", { n: l.groups })}
                </span>
              </div>
              <Link
                href={lessonHref(classId, l.activityId, l.date)}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("open")}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </TeacherPage>
  );
}
