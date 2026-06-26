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
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

/** Friendly names for the catalogued sim artefacts (fallback: the raw id). */
const SIM_NAMES: Record<string, string> = {
  boldkast: "Boldkast",
  "led-planck": "LED-Planck",
  kinebot: "KineBot",
};

/** The element fields we surface as composition badges, in display order. */
const ELEMENT_BADGES: { field: keyof ActivityPayload; label: string }[] = [
  { field: "checklist", label: "Checklist" },
  { field: "table", label: "Table" },
  { field: "chart", label: "Chart" },
  { field: "calculator", label: "Calculator" },
  { field: "note", label: "Note" },
  { field: "solution", label: "Solution" },
];

/**
 * What an activity is *made of* — the sim artefact, the teacher-authored
 * workbench elements, and any documents/materials. Derived entirely from the
 * listing payload (no extra fetch), so a teacher can see at a glance what each
 * activity actually uses without opening the editor.
 */
function composition(a: ActivityPayload): { key: string; label: string; kind: "sim" | "element" | "docs" }[] {
  const out: { key: string; label: string; kind: "sim" | "element" | "docs" }[] = [];
  if (a.artefactId) out.push({ key: "sim", label: SIM_NAMES[a.artefactId] ?? a.artefactId, kind: "sim" });
  for (const { field, label } of ELEMENT_BADGES) {
    const value = a[field];
    if (Array.isArray(value) && value.length > 0) {
      out.push({ key: field, label: value.length > 1 ? `${label} ${value.length}` : label, kind: "element" });
    }
  }
  const docs = (a.document?.length ?? 0) + (a.materials?.length ?? 0);
  if (docs > 0) out.push({ key: "docs", label: docs > 1 ? `${docs} documents` : "1 document", kind: "docs" });
  return out;
}

const NEW_ACTIVITY_PRIMARY =
  "inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90";
const NEW_ACTIVITY_SECONDARY =
  "inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent";

type View = "own" | "all";

/**
 * Activities library (ALS-1 M1.2). Lists the teacher's class-independent
 * activities, each card showing its composition (sim + elements + documents),
 * visibility, and — for the owner — an inline class-assignment control.
 *
 * Researchers (1.1.5) get a "My / All activities" toggle: the All view is a
 * read-only cross-teacher scan (GET /api/activities?scope=all) that shows the
 * owner and the composition for every activity, with no assign/edit/delete.
 */
export default function TeacherActivitiesPage() {
  const isResearcher = useIsResearcher();
  const [view, setView] = useState<View>("own");
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [activities, setActivities] = useState<ActivityPayload[]>([]);
  const [classes, setClasses] = useState<ClassPayload[]>([]);
  // activityId -> the classIds it's assigned to (reverse of Class.activityIds).
  const [assignments, setAssignments] = useState<Map<string, Set<string>>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  const readOnly = view === "all";

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
    // The All view is cross-teacher + read-only, so we don't need the caller's
    // classes there (assignment is owner-scoped and hidden).
    Promise.all([
      listActivities(view),
      view === "own" ? listClasses().catch(() => [] as ClassPayload[]) : Promise.resolve([] as ClassPayload[]),
    ])
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
  }, [view]);

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

  const count = activities.length;
  const subtitle =
    status === "ok"
      ? `${count} ${count === 1 ? "activity" : "activities"}${view === "all" ? " · all teachers" : ""}`
      : undefined;

  return (
    <TeacherPage
      title="Activities"
      subtitle={subtitle}
      actions={
        <div className="flex items-center gap-3">
          {isResearcher ? <ViewToggle view={view} onChange={setView} /> : null}
          <Link href="/teacher/activities/new" className={NEW_ACTIVITY_PRIMARY}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New activity
          </Link>
        </div>
      }
    >
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
          title={view === "all" ? "No activities yet" : "Your activities live here"}
          description={
            view === "all"
              ? "No teacher has created an activity yet."
              : "Create a from-scratch activity — a concept dialogue, a quiz, a lab notebook, or a sim — then assign it to one or more of your classes."
          }
          action={
            view === "all" ? undefined : (
              <Link href="/teacher/activities/new" className={NEW_ACTIVITY_SECONDARY}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                New activity
              </Link>
            )
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
                readOnly={readOnly}
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

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const base = "rounded px-2.5 py-1 text-xs font-medium transition-colors";
  const active = "bg-primary text-primary-foreground";
  const inactive = "text-muted-foreground hover:text-foreground";
  return (
    <div className="inline-flex items-center gap-0.5 rounded border border-border p-0.5" role="group" aria-label="Scope">
      <button type="button" className={`${base} ${view === "own" ? active : inactive}`} onClick={() => onChange("own")}>
        My activities
      </button>
      <button type="button" className={`${base} ${view === "all" ? active : inactive}`} onClick={() => onChange("all")}>
        All activities
      </button>
    </div>
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
  if (visibility === "published") {
    return (
      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
        Published
      </span>
    );
  }
  // private renders no badge — the normal student-facing state.
  return null;
}

/** The composition row: sim artefact + workbench elements + documents. */
function CompositionRow({ activity }: { activity: ActivityPayload }) {
  const parts = composition(activity);
  if (parts.length === 0) {
    return <p className="text-[11px] italic text-muted-foreground">Chat only — no workbench elements</p>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {parts.map((p) => (
        <span
          key={p.key}
          className={
            p.kind === "sim"
              ? "rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary"
              : "rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          }
        >
          {p.label}
        </span>
      ))}
    </div>
  );
}

function ActivityCard({
  activity,
  classes,
  assignedClassIds,
  busy,
  readOnly,
  onToggleAssign,
  onDelete,
}: {
  activity: ActivityPayload;
  classes: ClassPayload[];
  assignedClassIds: Set<string>;
  busy: boolean;
  readOnly: boolean;
  onToggleAssign: (classId: string, assigned: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {activity.title || activity.teachingGoal?.slice(0, 60) || activity.activityId}
        </h2>
        {/* Visibility (Draft/Published) only. The legacy workbench_type badge
            ("Sim"/"Concept dialogue") was dropped: it conflated the tutor skill
            with the student surface, and the composition row below already shows
            what the activity is made of. */}
        <VisibilityBadge visibility={activity.visibility} />
      </div>

      <CompositionRow activity={activity} />

      {activity.teachingGoal ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{activity.language === "da" ? "Dansk" : "English"}</span>
        {readOnly ? (
          <span className="truncate" data-testid="activity-owner" title={activity.ownerUid}>
            Owner: {activity.ownerLabel ?? activity.ownerUid}
          </span>
        ) : (
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
        )}
      </div>

      {/* Class assignment — chip toggles (own view only). Each chip is both the
          status and the control: filled = assigned, outline = not. */}
      {!readOnly && classes.length > 0 ? (
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
