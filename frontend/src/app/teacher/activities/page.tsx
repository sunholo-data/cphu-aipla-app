"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Plus, Sliders, Trash2, Users } from "lucide-react";

import {
  type ActivityPayload,
  type ClassPayload,
  deleteActivity,
  listActivities,
  listClasses,
  patchClassActivities,
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
  document: "Document feedback",
};

const NEW_ACTIVITY_PRIMARY =
  "inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90";
const NEW_ACTIVITY_SECONDARY =
  "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent";

/**
 * Activities library (ALS-1 M1.2). Lists the teacher's class-independent
 * activities from /api/activities?owner=me. Each card shows its visibility, the
 * classes it's assigned to (chips), and an Assign-to-classes control + Edit +
 * Delete. An activity can now be assigned to several of the teacher's classes.
 */
export default function TeacherActivitiesPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [activities, setActivities] = useState<ActivityPayload[]>([]);
  const [classes, setClasses] = useState<ClassPayload[]>([]);
  // activityId -> the classIds it's assigned to (reverse of Class.activityIds).
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  function indexAssignments(cls: ClassPayload[]): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const c of cls) {
      for (const aid of c.activityIds ?? []) {
        if (!map.has(aid)) map.set(aid, new Set());
        map.get(aid)!.add(c.classId);
      }
    }
    return map;
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listActivities(), listClasses().catch(() => [] as ClassPayload[])])
      .then(([rows, cls]) => {
        if (cancelled) return;
        setActivities(rows);
        setClasses(cls);
        setAssignments(indexAssignments(cls));
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleAssign(activityId: string, classId: string, assigned: boolean) {
    setBusyId(activityId);
    try {
      const updated = await patchClassActivities(classId, assigned ? { remove: [activityId] } : { add: [activityId] });
      // Reconcile local state from the authoritative returned class.
      setClasses((prev) => prev.map((c) => (c.classId === classId ? updated : c)));
      setAssignments(indexAssignments(classes.map((c) => (c.classId === classId ? updated : c))));
    } catch {
      // Non-fatal; the next page load re-syncs.
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(activityId: string, title: string) {
    if (!window.confirm(`Delete "${title || activityId}"? Students assigned to it will no longer see it.`)) return;
    setBusyId(activityId);
    try {
      await deleteActivity(activityId);
      setActivities((prev) => prev.filter((a) => a.activityId !== activityId));
    } catch {
      // Non-fatal; surface nothing destructive happened.
    } finally {
      setBusyId(null);
    }
  }

  return (
    <TeacherPage
      title="Activities"
      subtitle={
        status === "ok" ? `${activities.length} ${activities.length === 1 ? "activity" : "activities"}` : undefined
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
          description="Create a from-scratch activity — a concept dialogue, a quiz, a lab notebook, or a sim — then assign it to one or more of your classes."
          action={
            <Link href="/teacher/activities/new" className={NEW_ACTIVITY_SECONDARY}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New activity
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {activities.map((a) => (
            <li key={a.activityId}>
              <ActivityCard
                activity={a}
                classes={classes}
                assignedClassIds={assignments.get(a.activityId) ?? new Set()}
                busy={busyId === a.activityId}
                onToggleAssign={(classId, assigned) => toggleAssign(a.activityId, classId, assigned)}
                onDelete={() => handleDelete(a.activityId, a.title ?? "")}
              />
            </li>
          ))}
        </ul>
      )}
    </TeacherPage>
  );
}

function VisibilityBadge({ visibility }: { visibility: ActivityPayload["visibility"] }) {
  if (visibility === "draft") {
    return (
      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
        Draft
      </span>
    );
  }
  // private / published render no badge — private is the normal student-facing state.
  return null;
}

function ActivityCard({
  activity,
  classes,
  assignedClassIds,
  busy,
  onToggleAssign,
  onDelete,
}: {
  activity: ActivityPayload;
  classes: ClassPayload[];
  assignedClassIds: Set<string>;
  busy: boolean;
  onToggleAssign: (classId: string, assigned: boolean) => void;
  onDelete: () => void;
}) {
  const assignedNames = classes.filter((c) => assignedClassIds.has(c.classId)).map((c) => c.name);
  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">{activity.title || activity.teachingGoal?.slice(0, 60) || activity.activityId}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <VisibilityBadge visibility={activity.visibility} />
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            {WORKBENCH_LABELS[activity.workbenchType ?? "none"] ?? activity.workbenchType}
          </span>
        </div>
      </div>

      <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
        {assignedNames.length > 0 ? (
          assignedNames.map((n) => (
            <span key={n} className="rounded bg-accent px-1.5 py-0.5 font-medium text-foreground">
              {n}
            </span>
          ))
        ) : (
          <span className="italic">Not assigned to a class yet</span>
        )}
      </p>

      {activity.teachingGoal ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity.language === "da" ? "Dansk" : "English"}</span>
        <div className="flex items-center gap-3">
          <Link
            href={`/teacher/activities/${encodeURIComponent(activity.activityId)}${activity.title ? `?title=${encodeURIComponent(activity.title)}` : ""}`}
            className="flex items-center gap-1 font-medium hover:text-foreground"
          >
            <Sliders className="h-3 w-3" aria-hidden="true" />
            Edit
          </Link>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="flex items-center gap-1 font-medium text-destructive hover:text-destructive/80 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>

      {classes.length > 0 ? (
        <fieldset className="rounded border border-border bg-muted/20 px-2 py-1.5 text-xs">
          <legend className="px-1 font-medium text-foreground">Assign to classes</legend>
          <div className="flex flex-col gap-1">
            {classes.map((c) => {
              const assigned = assignedClassIds.has(c.classId);
              return (
                <label key={c.classId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={assigned}
                    disabled={busy}
                    onChange={() => onToggleAssign(c.classId, assigned)}
                  />
                  <span>{c.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </TeacherCard>
  );
}
