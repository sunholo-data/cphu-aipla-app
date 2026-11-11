"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  ClipboardList,
  FileText,
  MessageSquare,
  Plus,
  Search,
  Users,
} from "lucide-react";

import {
  type ActivityPayload,
  type ClassActivity,
  type ClassPayload,
  type PersonaPayload,
  type TutorPayload,
  type SessionRow,
  type SkillSummary,
  createClass,
  fetchPersonaCatalogue,
  fetchTutorCatalogue,
  listAccessibleSkills,
  listActivities,
  listClassRecentSessions,
  fetchClassesActivity,
  listClasses,
  setClassPersona,
} from "@/lib/teacherApi";
import { fetchWithTeacherAuth } from "@/lib/apiClient";
import type { InsightsScope } from "@/lib/insightsApi";
import { ScopeToggle } from "@/components/teacher/insights/ScopeToggle";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/ui/load-error";
import { RowMenu } from "@/components/ui/row-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsResearcher } from "@/hooks/useIsResearcher";
import { useUrlTab } from "@/hooks/useUrlTab";
import { ManageClassCopilot } from "./_ManageClassCopilot";
import { GettingStartedCard } from "./_GettingStartedCard";
import { SetUpForTeacherDialog } from "./_SetUpForTeacherDialog";
import { StageChip } from "@/components/teacher/StageChip";
import { classStage } from "@/lib/onboardingStage";
import { activeGroupCodes } from "@/lib/classCodes";
import { formatRelativeTime } from "@/lib/relativeTime";
import { TutorFace } from "@/components/teacher/research/TutorFace";
import { useLocaleMode, useT } from "@/i18n";

/**
 * /teacher/classes — the page a teacher lands on (UI sweep 2026-11-11, from the
 * approved "ShellNew" mockup). What changed and where each thing went:
 *
 *  - The class name (and the whole row) opens the class; the "Administrér"
 *    button that went to the same URL is gone.
 *  - "Slet" left the row: deleting a class is "Slet klasse…" at the bottom of
 *    the class page's Opsætning view, still behind a confirm. A destructive
 *    button no longer sits on every row of the page teachers land on.
 *  - The opt-in "Vis indsigt og forbrug" panel (a second copy of the
 *    cross-class table, plus spend and four totals) is one link line to
 *    Indsigt → Alle klasser, which now carries the spend column and totals.
 *  - "Seneste aktivitet" shows 3 sessions; "Vis alle (n)" shows the rest.
 *  - The getting-started checklist opens as one line; "Fortsæt" expands it.
 *  - A researcher's scope switch is "Dine klasser | Alle læreres klasser" (the
 *    same words as on Indsigt), kept in the URL as `?scope=all`.
 *  - A failed read of the sessions says so, with Retry — it used to render as
 *    "Ingen elevsessioner endnu", which a teacher believes.
 */

type ActivityFilter = "all" | "active7d" | "quiet";
const FILTERS: readonly ActivityFilter[] = ["all", "active7d", "quiet"];
const SCOPES: readonly InsightsScope[] = ["own", "all"];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
/** Recent sessions shown before "Vis alle". */
const RECENT_COLLAPSED = 3;
/** Recent sessions fetched across classes. */
const RECENT_MAX = 10;

type RecentState =
  | { kind: "loading" }
  /** `failed` = classes whose session read failed; their sessions are missing from `rows`. */
  | { kind: "ok"; rows: SessionRow[]; failed: number };

/** Latest activity first; classes nobody has spoken in sink to the bottom and
 *  keep their existing (newest-created-first) order among themselves. */
function byLatestActivity(
  activity: Record<string, ClassActivity>,
): (a: ClassPayload, b: ClassPayload) => number {
  return (a, b) => {
    const ta = activity[a.classId]?.lastMessageAt;
    const tb = activity[b.classId]?.lastMessageAt;
    if (ta && tb) return tb.localeCompare(ta);
    if (ta) return -1;
    if (tb) return 1;
    return 0;
  };
}

export default function TeacherClassesPage() {
  // useUrlTab reads the search params, which Next requires to sit under Suspense.
  return (
    <Suspense fallback={null}>
      <ClassesPageInner />
    </Suspense>
  );
}

