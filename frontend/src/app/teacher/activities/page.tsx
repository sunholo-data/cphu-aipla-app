"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Copy, Plus, Sliders, Trash2, Users } from "lucide-react";

import {
  type ActivityPayload,
  type ClassPayload,
  adoptActivity,
  deleteActivity,
  duplicateActivity,
  listActivities,
  listClasses,
  listSharedCatalogue,
  patchClassActivities,
  setActivityVisibility,
} from "@/lib/teacherApi";
import { CompositionRow, VISIBILITY_LABEL, visibilityColor } from "@/components/teacher/activityDisplay";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

const NEW_ACTIVITY_PRIMARY =
  "inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90";
const NEW_ACTIVITY_SECONDARY =
  "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent";

/**
 * Activities library (ALS-1 M1.2). The teacher's own class-independent
 * activities, each card showing its composition (sim + elements + documents), an
 * inline status control, and a class-assignment control — plus a "Shared
 * activities" catalogue of colleagues' published activities to adopt.
 *
 * The cross-teacher *research* scan (every teacher, all states, read-only) is a
 * separate researcher-only surface at `/teacher/research/activities` — this page
 * is purely the teacher's own working library.
 */
export default function TeacherActivitiesPage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [activities, setActivities] = useState<ActivityPayload[]>([]);
  // The cross-teacher shared catalogue (published, others' activities) — shown
  // below "Your activities" (ALS-SHARE M3.4).
  const [shared, setShared] = useState<ActivityPayload[]>([]);
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
    setStatus("loading");
    Promise.all([
      listActivities(), // own library only
      listClasses().catch(() => [] as ClassPayload[]),
      // The shared catalogue (colleagues' published activities). Non-fatal —
      // degrades to no section.
      listSharedCatalogue().catch(() => [] as ActivityPayload[]),
    ])
      .then(([rows, cls, catalogue]) => {
        if (cancelled) return;
        setActivities(rows);
        setClasses(cls);
        setAssignments(indexAssignments(cls));
        // Exclude the caller's OWN published activities — they're already above
        // in "Your activities"; the shared section is for adopting OTHERS'.
        const ownIds = new Set(rows.map((a) => a.activityId));
        setShared(catalogue.filter((a) => !ownIds.has(a.activityId)));
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

  // M2: copy an activity into your library as a fresh draft ("edit on top of an
  // existing one"). Prepends the new draft so it's immediately visible.
  async function handleDuplicate(activityId: string) {
    setBusyId(activityId);
    try {
      const copy = await duplicateActivity(activityId);
      setActivities((prev) => [copy, ...prev]);
    } catch {
      // Non-fatal; the next load re-syncs.
    } finally {
      setBusyId(null);
    }
  }

  // Set an activity's visibility via the single status control (draft/private/
  // published). Replace on success; the next load re-syncs on error.
  async function handleSetVisibility(activityId: string, visibility: ActivityPayload["visibility"]) {
    setBusyId(activityId);
    try {
      const updated = await setActivityVisibility(activityId, visibility);
      setActivities((prev) => prev.map((a) => (a.activityId === activityId ? updated : a)));
    } catch {
      // Non-fatal; the next load re-syncs.
    } finally {
      setBusyId(null);
    }
  }

  // M3.3: adopt another teacher's published activity → a draft copy in your
  // library. Prepends it so it's immediately visible in "Your activities".
  async function handleAdopt(activityId: string) {
    setBusyId(activityId);
    try {
      const copy = await adoptActivity(activityId);
      setActivities((prev) => [copy, ...prev]);
    } catch {
      // Non-fatal; the next load re-syncs.
    } finally {
      setBusyId(null);
    }
  }

  const count = activities.length;
  const subtitle =
    status === "ok" ? `${count} ${count === 1 ? "activity" : "activities"}` : undefined;

  return (
    <TeacherPage
      title="Activities"
      subtitle={subtitle}
      actions={
        <Link href="/teacher/activities/new" className={NEW_ACTIVITY_PRIMARY}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New activity
        </Link>
      }
    >
      {status === "ok" ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Set each activity&rsquo;s status with its chip —{" "}
          <span className="font-medium text-foreground">Private</span> (your classes only) or{" "}
          <span className="font-medium text-foreground">Shared</span> (other teachers can find and adopt a copy).
          Students only ever see activities you <span className="font-medium text-foreground">assign</span> to their
          class.
        </p>
      ) : null}
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading activities&hellip;</p>
      ) : status === "error" ? (
        <EmptyState
          icon={ClipboardList}
          title="Couldn’t load activities"
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
                onDuplicate={() => handleDuplicate(a.activityId)}
                onSetVisibility={(visibility) => handleSetVisibility(a.activityId, visibility)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* M3.4: the cross-teacher shared catalogue — colleagues' published
          activities, grouped by owner, each adoptable into your library. */}
      {status === "ok" && shared.length > 0 ? (
        <SharedActivitiesSection shared={shared} busyId={busyId} onAdopt={handleAdopt} />
      ) : null}
    </TeacherPage>
  );
}

/** The "Shared activities" section: other teachers' published activities grouped
 *  by owner, each with a "Use / adapt" (adopt-copy) action. */
