"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, Copy, Lock, Plus, Share2, Sliders, Trash2, Users } from "lucide-react";

import {
  type ActivityPayload,
  type ClassPayload,
  adoptActivity,
  deleteActivity,
  duplicateActivity,
  listActivities,
  listActivityFacets,
  listClasses,
  listSharedCatalogue,
  patchClassActivities,
  setActivityVisibility,
} from "@/lib/teacherApi";
import { CompositionRow, VISIBILITY_LABEL, VisibilityBadge, visibilityColor } from "@/components/teacher/activityDisplay";
import {
  ActivityFilterBar,
  EMPTY_ACTIVITY_FILTERS,
  hasActiveFilters,
  toFilterParams,
  useDebounced,
  type ActivityFilters,
} from "@/components/teacher/ActivityFilterBar";
import { ActivityFacetEditor } from "@/components/teacher/ActivityFacetEditor";
import { InheritedChip } from "@/components/teacher/ui/FacetRow";
import type { CurriculumFacets } from "@/lib/curriculumApi";
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
  // 1.1.61 — filters for the two lists. Kept separate so narrowing your own
  // library does not silently narrow the catalogue underneath it.
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [sharedFilters, setSharedFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [facets, setFacets] = useState<CurriculumFacets | null>(null);
  const [sharedFacets, setSharedFacets] = useState<CurriculumFacets | null>(null);
  const [total, setTotal] = useState(0);
  const [sharedTotal, setSharedTotal] = useState(0);
  // Which row has its filing controls open. One at a time — the editor is a
  // detail, not the row's default state.
  const [filingId, setFilingId] = useState<string | null>(null);
  // Only the free-text box is debounced; chip clicks are deliberate.
  const debouncedQ = useDebounced(filters.q);
  const debouncedSharedQ = useDebounced(sharedFilters.q);

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

  // Classes load once — they are the assignment targets, not a filtered list.
  useEffect(() => {
    let cancelled = false;
    listClasses()
      .then((cls) => {
        if (cancelled) return;
        setClasses(cls);
        setAssignments(indexAssignments(cls));
      })
      .catch(() => {
        /* Non-fatal: the assignment control degrades to no classes. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Your library, re-fetched whenever the filters change. Filtering is
  // server-side (the facets are derived from cited documents, which the client
  // cannot see), so every facet change is a round-trip — hence the debounce on
  // the text box only.
  const ownParams = JSON.stringify(toFilterParams({ ...filters, q: debouncedQ }));
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const params = { ...(JSON.parse(ownParams) as ReturnType<typeof toFilterParams>), limit: 200 };
    Promise.all([listActivities("own", params), listActivityFacets({ scope: "own" }, params).catch(() => null)])
      .then(([page, f]) => {
        if (cancelled) return;
        setActivities(page.activities);
        setTotal(page.total);
        if (f) setFacets(f);
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [ownParams]);

  // The shared catalogue (colleagues' published activities). Non-fatal —
  // degrades to no section.
  const sharedParams = JSON.stringify(toFilterParams({ ...sharedFilters, q: debouncedSharedQ }));
  useEffect(() => {
    let cancelled = false;
    const params = { ...(JSON.parse(sharedParams) as ReturnType<typeof toFilterParams>), limit: 200 };
    Promise.all([
      listSharedCatalogue(params),
      listActivityFacets({ published: true }, params).catch(() => null),
    ])
      .then(([page, f]) => {
        if (cancelled) return;
        setShared(page.activities);
        setSharedTotal(page.total);
        if (f) setSharedFacets(f);
      })
      .catch(() => {
        if (!cancelled) setShared([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sharedParams]);

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

  // Exclude the caller's OWN published activities from the catalogue — they are
  // already above in "Your activities", and the catalogue is for adopting
  // OTHERS'. Derived rather than filtered at fetch time, because the two lists
  // now load independently and either can arrive first.
  const ownIds = new Set(activities.map((a) => a.activityId));
  const othersShared = shared.filter((a) => !ownIds.has(a.activityId));

  const count = activities.length;
  const subtitle =
    status === "ok"
      ? total > count
        ? `${count} of ${total} activities`
        : `${count} ${count === 1 ? "activity" : "activities"}`
      : undefined;

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
      {status !== "error" ? (
        <div className="mb-4">
          <ActivityFilterBar facets={facets} filters={filters} onChange={setFilters} idPrefix="library" />
        </div>
      ) : null}
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading activities&hellip;</p>
      ) : status === "error" ? (
        <EmptyState
          icon={ClipboardList}
          title="Couldn’t load activities"
          description="Something went wrong fetching the list. Try again in a moment."
        />
      ) : activities.length === 0 && hasActiveFilters(filters) ? (
        <EmptyState
          icon={ClipboardList}
          title="No activities match these filters"
          description="Nothing in your library matches. Clear a filter, or try a different search."
          action={
            <button
              type="button"
              onClick={() => setFilters(EMPTY_ACTIVITY_FILTERS)}
              className={NEW_ACTIVITY_SECONDARY}
            >
              Clear filters
            </button>
          }
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
                filingOpen={filingId === a.activityId}
                onToggleFiling={() => setFilingId(filingId === a.activityId ? null : a.activityId)}
                facets={facets}
                onFacetsUpdated={(updated) =>
                  setActivities((prev) => prev.map((x) => (x.activityId === updated.activityId ? updated : x)))
                }
              />
            </li>
          ))}
        </ul>
      )}

      {/* M3.4: the cross-teacher shared catalogue — colleagues' published
          activities, grouped by owner, each adoptable into your library. */}
      {status === "ok" && (othersShared.length > 0 || hasActiveFilters(sharedFilters)) ? (
        <SharedActivitiesSection
          shared={othersShared}
          busyId={busyId}
          onAdopt={handleAdopt}
          facets={sharedFacets}
          filters={sharedFilters}
          onFiltersChange={setSharedFilters}
          total={sharedTotal}
        />
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
  facets,
  filters,
  onFiltersChange,
  total,
}: {
  shared: ActivityPayload[];
  busyId: string | null;
  onAdopt: (activityId: string) => void;
  facets: CurriculumFacets | null;
  filters: ActivityFilters;
  onFiltersChange: (next: ActivityFilters) => void;
  total: number;
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
      {/* The catalogue is where filtering earns the most: it is the only
          cross-teacher discovery surface, and before 1.1.61 it could only be
          scrolled. */}
      <div className="mb-3">
        <ActivityFilterBar facets={facets} filters={filters} onChange={onFiltersChange} idPrefix="catalogue" />
      </div>
      {shared.length === 0 ? (
        <p className="text-sm text-muted-foreground">No shared activities match these filters.</p>
      ) : null}
      {total > shared.length ? (
        <p className="mb-2 text-xs text-muted-foreground">
          Showing {shared.length} of {total}.
        </p>
      ) : null}
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

/** The status pill on an own card: shows the current state AND toggles it between
 *  the two user-settable states, Private ↔ Shared, in one click. **Draft is not
 *  offered** — it is a system state (set on copy/adopt, cleared by
 *  review-and-save), so a draft card renders a read-only Draft pill instead. */
function VisibilityControl({
  value,
  busy,
  onChange,
}: {
  value: "private" | "published";
  busy: boolean;
  onChange: (v: ActivityPayload["visibility"]) => void;
}) {
  const next: "private" | "published" = value === "private" ? "published" : "private";
  const Icon = value === "published" ? Share2 : Lock;
  return (
    <button
      type="button"
      aria-label={`Visibility: ${VISIBILITY_LABEL[value]}. Click to make ${VISIBILITY_LABEL[next]}.`}
      disabled={busy}
      title={`Click to make ${VISIBILITY_LABEL[next]}. ${VISIBILITY_HELP}`}
      onClick={() => onChange(next)}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 ${visibilityColor(value)}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {VISIBILITY_LABEL[value]}
    </button>
  );
}

/** The card's one-line "how is this filed" summary + the toggle for the editor.
 *  Inherited facets are shown alongside own ones but visually distinct, so the
 *  answer to "why is this under Fysik?" is on the card rather than two clicks
 *  away. */
function ActivityFacetSummary({
  activity,
  open,
  onToggle,
}: {
  activity: ActivityPayload;
  open: boolean;
  onToggle: () => void;
}) {
  const own = [activity.subject, activity.level, ...(activity.tags ?? [])].filter(Boolean) as string[];
  const inherited = [
    ...(activity.inheritedSubjects ?? []),
    ...(activity.inheritedLevels ?? []),
    ...(activity.inheritedTags ?? []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {own.map((v) => (
        <span key={`own-${v}`} className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
          {v}
        </span>
      ))}
      {inherited.map((v) => (
        <InheritedChip key={`inh-${v}`} label={v} />
      ))}
      {own.length === 0 && inherited.length === 0 ? (
        <span className="text-muted-foreground/70">Not filed</span>
      ) : null}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="text-muted-foreground underline hover:text-foreground"
      >
        {open ? "Done" : "File"}
      </button>
    </div>
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
  filingOpen,
  onToggleFiling,
  facets,
  onFacetsUpdated,
}: {
  activity: ActivityPayload;
  classes: ClassPayload[];
  assignedClassIds: Set<string>;
  busy: boolean;
  onToggleAssign: (classId: string, assigned: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetVisibility: (visibility: ActivityPayload["visibility"]) => void;
  filingOpen: boolean;
  onToggleFiling: () => void;
  facets: CurriculumFacets | null;
  onFacetsUpdated: (updated: ActivityPayload) => void;
}) {
  const editHref = `/teacher/activities/${encodeURIComponent(activity.activityId)}${
    activity.title ? `?title=${encodeURIComponent(activity.title)}` : ""
  }`;
  const isDraft = activity.visibility === "draft";
  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {activity.title || activity.teachingGoal?.slice(0, 60) || activity.activityId}
        </h2>
        {/* Status pill, top-right. A Draft is read-only (system state, resolved by
            review-and-save); Private/Shared switch in place via the control. */}
        {activity.visibility === "draft" ? (
          <VisibilityBadge visibility="draft" />
        ) : (
          <VisibilityControl value={activity.visibility} busy={busy} onChange={onSetVisibility} />
        )}
      </div>

      <CompositionRow activity={activity} />

      {activity.teachingGoal ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
      ) : null}

      {/* 1.1.61 — how this activity is filed. At rest it is a one-line summary
          of own + inherited facets; the editor opens on demand, because filing
          is an occasional act and the card's job is mostly to show composition. */}
      <ActivityFacetSummary activity={activity} open={filingOpen} onToggle={onToggleFiling} />
      {filingOpen ? (
        <ActivityFacetEditor activity={activity} facets={facets} onUpdated={onFacetsUpdated} />
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