function ClassesPageInner() {
  const t = useT("ClassesPage");
  const tSetUp = useT("SetUpForTeacherDialog");
  const localeMode = useLocaleMode();
  const timeLocale = localeMode === "bilingual" ? "da" : localeMode;
  const [classes, setClasses] = useState<ClassPayload[] | null>(null);
  const [recent, setRecent] = useState<RecentState>({ kind: "loading" });
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [catalogue, setCatalogue] = useState<SkillSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [showNewClassForm, setShowNewClassForm] = useState(false);
  // 1.1.124 M2 — the researcher's "set up a class for a teacher" dialog.
  const [showSetUpForTeacher, setShowSetUpForTeacher] = useState(false);
  // Research view (sprint 1.1.5): researchers can switch to a cross-class
  // list of every teacher's classes. Toggle is hidden for non-researchers;
  // the backend independently rejects scope=all without the claim. In the URL
  // since the UI sweep, so a researcher can link to it and Back keeps it.
  const isResearcher = useIsResearcher();
  const [scope, setScope] = useUrlTab<InsightsScope>("scope", SCOPES, "own");
  const researchView = isResearcher && scope === "all";
  // At-a-glance activity per class (2026-09-11) — fetched beside the list,
  // never blocking it. Empty map until it lands; the column reads "—" then.
  const [activity, setActivity] = useState<Record<string, ClassActivity>>({});
  const [search, setSearch] = useState("");
  const [activityFilter, setActivityFilter] = useUrlTab<ActivityFilter>("filter", FILTERS, "all");

  // Tutor catalogue (1.1.32) — resolve each class's tutor id to a
  // display name in the table. defaultId is the global fallback a class
  // inherits when it has no explicit persona.
  const [personaById, setPersonaById] = useState<Map<string, PersonaPayload>>(new Map());
  const [defaultPersonaId, setDefaultPersonaId] = useState<string | null>(null);
  // 1.1.91 — a class that has CHOSEN a tutor carries `tutorId`; `persona` is
  // the pre-1.1.91 field and is never written by `setClassTutor`. Reading only
  // `persona` here made the column show the inherited default for every class
  // whose tutor was actually picked — the 1.1.112 "one consumer" shape again.
  const [tutorById, setTutorById] = useState<Map<string, TutorPayload>>(new Map());
  // The activity library (new model), keyed by activity id, so the table
  // resolves each class's assigned `activityIds` to its title — matching the
  // class-detail view. (The old path read `lessons` + activity_configs, which
  // are empty on new-model activities, so the column wrongly showed "None yet".)
  const [activityById, setActivityById] = useState<Map<string, ActivityPayload>>(new Map());

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
    try {
      const list = await listClasses(researchView ? "all" : "own");
      setClasses(list);
      setLoadError(null);
      // Fire-and-forget: the table must never wait on the activity read, and a
      // failure leaves the previous values rather than blanking the column.
      void fetchClassesActivity(researchView ? "all" : "own")
        .then(setActivity)
        .catch(() => undefined);
      // Recent-sessions fan-out is per-class; in Research view that can be
      // every teacher's class, so skip it there (the per-class drill-down
      // remains the way to inspect another teacher's sessions).
      if (researchView) {
        setRecent({ kind: "ok", rows: [], failed: 0 });
        return;
      }
      // Fetch recent student sessions across all classes (per-class endpoint
      // queries by groupCode, so only student sessions appear here).
      // allSettled, not all: one class's fetch failing shouldn't blank the
      // whole strip or take down the (already-loaded) classes table — the
      // strip shows what did load, and SAYS how many classes it could not read
      // (a failure used to fall through to "no sessions yet").
      const batches = await Promise.allSettled(list.map((c) => listClassRecentSessions(c.classId)));
      const rows = batches
        .flatMap((b) => (b.status === "fulfilled" ? b.value : []))
        .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
        .slice(0, RECENT_MAX);
      setRecent({ kind: "ok", rows, failed: batches.filter((b) => b.status === "rejected").length });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t("loadFailedGeneric"));
    }
  }, [researchView, t]);

  useEffect(() => {
    setRecent({ kind: "loading" });
    void refresh();
    // 30-second refresh, paused while the tab is hidden: it fans out one
    // request per class, and nobody is looking.
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      await refresh();
    } finally {
      setRetrying(false);
    }
  }, [refresh]);

  // Fetch the lesson catalogue once for the title-fallback lookup.
  useEffect(() => {
    void listAccessibleSkills()
      .then(setCatalogue)
      .catch(() => setCatalogue([]));
  }, []);

  // Tutor + persona catalogues — to label each class's tutor. Non-fatal.
  useEffect(() => {
    void fetchPersonaCatalogue()
      .then((cat) => {
        setPersonaById(new Map(cat.personas.map((p) => [p.id, p])));
        setDefaultPersonaId(cat.defaultId);
      })
      .catch(() => {
        /* tutor column degrades to the default label */
      });
    void fetchTutorCatalogue()
      .then((cat) => {
        setTutorById(new Map([...cat.tutors, ...(cat.skillBoundTutors ?? [])].map((tu) => [tu.id, tu])));
      })
      .catch(() => {
        /* falls back to the legacy persona field */
      });
  }, []);

  // The activity library so the table can resolve each class's assigned
  // `activityIds` to a title. Research view pulls the cross-teacher library
  // (researcher-only scope=all) so other teachers' activity titles resolve too;
  // own view pulls the caller's. Non-fatal — falls back to the id.
  useEffect(() => {
    // 1.1.61: the list is paginated now (default 50). This is a LOOKUP table, not
    // a browse, so ask for the cap — a silent truncation here shows up as activity
    // titles mysteriously falling back to raw ids.
    void listActivities(researchView ? "all" : "own", { limit: 200 })
      .then((page) => setActivityById(new Map(page.activities.map((a) => [a.activityId, a]))))
      .catch(() => setActivityById(new Map()));
  }, [researchView]);

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

  // Resolve a class's tutor to a display label. A class with no explicit
  // tutor inherits the global default; mark that so it reads as
  // inherited rather than chosen.
  const tutorLabelForClass = useCallback(
    (cls: ClassPayload): { name: string; inherited: boolean; avatar: string } => {
      // Chosen tutor first — this is what actually teaches the class.
      const chosen = cls.tutorId ? tutorById.get(cls.tutorId) : undefined;
      if (chosen) {
        return {
          name: chosen.displayName,
          inherited: false,
          avatar: chosen.persona?.avatar || "",
        };
      }
      // Then the legacy per-class persona, then the global default.
      const explicit = cls.persona ?? null;
      const id = explicit ?? defaultPersonaId;
      const p = id ? personaById.get(id) : undefined;
      return {
        name: p?.name || t("tutorDefault"),
        inherited: !explicit,
        avatar: p?.avatar || "",
      };
    },
    [tutorById, personaById, defaultPersonaId, t],
  );

  // Sorted by latest activity, then narrowed by the search box and the
  // activity filter. Search matches class name, owner label (research view)
  // and assigned activity titles, case-insensitively.
  const visibleClasses = useMemo(() => {
    if (classes === null) return null;
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return [...classes].sort(byLatestActivity(activity)).filter((cls) => {
      const act = activity[cls.classId];
      if (activityFilter === "quiet" && act && act.turns > 0) return false;
      if (activityFilter === "active7d") {
        const at = act?.lastMessageAt ? new Date(act.lastMessageAt).getTime() : NaN;
        if (!(now - at <= SEVEN_DAYS_MS)) return false;
      }
      if (!q) return true;
      const hay = [cls.name, cls.ownerLabel ?? "", ...activitiesForClass(cls).map((a) => a.title)]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [classes, activity, search, activityFilter, activitiesForClass]);

  // Indsigt → Alle klasser, in the scope this page is showing. A researcher's
  // default there is every teacher's classes, so "Dine klasser" must be explicit.
  const insightsHref = researchView
    ? "/teacher/insights/classes?scope=all"
    : isResearcher
      ? "/teacher/insights/classes?scope=own"
      : "/teacher/insights/classes";

  return (
    <div className="flex flex-col gap-6">
      {/* Floating class co-pilot — the teacher creates classes / mints codes by
          talking, beside the list; proposals Apply into the list below. */}
      {researchView ? null : <ManageClassCopilot onChanged={refresh} />}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        {isResearcher ? <ScopeToggle value={scope} onChange={setScope} size="md" /> : null}
        <div className="ml-auto flex items-center gap-2">
          {isResearcher ? (
            <RowMenu
              label={t("moreActions")}
              items={[
                {
                  id: "set-up-for-teacher",
                  label: tSetUp("button"),
                  onSelect: () => setShowSetUpForTeacher(true),
                },
              ]}
            />
          ) : null}
          {researchView ? null : (
            <Button variant="primary" onClick={() => setShowNewClassForm((v) => !v)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("newClass")}
            </Button>
          )}
        </div>
      </header>

      {/* 1.1.124 M1 — the teacher's own checklist, at the top of the page they
          land on. Not in the research view: a researcher's stage is not the
          question there. */}
      {researchView ? null : <GettingStartedCard onCreateClass={() => setShowNewClassForm(true)} />}

      {showSetUpForTeacher ? (
        <SetUpForTeacherDialog onCreated={() => void refresh()} onCancel={() => setShowSetUpForTeacher(false)} />
      ) : null}

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
        <div className="flex flex-col gap-1">
          <LoadError what={t("whatClasses")} onRetry={() => void retry()} retrying={retrying} />
          <p className="text-xs text-muted-foreground">{t("loadFailedDetail", { error: loadError })}</p>
        </div>
      ) : null}

      <section aria-labelledby="classes-table-label">
        <h2 id="classes-table-label" className="sr-only">
          {t("classesHeading")}
        </h2>
        {classes === null || visibleClasses === null ? (
          loadError ? null : (
            <div role="status" aria-label={t("loading")} className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          )
        ) : classes.length === 0 ? (
          <EmptyState onCreateClick={() => setShowNewClassForm(true)} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-[12rem] flex-1">
                <span className="sr-only">{t("searchLabel")}</span>
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  name="class-search"
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("searchLabel")}
                  className="w-full rounded border border-border bg-background py-1.5 pl-8 pr-2 text-sm"
                />
              </label>
              <select
                value={activityFilter}
                onChange={(e) => setActivityFilter(e.target.value as ActivityFilter)}
                aria-label={t("filterLabel")}
                className="rounded border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="all">{t("filterAll")}</option>
                <option value="active7d">{t("filterActive7d")}</option>
                <option value="quiet">{t("filterQuiet")}</option>
              </select>
            </div>
            {visibleClasses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noMatch")}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">{t("colClass")}</th>
                      <th className="px-3 py-2 font-medium">{t("colLastUsed")}</th>
                      <th className="px-3 py-2 font-medium">{t("colGroups")}</th>
                      <th className="px-3 py-2 font-medium">{t("colActivities")}</th>
                      <th className="px-3 py-2 font-medium">{t("colTutor")}</th>
                      <th className="w-8 px-3 py-2">
                        <span className="sr-only">{t("colOpen")}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleClasses.map((cls) => (
                      <ClassRow
                        key={cls.classId}
                        cls={cls}
                        activity={activity[cls.classId]}
                        activities={activitiesForClass(cls)}
                        tutor={tutorLabelForClass(cls)}
                        showOwner={researchView}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* The "insights & spend" panel's new home is Indsigt → Alle klasser. */}
      <p>
        <Link
          href={insightsHref}
          data-testid="insights-link"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          {researchView ? t("insightsLinkAll") : t("insightsLink")}
        </Link>
      </p>

      {researchView ? null : (
        <RecentActivity
          state={recent}
          showAll={showAllRecent}
          onToggle={() => setShowAllRecent((v) => !v)}
          onRetry={() => void retry()}
          retrying={retrying}
          skillNameById={skillNameById}
          timeLocale={timeLocale}
        />
      )}
    </div>
  );
}

function RecentActivity({
  state,
  showAll,
  onToggle,
  onRetry,
  retrying,
  skillNameById,
  timeLocale,
}: {
  state: RecentState;
  showAll: boolean;
  onToggle: () => void;
  onRetry: () => void;
  retrying: boolean;
  skillNameById: Map<string, string>;
  timeLocale: "da" | "en";
}) {
  const t = useT("ClassesPage");
  const rows = state.kind === "ok" ? state.rows : [];
  const shown = showAll ? rows : rows.slice(0, RECENT_COLLAPSED);
  return (
    <section aria-labelledby="recent-activity-label" className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h2 id="recent-activity-label" className="text-base font-semibold">
          {t("recentActivity")}
        </h2>
        {rows.length > RECENT_COLLAPSED ? (
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls="recent-activity-list"
            onClick={onToggle}
            className="rounded px-1 text-sm font-medium text-primary hover:underline"
          >
            {showAll ? t("showFewer") : t("showAll", { n: rows.length })}
          </button>
        ) : null}
      </header>

      {state.kind === "loading" ? (
        <div role="status" aria-label={t("loadingSessions")} className="flex flex-col gap-1">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : null}

      {/* A failed read must never read as "no sessions": say which part failed. */}
      {state.kind === "ok" && state.failed > 0 ? (
        <LoadError
          what={rows.length > 0 ? t("whatSomeSessions", { n: state.failed }) : t("whatSessions")}
          onRetry={onRetry}
          retrying={retrying}
        />
      ) : null}

      {state.kind === "ok" && rows.length === 0 && state.failed === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          {t("noSessions")}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <ul id="recent-activity-list" className="divide-y divide-border rounded border border-border">
          {shown.map((row) => {
            const label = row.title ?? skillNameById.get(row.skillId) ?? row.skillId;
            const meta = `${t("turns", { n: row.turnCount })} · ${formatRelativeTime(row.lastMessageAt, Date.now(), timeLocale)}`;
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
                    <span className="text-xs text-muted-foreground">{meta}</span>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("view")}
                  </span>
                </Link>
              </li>
            ) : (
              <li key={row.sessionId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    {label}
                  </span>
                  <span className="text-xs text-muted-foreground">{meta}</span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function ClassRow({
  cls,
  activity,
  activities,
  tutor,
  showOwner = false,
}: {
  cls: ClassPayload;
  activity?: ClassActivity;
  activities: { activityId: string; title: string }[];
  tutor: { name: string; inherited: boolean; avatar: string };
  showOwner?: boolean;
}) {
  const t = useT("ClassesPage");
  const router = useRouter();
  const localeMode = useLocaleMode();
  const timeLocale = localeMode === "bilingual" ? "da" : localeMode;
  const href = `/teacher/classes/${cls.classId}`;
  return (
    <tr
      data-testid="class-row"
      // The whole row opens the class (mouse). The class name stays a real
      // link, so keyboard and screen-reader users reach the same place, and
      // the activity links inside the row keep their own targets.
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
        if (typeof window !== "undefined" && window.getSelection()?.toString()) return;
        router.push(href);
      }}
      className="cursor-pointer align-top hover:bg-muted/30"
    >
      <td className="px-3 py-3">
        <Link href={href} className="font-medium text-foreground hover:underline">
          {cls.name}
        </Link>
        {/* 1.1.146 M4 — a class its teacher deleted stays in the research
            view (its sessions are still evidence), marked so it is not
            mistaken for a running class. Owners never see their own here. */}
        {cls.revoked ? (
          <span
            className="ml-2 rounded border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            data-testid="class-deleted"
          >
            {t("deletedByTeacher")}
          </span>
        ) : null}
        {showOwner ? (
          <div
            className="max-w-[15rem] truncate text-xs text-muted-foreground"
            data-testid="class-owner"
            title={cls.ownerLabel ?? cls.ownerUid}
          >
            {t("owner", { owner: cls.ownerLabel ?? cls.ownerUid })}
          </div>
        ) : null}
        {/* 1.1.124 M0 — where this class is on the way to a live lesson,
            derived from what the row already holds. Research view only: the
            owner's own page carries the checklist instead. */}
        {showOwner ? (
          <div className="mt-1">
            <StageChip stage={classStage(cls, activity)} />
          </div>
        ) : null}
      </td>
      {/* Last used, at a glance. "No messages yet" is said in words — a blank
          cell reads the same as "not permitted", and a researcher cannot tell
          them apart (see the class-report confusion of 2026-09-11). */}
      <td className="px-3 py-3 text-muted-foreground" data-testid="class-activity">
        {activity === undefined ? (
          <span className="text-muted-foreground/60">—</span>
        ) : activity.turns === 0 ? (
          <span className="text-muted-foreground/60">{t("noActivity")}</span>
        ) : (
          <div className="flex flex-col gap-0.5 whitespace-nowrap">
            <span className="inline-flex items-center gap-1 text-foreground">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t("turns", { n: activity.turns })} · {t("groupsSpoke", { n: activity.activeGroups })}
            </span>
            {activity.lastMessageAt ? (
              <span className="text-xs" title={activity.lastMessageAt}>
                {formatRelativeTime(activity.lastMessageAt, Date.now(), timeLocale)}
              </span>
            ) : null}
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {activeGroupCodes(cls).length}
        </span>
      </td>
      <td className="max-w-[20rem] px-3 py-3 text-muted-foreground">
        {activities.length === 0 ? (
          <span className="text-muted-foreground/60">{t("noneYet")}</span>
        ) : (
          <ul className="space-y-0.5">
            {activities.slice(0, 3).map((a) => (
              <li key={a.activityId} className="flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/* Click a title to edit that activity — in the research view
                    too (1.1.123): a researcher may edit any teacher's activity,
                    and the editor says whose it is. `classId` rides along so
                    the editor shows THIS class's tutor as the inherited one,
                    not the default (UI sweep 2026-11-11, finding 1). */}
                <Link
                  href={`/teacher/activities/${encodeURIComponent(a.activityId)}?title=${encodeURIComponent(a.title)}&classId=${encodeURIComponent(cls.classId)}`}
                  className="truncate hover:text-foreground hover:underline"
                  title={t("editActivity", { title: a.title })}
                >
                  {a.title}
                </Link>
              </li>
            ))}
            {activities.length > 3 ? (
              <li className="pl-[1.375rem] text-xs text-muted-foreground/70">
                {t("more", { n: activities.length - 3 })}
              </li>
            ) : null}
          </ul>
        )}
      </td>
      <td className="px-3 py-3 text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <TutorFace name={tutor.name} avatar={tutor.avatar} size="sm" />
          {tutor.name}
          {tutor.inherited ? <span className="text-muted-foreground/60">· {t("tutorInherited")}</span> : null}
        </span>
      </td>
      <td className="px-3 py-3 text-right text-muted-foreground">
        <ChevronRight className="inline h-4 w-4" aria-hidden="true" />
      </td>
    </tr>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  const t = useT("ClassesPage");
  return (
    <div className="col-span-full flex flex-col items-start gap-2 rounded border border-dashed border-border p-6">
      <p className="text-sm font-medium">{t("emptyTitle")}</p>
      <p className="text-sm text-muted-foreground">{t("emptyBody")}</p>
      <Button variant="primary" size="sm" className="mt-2" onClick={onCreateClick}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t("createClass")}
      </Button>
    </div>
  );
}

function NewClassForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const t = useT("ClassesPage");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await createClass({
        name: name.trim(),
        description: description.trim() || null,
      });
      // 1.1.58 — apply the account's default persona at CREATE time (the
      // the class tutor picker stays the per-class override). Best-effort: a
      // failure here must never fail the create.
      try {
        const prefs = (await (await fetchWithTeacherAuth("/api/proxy/api/teacher/prefs")).json()) as {
          defaultPersonaId?: string | null;
        };
        if (prefs?.defaultPersonaId) {
          await setClassPersona(created.classId, prefs.defaultPersonaId);
        }
      } catch {
        /* the default persona is a convenience — never blocks class creation */
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-border bg-background p-4"
      aria-label={t("createClass")}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("className")}</span>
        <input
          type="text"
          name="class-name"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          maxLength={200}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder={t("classNamePlaceholder")}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{t("descriptionOptional")}</span>
        <textarea
          name="class-description"
          autoComplete="off"
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
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={name.trim().length === 0}
          pending={submitting}
          pendingLabel={t("creating")}
        >
          {t("create")}
        </Button>
      </div>
    </form>
  );
}
