"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ClipboardList, Plus, Sliders, Users } from "lucide-react";

import {
  listClasses,
  listMyActivities,
  type ActivityConfigPayload,
} from "@/lib/teacherApi";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

/** Human labels for the workbench-type badge (1.J types). */
const WORKBENCH_LABELS: Record<string, string> = {
  none: "Concept dialogue",
  app: "Sim",
  drawing: "Drawing board",
  notebook: "Lab notebook",
  sensor: "Experiment tool",
  video: "Video analysis",
};

const NEW_ACTIVITY_PRIMARY =
  "inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90";
const NEW_ACTIVITY_SECONDARY =
  "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent";

/**
 * Activities library — the Activities nav destination. Lists every activity
 * the teacher has configured (across their classes) from the real
 * /api/activity-configs list endpoint. Each row has a "Configure" link into
 * the real edit page (carrying classId + title so it loads live config +
 * curriculum materials) and an "Open class" link. "New activity" is the
 * create entry point.
 */
export default function TeacherActivitiesPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [activities, setActivities] = useState<ActivityConfigPayload[]>([]);
  // classId -> class name, so each activity card can show WHICH class it
  // belongs to (an activity is keyed per-class; without this the list looks
  // like a flat library when it isn't). Class fetch failure is non-fatal —
  // we fall back to the classId.
  const [classNames, setClassNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMyActivities(), listClasses().catch(() => [])])
      .then(([rows, classes]) => {
        if (cancelled) return;
        setActivities(rows);
        setClassNames(new Map(classes.map((c) => [c.classId, c.name])));
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <TeacherPage
      title="Activities"
      subtitle={
        status === "ok"
          ? `${activities.length} ${activities.length === 1 ? "activity" : "activities"}`
          : undefined
      }
      actions={
        <Link href="/teacher/activities/new" className={NEW_ACTIVITY_PRIMARY}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New activity
        </Link>
      }
    >
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading activities&hellip;</p>
      ) : status === "error" ? (
        <EmptyState
          icon={ClipboardList}
          title="Couldn’t load your activities"
          description="Something went wrong fetching the list. Try again in a moment."
        />
      ) : activities.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Your activities live here"
          description="Create a from-scratch activity — a concept dialogue, a quiz, a lab notebook, or a sim — and hand it to a class with a group code."
          action={
            <Link href="/teacher/activities/new" className={NEW_ACTIVITY_SECONDARY}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New activity
            </Link>
          }
        />
      ) : (
        <>
          <p className="mb-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Each activity belongs to the one class it was created in (shown on
            each card) — it isn&rsquo;t shared across classes yet. To use a
            similar activity in another class, create it from that class.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {activities.map((a) => {
              const className = classNames.get(a.classId) ?? a.classId;
              return (
                <li key={`${a.classId}:${a.activityId}`}>
              <TeacherCard>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold">
                    {a.title || a.teachingGoal?.slice(0, 60) || a.activityId}
                  </h2>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {WORKBENCH_LABELS[a.workbenchType ?? "none"] ?? a.workbenchType}
                  </span>
                </div>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="font-medium text-foreground">{className}</span>
                </p>
                {a.teachingGoal ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{a.teachingGoal}</p>
                ) : null}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>{a.language === "da" ? "Dansk" : "English"}</span>
                  <div className="flex items-center gap-3">
                    <Link
                      href={`/teacher/activities/${encodeURIComponent(a.activityId)}?classId=${encodeURIComponent(a.classId)}${a.title ? `&title=${encodeURIComponent(a.title)}` : ""}`}
                      className="flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      <Sliders className="h-3 w-3" aria-hidden="true" />
                      Configure
                    </Link>
                    <Link
                      href={`/teacher/classes/${encodeURIComponent(a.classId)}`}
                      className="flex items-center gap-1 font-medium hover:text-foreground"
                    >
                      Open class
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              </TeacherCard>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </TeacherPage>
  );
}