function SharedActivitiesSection({
  shared,
  busyId,
  onAdopt,
}: {
  shared: ActivityPayload[];
  busyId: string | null;
  onAdopt: (activityId: string) => void;
}) {
  // Group by owner, preserving the catalogue's newest-first order within a group.
  const groups = new Map<string, { label: string; items: ActivityPayload[] }>();
  for (const a of shared) {
    const key = a.ownerUid;
    if (!groups.has(key)) groups.set(key, { label: a.ownerLabel ?? a.ownerUid, items: [] });
    groups.get(key)!.items.push(a);
  }
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">Shared activities</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Published by other teachers. <span className="font-medium">Use / adapt</span> copies one into your library as
        a draft you can edit and assign.
      </p>
      <div className="flex flex-col gap-5">
        {Array.from(groups.values()).map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
              {group.label}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.items.map((a) => (
                <li key={a.activityId}>
                  <SharedActivityCard
                    activity={a}
                    busy={busyId === a.activityId}
                    onAdopt={() => onAdopt(a.activityId)}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function SharedActivityCard({
  activity,
  busy,
  onAdopt,
}: {
  activity: ActivityPayload;
  busy: boolean;
  onAdopt: () => void;
}) {
  return (
    <TeacherCard>
      <h3 className="text-sm font-semibold">
        {activity.title || activity.teachingGoal?.slice(0, 60) || activity.activityId}
      </h3>
      <CompositionRow activity={activity} />
      {activity.teachingGoal ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity.language === "da" ? "Dansk" : "English"}</span>
        <button
          type="button"
          onClick={onAdopt}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          title="Copy into your library as a draft"
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
          Use / adapt
        </button>
      </div>
    </TeacherCard>
  );
}

const VISIBILITY_HELP =
  "Draft = a new copy to review · Private = your classes only · Shared = other teachers can adopt a copy. Students only ever see activities you assign.";

/** The single status control on an own card: shows the current state AND switches
 *  it (Draft / Private / Shared) in one place — replaces the old separate badge +
 *  Publish button. A freshly-copied Draft promotes to Private on first save;
 *  Shared lists it in the cross-teacher catalogue. */
function VisibilityControl({
  value,
  busy,
  onChange,
}: {
  value: ActivityPayload["visibility"];
  busy: boolean;
  onChange: (v: ActivityPayload["visibility"]) => void;
}) {
  return (
    <select
      aria-label="Visibility"
      value={value}
      disabled={busy}
      title={VISIBILITY_HELP}
      onChange={(e) => onChange(e.target.value as ActivityPayload["visibility"])}
      className={`shrink-0 cursor-pointer rounded border px-1.5 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${visibilityColor(value)}`}
    >
      {(["draft", "private", "published"] as const).map((v) => (
        <option key={v} value={v}>
          {VISIBILITY_LABEL[v]}
        </option>
      ))}
    </select>
  );
}

function ActivityCard({
  activity,
  classes,
  assignedClassIds,
  busy,
  onToggleAssign,
  onDelete,
  onDuplicate,
  onSetVisibility,
}: {
  activity: ActivityPayload;
  classes: ClassPayload[];
  assignedClassIds: Set<string>;
  busy: boolean;
  onToggleAssign: (classId: string, assigned: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetVisibility: (visibility: ActivityPayload["visibility"]) => void;
}) {
  const editHref = `/teacher/activities/${encodeURIComponent(activity.activityId)}${
    activity.title ? `?title=${encodeURIComponent(activity.title)}` : ""
  }`;
  const isDraft = activity.visibility === "draft";
  return (
    <TeacherCard>
      <h2 className="text-sm font-semibold">
        {activity.title || activity.teachingGoal?.slice(0, 60) || activity.activityId}
      </h2>

      <CompositionRow activity={activity} />

      {activity.teachingGoal ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity.language === "da" ? "Dansk" : "English"}</span>
        <div className="flex items-center gap-3">
          <Link href={editHref} className="flex items-center gap-1 font-medium hover:text-foreground">
            <Sliders className="h-3 w-3" aria-hidden="true" />
            Edit
          </Link>
          <button
            type="button"
            onClick={onDuplicate}
            disabled={busy}
            className="flex items-center gap-1 font-medium hover:text-foreground disabled:opacity-50"
            title="Duplicate as a new draft"
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            Duplicate
          </button>
          <VisibilityControl value={activity.visibility} busy={busy} onChange={onSetVisibility} />
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

      {/* Class assignment — a DRAFT is not assignable yet: it must be reviewed +
          saved (→ Private) first, so we show an explicit prompt instead of the
          chips. Each chip is both status and control: filled = assigned. */}
      {isDraft ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <span className="font-medium">Draft — not assignable yet.</span> Review and save it to make it Private, then
          assign it to a class.{" "}
          <Link href={editHref} className="font-medium underline hover:no-underline">
            Review &amp; save
          </Link>
        </div>
      ) : classes.length > 0 ? (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-foreground">
            <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
            Assign to classes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => {
              const assigned = assignedClassIds.has(c.classId);
              return (
                <button
                  key={c.classId}
                  type="button"
                  disabled={busy}
                  aria-pressed={assigned}
                  onClick={() => onToggleAssign(c.classId, assigned)}
                  className={
                    assigned
                      ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      : "rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                  }
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </TeacherCard>
  );
}
