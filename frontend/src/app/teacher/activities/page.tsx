"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, ClipboardList, Copy, Plus, Users } from "lucide-react";

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
import { CompositionRow, VisibilityBadge } from "@/components/teacher/activityDisplay";
import { useT } from "@/i18n";
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
import type { CurriculumFacets, RagStatusEntry } from "@/lib/curriculumApi";
import { citedDocIds, FailedMaterialsWarning, useRagStatuses } from "@/components/teacher/FailedMaterialsWarning";
import { StudentsLanguageBadge } from "@/components/teacher/StudentsLanguageBadge";
import { useTryAsStudent } from "@/components/teacher/TryAsStudentButton";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { LoadError } from "@/components/ui/load-error";
import { RowMenu, type RowMenuItem } from "@/components/ui/row-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";
import { cn } from "@/lib/utils";

/** Which list the page shows. One at a time (UI sweep 2026-11-11): the stacked
 *  "Your activities" + "Shared activities" lists carried two full filter bars
 *  and ~90 controls on first render. */
type Segment = "mine" | "shared" | "all";
const SEGMENTS: Segment[] = ["mine", "shared", "all"];

/** The editor link. Carries `?classId=` when the activity runs in exactly one
 *  class, so the editor's preview and lint start from it. */
function editHref(activity: ActivityPayload, classIds?: Set<string>): string {
  const q = new URLSearchParams();
  if (classIds && classIds.size === 1) q.set("classId", [...classIds][0]);
  if (activity.title) q.set("title", activity.title);
  const qs = q.toString();
  return `/teacher/activities/${encodeURIComponent(activity.activityId)}${qs ? `?${qs}` : ""}`;
}

function activityName(a: ActivityPayload): string {
  return a.title || a.teachingGoal?.slice(0, 60) || a.activityId;
}

/**
 * Activities library (ALS-1 M1.2; UI sweep 2026-11-11).
 *
 * One list at a time: **Mine | Shared by colleagues | All teachers**, the last
 * for researchers only (it replaced the My library / Research view toggle of
 * 1.1.125). The choice is in the URL — `?view=shared`, `?scope=all` (the
 * retired research tree's redirect target) — and the getting-started
 * checklist's `#shared` deep link selects the second segment.
 *
 * Each own card has two visible actions, Edit and Assign ▾; the rare ones
 * (Try as student, Duplicate, File, Share / Make private, Delete) are in ⋯.
 * Sharing is an explicit, confirmed menu item — it used to be a one-click pill
 * that published the activity to every teacher.
 */
export default function TeacherActivitiesPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <ActivitiesLibrary />
    </Suspense>
  );
}

