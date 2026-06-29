"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  FileText,
  Loader2,
  Plus,
  Settings,
  Trash2,
  Users,
} from "lucide-react";

import {
  type ActivityPayload,
  type ClassPayload,
  type PersonaPayload,
  type SessionRow,
  type SkillSummary,
  createClass,
  deleteClass,
  fetchPersonaCatalogue,
  listAccessibleSkills,
  listActivities,
  listClassRecentSessions,
  listClasses,
} from "@/lib/teacherApi";
import {
  fetchInsightsCompare,
  fetchInsightsSummary,
  type InsightsClassSummary,
  type InsightsComparePayload,
} from "@/lib/insightsApi";
import {
  type TeacherSpendPayload,
  fetchTeacherSpend,
  formatEur,
} from "@/lib/costApi";
import { CrossClassTable } from "@/components/teacher/insights/CrossClassTable";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { ManageClassCopilot } from "./_ManageClassCopilot";


function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export default function TeacherClassesPage() {
  const [classes, setClasses] = useState<ClassPayload[] | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [catalogue, setCatalogue] = useState<SkillSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNewClassForm, setShowNewClassForm] = useState(false);
  const [insightsSummary, setInsightsSummary] = useState<Map<string, InsightsClassSummary>>(new Map());
  const [insightsCompare, setInsightsCompare] = useState<InsightsComparePayload | null>(null);
  // BigQuery-backed insights (per-card KPIs + cross-class compare) are
  // deferred — loaded on demand so the class list opens fast (Firestore-only).
  const [showInsights, setShowInsights] = useState(false);
  // True only while the insights round-trip is in flight — lets the KPI strip
  // distinguish "loading" from "no activity yet" (and the cards suppress the
  // strip entirely until insights are requested, so they don't show a
  // misleading perpetual "Loading engagement…").
  const [insightsLoading, setInsightsLoading] = useState(false);
  // Research view (sprint 1.1.5): researchers can switch to a cross-class
  // list of every teacher's classes. Toggle is hidden for non-researchers;
  // the backend independently rejects scope=all without the claim.
  const isResearcher = useIsResearcher();
  const [researchView, setResearchView] = useState(false);

  // Persona catalogue (1.1.32) — resolve each class's default persona id to a
  // display name in the table. defaultId is the global fallback a class
  // inherits when it has no explicit persona.
  const [personaById, setPersonaById] = useState<Map<string, PersonaPayload>>(new Map());
  const [defaultPersonaId, setDefaultPersonaId] = useState<string | null>(null);
  // The activity library (new model), keyed by activity id, so the table
  // resolves each class's assigned `activityIds` to its title — matching the
  // class-detail view. (The old path read `lessons` + activity_configs, which
  // are empty on new-model activities, so the column wrongly showed "None yet".)
  const [activityById, setActivityById] = useState<Map<string, ActivityPayload>>(new Map());
  // Delete-class flow: the class pending confirmation, the in-flight id, and a
  // surfaced error (never a silent failure).
  const [confirmDelete, setConfirmDelete] = useState<ClassPayload | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Teacher-level + per-class spend (1.1.9 follow-up). Loaded on demand with
  // the rest of the insights; non-fatal.
  const [teacherSpend, setTeacherSpend] = useState<TeacherSpendPayload | null>(null);
  const [spendLoading, setSpendLoading] = useState(false);

  // Skill displayName lookup so we can fall back to the lesson name when a
  // session hasn't generated a title yet (titles are auto-generated after
  // turn 2; row #1 of a fresh session would otherwise read "1 turn · just
  // now" with no identifier).
  const skillNameById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const s of catalogue) m.set(s.skillId, s.displayName || s.name);
    return m;
  }, [catalogue]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await listClasses(researchView ? "all" : "own");
      setClasses(list);
      // Recent-sessions fan-out is per-class; in Research view that can be
      // every teacher's class, so skip it there (the per-class drill-down
      // remains the way to inspect another teacher's sessions).
      if (researchView) {
        setRecentSessions([]);
        return;
      }
      // Fetch recent student sessions across all classes (per-class endpoint
      // queries by groupCode, so only student sessions appear here).
      // allSettled, not all: one class's fetch failing shouldn't blank the
      // whole strip or take down the (already-loaded) classes table — the
      // strip degrades to the classes that did load.
      const batches = await Promise.allSettled(
        list.map((c) => listClassRecentSessions(c.classId)),
      );
      const merged = batches
        .flatMap((b) => (b.status === "fulfilled" ? b.value : []))
        .sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime(),
        )
        .slice(0, 10);
      setRecentSessions(merged);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "failed to load classes",
      );
    }
  }, [researchView]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Fetch the lesson catalogue once for the title-fallback lookup.
  useEffect(() => {
    void listAccessibleSkills()
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

  // Persona catalogue — to label each class's tutor persona. Non-fatal.
  useEffect(() => {
    void fetchPersonaCatalogue()
      .then((cat) => {
        setPersonaById(new Map(cat.personas.map((p) => [p.id, p])));
        setDefaultPersonaId(cat.defaultId);
      })
      .catch(() => {
        /* persona column degrades to the default label */
      });
  }, []);

  // The activity library so the table can resolve each class's assigned
  // `activityIds` to a title. Research view pulls the cross-teacher library
  // (researcher-only scope=all) so other teachers' activity titles resolve too;
  // own view pulls the caller's. Non-fatal — falls back to the id.
  useEffect(() => {
    void listActivities(researchView ? "all" : "own")
      .then((acts) => setActivityById(new Map(acts.map((a) => [a.activityId, a]))))
      .catch(() => setActivityById(new Map()));
  }, [researchView]);

  // One round-trip for the per-card KPI strips (M9). Failure is
  // silent: the cards still render without the strip. Deferred behind
  // showInsights so it doesn't fire BigQuery on every class-list open.
  useEffect(() => {
    if (!showInsights) return;
    let cancelled = false;
    setInsightsLoading(true);
    void fetchInsightsSummary()
      .then((p) => {
        if (cancelled) return;
        setInsightsSummary(new Map(p.classes.map((c) => [c.classId, c])));
      })
      .catch(() => {
        if (!cancelled) setInsightsSummary(new Map());
      })
      .finally(() => {
        if (!cancelled) setInsightsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [classes, showInsights]);

  // Cross-class compare payload — only fetched when the teacher owns
  // 2+ classes AND has opted into insights. The single-class case has no
  // useful comparison and would just push the existing surfaces down.
  useEffect(() => {
    if (!showInsights || !classes || classes.length < 1) {
      setInsightsCompare(null);
      return;
    }
    let cancelled = false;
    void fetchInsightsCompare()
      .then((p) => {
        if (!cancelled) setInsightsCompare(p);
      })
      .catch(() => {
        if (!cancelled) setInsightsCompare(null);
      });
    return () => {
      cancelled = true;
    };
  }, [classes, showInsights]);

  // Teacher-level + per-class spend — loaded with the insights panel. Scoped
  // to the caller's own classes, so skipped in research view. Non-fatal.
  useEffect(() => {
    if (!showInsights || researchView) {
      setTeacherSpend(null);
      return;
    }
    let cancelled = false;
    setSpendLoading(true);
    void fetchTeacherSpend()
      .then((p) => {
        if (!cancelled) setTeacherSpend(p);
      })
      .catch(() => {
        if (!cancelled) setTeacherSpend(null);
      })
      .finally(() => {
        if (!cancelled) setSpendLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showInsights, researchView]);

  // Resolve a class's assigned activities to {id, title} from the new model
  // (`activityIds` → the activity library), matching the class-detail view. The
  // id rides along so the list can link each title to its editor. Falls back to
  // the id as the title when it can't be resolved.
  const activitiesForClass = useCallback(
    (cls: ClassPayload): { activityId: string; title: string }[] =>
      (cls.activityIds ?? []).map((id) => ({
        activityId: id,
        title: activityById.get(id)?.title?.trim() || id,
      })),
    [activityById],
  );

  // Resolve a class's tutor persona to a display label. A class with no
  // explicit persona inherits the global default; mark that so it reads as
  // inherited rather than chosen.
  const personaLabelForClass = useCallback(
    (cls: ClassPayload): { name: string; inherited: boolean; avatar: string } => {
      const explicit = cls.persona ?? null;
      const id = explicit ?? defaultPersonaId;
      const p = id ? personaById.get(id) : undefined;
      return {
        name: p?.name || "Default tutor",
        inherited: !explicit,
        avatar: p?.avatar || "",
      };
    },
    [personaById, defaultPersonaId],
  );

  // Teacher-level engagement totals — summed across the per-class summaries
  // (no extra fetch). Shown at the top of the insights panel so a teacher sees
  // their whole cohort at a glance, not just per-class.
  const insightsTotals = useMemo(() => {
    const vals = [...insightsSummary.values()];
    return {
      activeGroups: vals.reduce((s, v) => s + (v.activeGroups || 0), 0),
      totalMessages: vals.reduce((s, v) => s + (v.totalMessages || 0), 0),
      lastActivity: vals.reduce<string | null>(
        (acc, v) =>
          v.lastActivity && (!acc || v.lastActivity > acc) ? v.lastActivity : acc,
        null,
      ),
    };
  }, [insightsSummary]);

  // classId -> EUR spend, for the per-class Spend column.
  const spendByClassId = useMemo<Map<string, number>>(
    () => new Map((teacherSpend?.per_class ?? []).map((r) => [r.class_id, r.eur])),
    [teacherSpend],
  );

  const handleDelete = useCallback(
    async (cls: ClassPayload) => {
      setActionError(null);
      setDeletingId(cls.classId);
      try {
        await deleteClass(cls.classId);
        setConfirmDelete(null);
        await refresh();
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : `failed to delete ${cls.name}`,
        );
      } finally {
        setDeletingId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="flex flex-col gap-8">
      {/* Floating class co-pilot — the teacher creates classes / mints codes by
          talking, beside the list; proposals Apply into the list below. */}
      {researchView ? null : <ManageClassCopilot onChanged={refresh} />}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {researchView ? "Research view" : "My classes"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {researchView
              ? "All classes across every teacher. Pick one to drill into its sessions."
              : "Classes you own. Pick one to manage groups and configure activities."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isResearcher ? (
            <div
              role="group"
              aria-label="Class scope"
              className="flex items-center rounded border border-border text-sm font-medium"
            >
              <button
                type="button"
                aria-pressed={!researchView}
                onClick={() => setResearchView(false)}
                className={`rounded-l px-3 py-1.5 ${!researchView ? "bg-accent" : "hover:bg-accent"}`}
              >
                My classes
              </button>
              <button
                type="button"
                aria-pressed={researchView}
                onClick={() => setResearchView(true)}
                className={`rounded-r px-3 py-1.5 ${researchView ? "bg-accent" : "hover:bg-accent"}`}
              >
                Research view
              </button>
            </div>
          ) : null}
          {researchView ? null : (
            <button
              type="button"
              onClick={() => setShowNewClassForm((v) => !v)}
              className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New class
            </button>
          )}
        </div>
      </header>

      {showNewClassForm ? (
        <NewClassForm
          onCreated={() => {
            setShowNewClassForm(false);
            void refresh();
          }}
          onCancel={() => setShowNewClassForm(false)}
        />
      ) : null}

      {loadError ? (
        <p
          role="alert"
          className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Couldn&rsquo;t load classes: {loadError}
        </p>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      <section aria-labelledby="classes-table-label">
        <h2 id="classes-table-label" className="sr-only">
          Classes
        </h2>
        {classes === null ? (
          <p className="text-sm text-muted-foreground">Loading classes&hellip;</p>
        ) : classes.length === 0 ? (
          <EmptyState onCreateClick={() => setShowNewClassForm(true)} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Groups</th>
                  <th className="px-3 py-2 font-medium">Activities</th>
                  <th className="px-3 py-2 font-medium">Tutor persona</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {classes.map((cls) => (
                  <ClassRow
                    key={cls.classId}
                    cls={cls}
                    activities={activitiesForClass(cls)}
                    persona={personaLabelForClass(cls)}
                    showOwner={researchView}
                    canDelete={!researchView}
                    deleting={deletingId === cls.classId}
                    onDelete={() => setConfirmDelete(cls)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmDelete ? (
        <DeleteClassDialog
          cls={confirmDelete}
          busy={deletingId === confirmDelete.classId}
          onCancel={() => {
            setConfirmDelete(null);
            setActionError(null);
          }}
          onConfirm={() => void handleDelete(confirmDelete)}
        />
      ) : null}

      <section aria-labelledby="insights-label" className="flex flex-col gap-3">
        <h2 id="insights-label" className="sr-only">
          Insights and spend
        </h2>
        {!showInsights ? (
          <button
            type="button"
            onClick={() => setShowInsights(true)}
            className="flex items-center gap-2 self-start rounded border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50"
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            Show insights &amp; spend
            <span className="text-xs font-normal text-muted-foreground/70">
              — engagement + model cost across your classes (loads analytics)
            </span>
          </button>
        ) : insightsLoading && !insightsCompare ? (
          <p
            data-testid="insights-loading"
            className="flex items-center gap-2 self-start rounded border border-border px-4 py-3 text-sm text-muted-foreground"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading insights &amp; spend&hellip;
          </p>
        ) : (
          <div
            data-testid="insights-panel"
            className="flex flex-col gap-4 rounded-lg border border-border p-4"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold">Insights &amp; spend</h3>
              <span className="text-xs text-muted-foreground">
                Across your classes · last 7 days
              </span>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <SummaryStat
                label="Active groups"
                value={String(insightsTotals.activeGroups)}
              />
              <SummaryStat
                label="Messages 7d"
                value={String(insightsTotals.totalMessages)}
              />
              <SummaryStat
                label="Spend (this month)"
                value={
                  spendLoading
                    ? "…"
                    : teacherSpend
                      ? formatEur(teacherSpend.total_eur)
                      : "—"
                }
              />
              <SummaryStat
                label="Last activity"
                value={
                  insightsTotals.lastActivity
                    ? relativeTime(insightsTotals.lastActivity)
                    : "none"
                }
              />
            </dl>
            {insightsCompare && insightsCompare.rows.length > 0 ? (
              <details open data-testid="cross-class-compare-section">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Per class
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    — engagement + spend; sortable; last 7 days
                  </span>
                </summary>
                <div className="mt-3">
                  <CrossClassTable
                    rows={insightsCompare.rows}
                    spendByClassId={spendByClassId}
                  />
                </div>
              </details>
            ) : (
              <p className="text-sm text-muted-foreground">
                No engagement recorded in the last 7 days.
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="recent-activity-label" className="flex flex-col gap-3">
        <header>
          <h2 id="recent-activity-label" className="text-lg font-semibold">
            Recent activity
          </h2>
        </header>

        {recentSessions.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No student sessions yet. Sessions appear here once students join a group and start chatting.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {recentSessions.map((row) => {
              const label =
                row.title ?? skillNameById.get(row.skillId) ?? row.skillId;
              return row.groupCode ? (
                <li key={row.sessionId}>
                  <Link
                    href={`/teacher/reports/groups/${row.groupCode}?session_id=${encodeURIComponent(row.sessionId)}`}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">
                        {row.groupCode}
                      </code>
                      <span className="flex items-center gap-1 text-foreground">
                        <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {label}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} · {relativeTime(row.lastMessageAt)}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      View
                    </span>
                  </Link>
                </li>
              ) : (
                <li
                  key={row.sessionId}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} · {relativeTime(row.lastMessageAt)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function PersonaAvatar({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={avatar}
        alt=""
        aria-hidden
        className="h-6 w-6 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700"
    >
      {name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function ClassRow({
  cls,
  activities,
  persona,
  showOwner = false,
  canDelete = true,
  deleting = false,
  onDelete,
}: {
  cls: ClassPayload;
  activities: { activityId: string; title: string }[];
  persona: { name: string; inherited: boolean; avatar: string };
  showOwner?: boolean;
  canDelete?: boolean;
  deleting?: boolean;
  onDelete: () => void;
}) {
  return (
    <tr className="align-top hover:bg-muted/30">
      <td className="px-3 py-3">
        <Link
          href={`/teacher/classes/${cls.classId}`}
          className="font-medium text-foreground hover:underline"
        >
          {cls.name}
        </Link>
        {showOwner ? (
          <div
            className="max-w-[15rem] truncate text-xs text-muted-foreground"
            data-testid="class-owner"
            title={cls.ownerLabel ?? cls.ownerUid}
          >
            Owner: {cls.ownerLabel ?? cls.ownerUid}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {cls.groupCodes.length}
        </span>
      </td>
      <td className="max-w-[20rem] px-3 py-3 text-muted-foreground">
        {activities.length === 0 ? (
          <span className="text-muted-foreground/60">None yet</span>
        ) : (
          <ul className="space-y-0.5">
            {activities.slice(0, 3).map((a) => (
              <li key={a.activityId} className="flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/* Own view: click a title to edit that activity. Research view
                    (showOwner) is read-only — another teacher's activity isn't
                    editable, so render plain text. */}
                {showOwner ? (
                  <span className="truncate" title={a.title}>
                    {a.title}
                  </span>
                ) : (
                  <Link
                    href={`/teacher/activities/${encodeURIComponent(a.activityId)}?title=${encodeURIComponent(a.title)}`}
                    className="truncate hover:text-foreground hover:underline"
                    title={`Edit ${a.title}`}
                  >
                    {a.title}
                  </Link>
                )}
              </li>
            ))}
            {activities.length > 3 ? (
              <li className="pl-[1.375rem] text-xs text-muted-foreground/70">
                +{activities.length - 3} more
              </li>
            ) : null}
          </ul>
        )}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <PersonaAvatar name={persona.name} avatar={persona.avatar} />
          {persona.name}
          {persona.inherited ? (
            <span className="text-muted-foreground/60">· default</span>
          ) : null}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1.5">
          <Link
            href={`/teacher/classes/${cls.classId}`}
            className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Settings className="h-3.5 w-3.5" aria-hidden="true" />
            Manage
          </Link>
          {/* No class-level "Report" button: a class has many groups and reports are
              per-group. The arbitrary-first-group link was misleading (1.1.36 feedback).
              Reports are reached via Manage -> class detail (per-group) + recent sessions. */}
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              aria-label={`Delete ${cls.name}`}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Delete
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function DeleteClassDialog({
  cls,
  busy,
  onCancel,
  onConfirm,
}: {
  cls: ClassPayload;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-class-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-xl"
      >
        <h2 id="delete-class-title" className="text-lg font-semibold">
          Delete &ldquo;{cls.name}&rdquo;?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This revokes the class and its {cls.groupCodes.length} group code
          {cls.groupCodes.length === 1 ? "" : "s"} — students can no longer
          join, and its assigned activities &amp; session reports become
          inaccessible. This can&rsquo;t be undone here.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            )}
            Delete class
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="col-span-full flex flex-col items-start gap-2 rounded border border-dashed border-border p-6">
      <p className="text-sm font-medium">No classes yet.</p>
      <p className="text-sm text-muted-foreground">
        Create your first class to start minting group codes for students.
      </p>
      <button
        type="button"
        onClick={onCreateClick}
        className="mt-2 flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create class
      </button>
    </div>
  );
}

function NewClassForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createClass({
        name: name.trim(),
        description: description.trim() || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create class");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-border bg-background p-4"
      aria-label="Create class"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Class name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          maxLength={200}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="e.g. Physik 9A vår 2026"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
