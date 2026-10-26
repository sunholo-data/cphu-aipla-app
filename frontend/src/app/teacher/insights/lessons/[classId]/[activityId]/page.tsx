/**
 * /teacher/insights/lessons/[classId]/[activityId]?date= — one lesson (1.1.139 M2).
 *
 * Concepts across the class, how the tutor taught (coverage first), what next,
 * then the groups. Opening this page may make ONE model call for the class
 * synthesis (cached server-side); per-group summaries are generated only when
 * the teacher presses "Summarise them now".
 */

"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { LessonOverview } from "@/components/teacher/lessons/LessonOverview";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { useT } from "@/i18n";
import { type LessonDetail, fetchLesson, summariseLesson } from "@/lib/lessonOverviewApi";

export default function TeacherLessonPage() {
  return (
    <Suspense fallback={null}>
      <LessonPageInner />
    </Suspense>
  );
}

type State = { kind: "loading" } | { kind: "ok"; lesson: LessonDetail } | { kind: "notFound" } | { kind: "error" };

function LessonPageInner() {
  const t = useT("TeacherLessonPage");
  const tOverview = useT("LessonOverview");
  const params = useParams();
  const searchParams = useSearchParams();
  const classId = typeof params?.classId === "string" ? decodeURIComponent(params.classId) : "";
  const activityId = typeof params?.activityId === "string" ? decodeURIComponent(params.activityId) : "";
  const date = searchParams?.get("date") ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [summarising, setSummarising] = useState(false);
  const [summariseError, setSummariseError] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!classId || !activityId || !date) return;
    let cancelled = false;
    fetchLesson(classId, activityId, date)
      .then((lesson) => {
        if (!cancelled) setState({ kind: "ok", lesson });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "";
        setState({ kind: / 404\b/.test(msg) ? "notFound" : "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [classId, activityId, date, reload]);

  const onSummarise = useCallback(() => {
    setSummarising(true);
    setSummariseError(false);
    summariseLesson(classId, activityId, date)
      .then(() => setReload((n) => n + 1))
      .catch(() => setSummariseError(true))
      .finally(() => setSummarising(false));
  }, [classId, activityId, date]);

  const lesson = state.kind === "ok" ? state.lesson : null;

  return (
    <TeacherPage
      breadcrumb={
        <Link
          href={`/teacher/insights/lessons?class=${encodeURIComponent(classId)}`}
          className="flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("lessons")}
        </Link>
      }
      title={lesson?.activityTitle ?? activityId}
      subtitle={lesson ? t("subtitle", { date: lesson.date, n: lesson.coverage.groups }) : date}
    >
      <InsightsTabs />
      {!date ? <p className="text-sm text-muted-foreground">{t("missingDate")}</p> : null}
      {date && state.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">{tOverview("loading")}</p>
      ) : null}
      {state.kind === "notFound" ? <p className="text-sm text-muted-foreground">{tOverview("notFound")}</p> : null}
      {state.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {tOverview("failed")}
        </p>
      ) : null}
      {lesson ? (
        <LessonOverview
          lesson={lesson}
          onSummarise={onSummarise}
          summarising={summarising}
          summariseError={summariseError}
        />
      ) : null}
    </TeacherPage>
  );
}
