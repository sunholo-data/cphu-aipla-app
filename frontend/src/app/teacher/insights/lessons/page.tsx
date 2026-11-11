/**
 * /teacher/insights/lessons — the first Insights tab (1.1.139 M2), and where
 * the main nav's Insights entry lands (UI sweep 2026-11-11).
 *
 * A class's lessons, newest first; a lesson is an (activity, date) pair. Pick
 * a class (remembered in the URL as `?class=`), open a lesson — the whole row
 * is the link. Dates read the way teachers recall lessons, by weekday
 * ("onsdag 11. nov."), not as an ISO string.
 */

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { LoadError } from "@/components/ui/load-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocaleMode, useT } from "@/i18n";
import type { Locale } from "@/i18n/locale";
import { formatLessonDay } from "@/components/teacher/insights/formatLessonDay";
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
  const mode = useLocaleMode();
  const locale: Locale = mode === "bilingual" ? "da" : mode;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams?.get("class") ?? null;
  const [classes, setClasses] = useState<ClassPayload[] | null>(null);
  const [classesFailed, setClassesFailed] = useState(false);
  const [reloadClasses, setReloadClasses] = useState(0);
  const [lessons, setLessons] = useState<LessonSummaryRow[] | null>(null);
  const [lessonsFailed, setLessonsFailed] = useState(false);
  const [reloadLessons, setReloadLessons] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setClassesFailed(false);
    listClasses()
      .then((cs) => {
        if (!cancelled) setClasses(cs);
      })
      .catch(() => {
        if (!cancelled) setClassesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadClasses]);

  const classId =
    classes && classes.length > 0
      ? (classes.find((c) => c.classId === requested)?.classId ?? classes[0].classId)
      : null;

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    setLessons(null);
    setLessonsFailed(false);
    fetchClassLessons(classId)
      .then((rows) => {
        if (!cancelled) setLessons(rows);
      })
      .catch(() => {
        if (!cancelled) setLessonsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, reloadLessons]);

  const loadingClasses = classes === null && !classesFailed;
  const loadingLessons = classId !== null && lessons === null && !lessonsFailed;

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("classesCrumb")}
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
      {classesFailed ? (
        <LoadError what={t("whatClasses")} onRetry={() => setReloadClasses((n) => n + 1)} />
      ) : null}
      {lessonsFailed ? (
        <LoadError what={t("whatLessons")} onRetry={() => setReloadLessons((n) => n + 1)} />
      ) : null}
      {classes && classes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noClasses")}</p> : null}
      {loadingClasses || loadingLessons ? (
        <div role="status" aria-label={t("loading")} className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : null}
      {lessons && lessons.length === 0 ? <p className="text-sm text-muted-foreground">{t("noLessons")}</p> : null}
      {classId && lessons && lessons.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded border border-border" data-testid="lessons-list">
          {lessons.map((l) => (
            <li key={`${l.activityId}:${l.date}`}>
              <Link
                href={lessonHref(classId, l.activityId, l.date)}
                className="flex items-center gap-3 p-3 hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <span className="w-40 shrink-0 text-sm text-muted-foreground" title={l.date}>
                  {formatLessonDay(l.date, locale)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.activityTitle}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{t("groups", { n: l.groups })}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </TeacherPage>
  );
}