function ActivitiesLibrary() {
  const t = useT("ActivitiesPage");
  const confirm = useConfirm();
  const router = useRouter();
  const pathname = usePathname() ?? "/teacher/activities";
  const params = useSearchParams();
  const isResearcher = useIsResearcher();
  const { user } = useTeacherAuth({ redirectOnSignedOut: false });

  const requested: Segment =
    params?.get("scope") === "all" ? "all" : params?.get("view") === "shared" ? "shared" : "mine";
  // Researcher-only; the backend 403s anyone else, so a plain teacher on
  // `?scope=all` simply sees their own list.
  const segment: Segment = requested === "all" && !isResearcher ? "mine" : requested;
  const paramsString = params?.toString() ?? "";
  const setSegment = useCallback(
    (next: Segment) => {
      const sp = new URLSearchParams(paramsString);
      sp.delete("view");
      sp.delete("scope");
      if (next === "shared") sp.set("view", "shared");
      if (next === "all") sp.set("scope", "all");
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [paramsString, pathname, router],
  );
  // `#shared` — the getting-started checklist's "Adopt from the library" link
  // (1.1.124), from when the catalogue was a section anchored on this page.
  useEffect(() => {
    try {
      if (window.location.hash === "#shared" && requested !== "shared") setSegment("shared");
    } catch {
      /* server render */
    }
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<ActivityPayload[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<CurriculumFacets | null>(null);
  // One filter bar for the one visible list; switching lists starts unfiltered.
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const [filteredSegment, setFilteredSegment] = useState(segment);
  if (filteredSegment !== segment) {
    // React's "adjust state when a prop changes" pattern: during render, so the
    // new list's first fetch already goes out unfiltered.
    setFilteredSegment(segment);
    if (hasActiveFilters(filters)) setFilters(EMPTY_ACTIVITY_FILTERS);
  }
  // Only typing is debounced; chip clicks are deliberate. Clearing is
  // immediate, so a list switch never fetches with the previous search.
  const debouncedQ = useDebounced(filters.q);
  const effectiveQ = filters.q.trim() ? debouncedQ : "";
  const filterKey = JSON.stringify(toFilterParams({ ...filters, q: effectiveQ }));

  // 1.1.151 F1c — one batch status read for every doc the teacher's activities
  // cite, so a card can say "the tutor cannot read this" before the lesson.
  const citedIds = useMemo(
    () => (segment === "mine" ? items.flatMap((a) => citedDocIds(a.materials)) : []),
    [items, segment],
  );
  const { statuses: ragStatuses, update: updateRagStatus } = useRagStatuses(citedIds);

  // Filtering is server-side (the facets are derived from cited documents,
  // which the client cannot see), so every facet change is a round-trip.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    const p = { ...(JSON.parse(filterKey) as ReturnType<typeof toFilterParams>), limit: 200 };
    const request =
      segment === "shared"
        ? Promise.all([listSharedCatalogue(p), listActivityFacets({ published: true }, p).catch(() => null)])
        : Promise.all([
            listActivities(segment === "all" ? "all" : "own", p),
            listActivityFacets({ scope: segment === "all" ? "all" : "own" }, p).catch(() => null),
          ]);
    request
      .then(([page, f]) => {
        if (cancelled) return;
        setItems(page.activities);
        setTotal(page.total);
        setFacets(f);
        setStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [segment, filterKey, attempt]);

  // Classes load once — they are the assignment targets, not a filtered list.
  const [classes, setClasses] = useState<ClassPayload[]>([]);
  const [classesStatus, setClassesStatus] = useState<"loading" | "ok" | "error">("loading");
  const [classesAttempt, setClassesAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setClassesStatus("loading");
    listClasses()
      .then((cls) => {
        if (cancelled) return;
        setClasses(cls);
        setClassesStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setClassesStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [classesAttempt]);
  // activityId -> the classIds it is assigned to (reverse of Class.activityIds).
  const assignments = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of classes) {
      for (const aid of c.activityIds ?? []) {
        if (!map.has(aid)) map.set(aid, new Set());
        map.get(aid)!.add(c.classId);
      }
    }
    return map;
  }, [classes]);

  const [busyId, setBusyId] = useState<string | null>(null);
  // Which card has its filing editor open. One at a time.
  const [filingId, setFilingId] = useState<string | null>(null);

  const replaceItem = (updated: ActivityPayload) =>
    setItems((prev) => prev.map((a) => (a.activityId === updated.activityId ? updated : a)));

  async function toggleAssign(activityId: string, classId: string, assigned: boolean) {
    setBusyId(activityId);
    try {
      const updated = await patchClassActivities(classId, assigned ? { remove: [activityId] } : { add: [activityId] });
      // Reconcile from the authoritative returned class.
      setClasses((prev) => prev.map((c) => (c.classId === classId ? updated : c)));
    } catch {
      notify.error(t("assignFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(a: ActivityPayload) {
    const ok = await confirm({
      title: t("deleteConfirm", { title: activityName(a) }),
      description: t("deleteConfirmBody"),
      confirmLabel: t("deleteConfirmOk"),
      destructive: true,
    });
    if (!ok) return;
    setBusyId(a.activityId);
    try {
      await deleteActivity(a.activityId);
      setItems((prev) => prev.filter((x) => x.activityId !== a.activityId));
      setTotal((n) => Math.max(0, n - 1));
      notify.success(t("deleted", { title: activityName(a) }));
    } catch {
      notify.error(t("deleteFailed"));
    } finally {
      setBusyId(null);
    }
  }

  // M2: copy an activity into your library as a fresh draft. Prepended so it is
  // immediately visible.
  async function handleDuplicate(a: ActivityPayload) {
    setBusyId(a.activityId);
    try {
      const copy = await duplicateActivity(a.activityId);
      setItems((prev) => [copy, ...prev]);
      setTotal((n) => n + 1);
      notify.success(t("duplicated"));
    } catch {
      notify.error(t("duplicateFailed"));
    } finally {
      setBusyId(null);
    }
  }

  // Private ↔ Shared. Sharing asks first: it shows the activity to every
  // teacher, and it used to happen on one click of the status pill.
  async function handleVisibility(a: ActivityPayload, next: "private" | "published") {
    if (next === "published") {
      const ok = await confirm({
        title: t("shareConfirmTitle", { title: activityName(a) }),
        description: t("shareConfirmBody"),
        confirmLabel: t("shareConfirmOk"),
      });
      if (!ok) return;
    }
    setBusyId(a.activityId);
    try {
      replaceItem(await setActivityVisibility(a.activityId, next));
      notify.success(
        next === "published" ? t("sharedDone", { title: activityName(a) }) : t("privateDone", { title: activityName(a) }),
      );
    } catch {
      notify.error(t("visibilityFailed"));
    } finally {
      setBusyId(null);
    }
  }

  // M3.3: adopt another teacher's published activity → a draft copy in Mine.
  async function handleAdopt(a: ActivityPayload) {
    setBusyId(a.activityId);
    try {
      const copy = await adoptActivity(a.activityId);
      notify.success(t("adopted", { title: activityName(copy) }), {
        action: { label: t("openCopy"), onClick: () => router.push(editHref(copy)) },
      });
    } catch {
      notify.error(t("adoptFailed"));
    } finally {
      setBusyId(null);
    }
  }

  // The catalogue is for adopting OTHERS' work; your own shared activities are
  // under Mine.
  const shown = segment === "shared" && user?.uid ? items.filter((a) => a.ownerUid !== user.uid) : items;
  const count = shown.length;
  const subtitle =
    status === "ok" ? (total > items.length ? t("someOf", { count, total }) : t("count", { count })) : undefined;

  const segmentLabel = (s: Segment) => (s === "mine" ? t("mine") : s === "shared" ? t("sharedSegment") : t("research"));
  const visibleSegments = SEGMENTS.filter((s) => s !== "all" || isResearcher);

  return (
    <TeacherPage
      title={t("title")}
      subtitle={subtitle}
      actions={
        <Link href="/teacher/activities/new" className={buttonVariants({ variant: "primary", size: "md" })}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("new")}
        </Link>
      }
    >
      <SegmentTabs
        label={t("scope")}
        segments={visibleSegments}
        value={segment}
        onChange={setSegment}
        renderLabel={segmentLabel}
      />

      <div
        role="tabpanel"
        id={`activities-panel-${segment}`}
        aria-labelledby={`activities-tab-${segment}`}
        className="mt-4 flex flex-col gap-4"
      >
        {segment === "shared" ? (
          <p className="text-xs text-muted-foreground">
            {t.rich("sharedIntro", { b: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })}
          </p>
        ) : segment === "all" ? (
          <p className="text-xs text-muted-foreground">{t("researchHint")}</p>
        ) : null}

        {segment === "mine" && classesStatus === "error" ? (
          <div className="flex flex-col gap-1">
            <LoadError what={t("classesWhat")} onRetry={() => setClassesAttempt((n) => n + 1)} />
            <p className="text-xs text-muted-foreground">{t("classesFailedHint")}</p>
          </div>
        ) : null}

        {status !== "error" ? (
          <ActivityFilterBar facets={facets} filters={filters} onChange={setFilters} idPrefix={`library-${segment}`} />
        ) : null}

        {status === "loading" ? (
          <LibrarySkeleton />
        ) : status === "error" ? (
          <LoadError
            what={segment === "shared" ? t("sharedWhat") : t("what")}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : shown.length === 0 && hasActiveFilters(filters) ? (
          <EmptyState
            icon={ClipboardList}
            title={t("noMatch")}
            description={t("noMatchBody")}
            action={
              <button
                type="button"
                onClick={() => setFilters(EMPTY_ACTIVITY_FILTERS)}
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                {t("clearFilters")}
              </button>
            }
          />
        ) : shown.length === 0 && segment === "shared" ? (
          <EmptyState icon={Users} title={t("sharedEmpty")} />
        ) : shown.length === 0 && segment === "all" ? (
          <EmptyState icon={ClipboardList} title={t("researchEmpty")} description={t("researchEmptyBody")} />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t("emptyTitle")}
            description={t("emptyBody")}
            action={
              <Link href="/teacher/activities/new" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t("new")}
              </Link>
            }
          />
        ) : segment === "all" ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {shown.map((a) => (
              <li key={a.activityId}>
                <ResearchCard activity={a} />
              </li>
            ))}
          </ul>
        ) : segment === "shared" ? (
          <SharedActivities shared={shown} busyId={busyId} onAdopt={handleAdopt} />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {shown.map((a) => (
              <li key={a.activityId}>
                <ActivityCard
                  activity={a}
                  classes={classes}
                  classesReady={classesStatus === "ok"}
                  assignedClassIds={assignments.get(a.activityId) ?? new Set()}
                  busy={busyId === a.activityId}
                  onToggleAssign={(classId, assigned) => toggleAssign(a.activityId, classId, assigned)}
                  onDelete={() => void handleDelete(a)}
                  onDuplicate={() => void handleDuplicate(a)}
                  onSetVisibility={(next) => void handleVisibility(a, next)}
                  filingOpen={filingId === a.activityId}
                  onToggleFiling={() => setFilingId(filingId === a.activityId ? null : a.activityId)}
                  facets={facets}
                  onFacetsUpdated={replaceItem}
                  ragStatuses={ragStatuses}
                  onRagStatusUpdated={updateRagStatus}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </TeacherPage>
  );
}

/** The Mine | Shared | All control: real tabs, arrow keys move between them. */
function SegmentTabs({
  label,
  segments,
  value,
  onChange,
  renderLabel,
}: {
  label: string;
  segments: Segment[];
  value: Segment;
  onChange: (s: Segment) => void;
  renderLabel: (s: Segment) => string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = segments.indexOf(value);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % segments.length;
    if (e.key === "ArrowLeft") next = (i - 1 + segments.length) % segments.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = segments.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(segments[next]);
    refs.current[segments[next]]?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex max-w-full flex-wrap rounded-lg border border-border bg-muted/40 p-1 text-sm font-medium"
    >
      {segments.map((s) => {
        const selected = s === value;
        return (
          <button
            key={s}
            ref={(el) => {
              refs.current[s] = el;
            }}
            type="button"
            role="tab"
            id={`activities-tab-${s}`}
            aria-selected={selected}
            aria-controls={`activities-panel-${s}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(s)}
            className={cn(
              "rounded-md px-3 py-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
              selected ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {renderLabel(s)}
          </button>
        );
      })}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  );
}

/** A research-view card (1.1.125 M1): composition, the owner, the state — and a
 *  link to the EDITOR, which works on any activity for a researcher and says
 *  whose it is (1.1.123). */
function ResearchCard({ activity }: { activity: ActivityPayload }) {
  const t = useT("ActivitiesPage");
  return (
    <Link
      href={editHref(activity)}
      className="block rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="research-activity-link"
    >
      <TeacherCard className="transition-colors hover:border-foreground/30 hover:bg-muted/40">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold">{activityName(activity)}</h2>
          <VisibilityBadge visibility={activity.visibility} />
        </div>
        <CompositionRow activity={activity} />
        {activity.teachingGoal ? (
          <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <StudentsLanguageBadge language={activity.language} />
          <span className="truncate" data-testid="activity-owner" title={activity.ownerUid}>
            {t("owner", { label: activity.ownerLabel ?? activity.ownerUid })}
          </span>
        </div>
      </TeacherCard>
    </Link>
  );
}

/** Colleagues' published activities, grouped by owner, each copyable into Mine. */
function SharedActivities({
  shared,
  busyId,
  onAdopt,
}: {
  shared: ActivityPayload[];
  busyId: string | null;
  onAdopt: (a: ActivityPayload) => void;
}) {
  const t = useT("ActivitiesPage");
  // Group by owner, preserving the catalogue's newest-first order within a group.
  const groups = new Map<string, { label: string; items: ActivityPayload[] }>();
  for (const a of shared) {
    if (!groups.has(a.ownerUid)) groups.set(a.ownerUid, { label: a.ownerLabel ?? a.ownerUid, items: [] });
    groups.get(a.ownerUid)!.items.push(a);
  }
  return (
    <div className="flex flex-col gap-5">
      {Array.from(groups.entries()).map(([owner, group]) => (
        <div key={owner}>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
            {group.label}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {group.items.map((a) => (
              <li key={a.activityId}>
                <TeacherCard>
                  <h3 className="text-sm font-semibold">{activityName(a)}</h3>
                  <CompositionRow activity={a} />
                  {a.teachingGoal ? <p className="line-clamp-2 text-xs text-muted-foreground">{a.teachingGoal}</p> : null}
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <StudentsLanguageBadge language={a.language} />
                    <button
                      type="button"
                      onClick={() => onAdopt(a)}
                      disabled={busyId === a.activityId}
                      className={buttonVariants({ variant: "primary", size: "sm" })}
                      title={t("adoptTitle")}
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                      {t("adopt")}
                    </button>
                  </div>
                </TeacherCard>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** How the activity is filed: own facets and, visually distinct, the ones it
 *  inherits from its materials. Read-only; the editor opens from ⋯ → File. */
function FacetSummary({ activity }: { activity: ActivityPayload }) {
  const t = useT("ActivitiesPage");
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
        <span className="text-muted-foreground/70">{t("notFiled")}</span>
      ) : null}
    </div>
  );
}

function ActivityCard({
  activity,
  classes,
  classesReady,
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
  ragStatuses,
  onRagStatusUpdated,
}: {
  activity: ActivityPayload;
  classes: ClassPayload[];
  classesReady: boolean;
  assignedClassIds: Set<string>;
  busy: boolean;
  onToggleAssign: (classId: string, assigned: boolean) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetVisibility: (next: "private" | "published") => void;
  filingOpen: boolean;
  onToggleFiling: () => void;
  facets: CurriculumFacets | null;
  onFacetsUpdated: (updated: ActivityPayload) => void;
  ragStatuses: Record<string, RagStatusEntry>;
  onRagStatusUpdated: (docId: string, entry: RagStatusEntry) => void;
}) {
  const t = useT("ActivitiesPage");
  const tTry = useT("TryAsStudentButton");
  const isDraft = activity.visibility === "draft";
  const href = editHref(activity, assignedClassIds);
  const name = activityName(activity);
  const singleClass = assignedClassIds.size === 1 ? [...assignedClassIds][0] : undefined;
  const tryAsStudent = useTryAsStudent(activity.activityId, singleClass);
  const assignedNames = classes.filter((c) => assignedClassIds.has(c.classId)).map((c) => c.name);

  const menu: RowMenuItem[] = [
    // A draft is in no class (it cannot be assigned), so there is no student
    // view to open yet.
    ...(isDraft
      ? []
      : [
          {
            id: "try",
            label: tTry("label"),
            hint: tTry("hint"),
            onSelect: () => {
              // Inside the menu's select event, so the new tab is allowed.
              void tryAsStudent.open().then((err) => {
                if (err) notify.error(err);
              });
            },
          },
        ]),
    { id: "duplicate", label: t("duplicate"), hint: t("duplicateTitle"), onSelect: onDuplicate, disabled: busy },
    { id: "file", label: t("file"), onSelect: onToggleFiling },
    ...(isDraft
      ? []
      : activity.visibility === "published"
        ? [{ id: "private", label: t("makePrivate"), hint: t("makePrivateHint"), onSelect: () => onSetVisibility("private"), disabled: busy }]
        : [{ id: "share", label: t("share"), hint: t("shareHint"), onSelect: () => onSetVisibility("published"), disabled: busy }]),
    { id: "delete", label: t("delete"), danger: true, onSelect: onDelete, disabled: busy },
  ];

  return (
    <TeacherCard>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold">{name}</h2>
        {/* Read-only: changing it is an explicit item in ⋯. */}
        <VisibilityBadge visibility={activity.visibility} />
      </div>

      <CompositionRow activity={activity} />

      <FailedMaterialsWarning materials={activity.materials} statuses={ragStatuses} onUpdated={onRagStatusUpdated} />

      {activity.teachingGoal ? <p className="line-clamp-2 text-xs text-muted-foreground">{activity.teachingGoal}</p> : null}

      <FacetSummary activity={activity} />
      {filingOpen ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <ActivityFacetEditor activity={activity} facets={facets} onUpdated={onFacetsUpdated} />
          <button
            type="button"
            onClick={onToggleFiling}
            className="self-start text-xs font-medium text-primary hover:underline"
          >
            {t("done")}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <StudentsLanguageBadge language={activity.language} />
        {!isDraft ? (
          <span data-testid="activity-classes">
            {assignedNames.length > 0 ? t("inClasses", { classes: assignedNames.join(", ") }) : t("notAssigned")}
          </span>
        ) : null}
      </div>

      {/* A DRAFT is not assignable yet: it must be reviewed + saved (→ Private)
          first, so it shows the route there instead of Assign. */}
      {isDraft ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {t.rich("draftNotice", {
            b: (chunks) => <span className="font-medium">{chunks}</span>,
            link: (chunks) => (
              <Link href={href} className="font-medium underline hover:no-underline">
                {chunks}
              </Link>
            ),
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Link href={href} className={buttonVariants({ variant: "secondary", size: "sm" })}>
          {t("edit")}
        </Link>
        {!isDraft && classesReady ? (
          <AssignMenu
            title={name}
            classes={classes}
            assigned={assignedClassIds}
            busy={busy}
            onToggle={onToggleAssign}
          />
        ) : null}
        <span className="flex-1" />
        <RowMenu label={t("more", { title: name })} items={menu} />
      </div>
    </TeacherCard>
  );
}

/** "Assign ▾" — a checkbox per class. Stays open while ticking several. */
function AssignMenu({
  title,
  classes,
  assigned,
  busy,
  onToggle,
}: {
  title: string;
  classes: ClassPayload[];
  assigned: Set<string>;
  busy: boolean;
  onToggle: (classId: string, assigned: boolean) => void;
}) {
  const t = useT("ActivitiesPage");
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("assignAria", { title })}
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        {t("assign")}
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 max-h-80 min-w-[14rem] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          {classes.length === 0 ? (
            <p className="px-2.5 py-2 text-muted-foreground">{t("noClasses")}</p>
          ) : (
            classes.map((c) => {
              const on = assigned.has(c.classId);
              return (
                <DropdownMenu.CheckboxItem
                  key={c.classId}
                  checked={on}
                  disabled={busy}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => onToggle(c.classId, on)}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    <DropdownMenu.ItemIndicator>
                      <Check className="h-3 w-3" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {c.name}
                </DropdownMenu.CheckboxItem>
              );
            })
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
