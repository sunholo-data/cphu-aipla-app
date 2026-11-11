"use client";

/**
 * One class, in three views (UI sweep 2026-11, mockups approved by M on
 * 2026-11-11; audit: docs/design/aipla/v2.1.0-extension/
 * ui-sweep-teacher-researcher-audit.md, "/teacher/classes/[id]").
 *
 *   Lektion          — raised hands, the AI class summary, the ONE groups table
 *                      (codes + live status + browser-only names), revoked codes
 *   Efter lektionen  — latest lesson + review, concepts, "Tal" (insights and
 *                      spend, both lazy), recent sessions + export, compare,
 *                      groups that can help each other
 *   Opsætning        — name, tutor, voice/recording, activities, delete class
 *
 * The rule of the sweep: simplify without dropping a feature. Every control
 * that was on the old one-page scroll is in one of the three views; the audit's
 * "Features that must survive" list is the checklist.
 *
 * The view is in the URL (`?tab=`). With none, the page opens on Lektion if a
 * group was active in the last 90 minutes, else Efter lektionen if the class
 * has had a lesson, else Opsætning (`pickDefaultClassTab`).
 */

import Link from "next/link";
import { notFound, useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Download, Plus } from "lucide-react";

import {
  type ActivityPayload,
  type ClassPayload,
  type SessionRow,
  deleteClass,
  getClass,
  listActivities,
  listClassRecentSessions,
  mintGroupCodes,
  patchClassActivities,
  resetGroupSession,
  revokeGroupCode,
} from "@/lib/teacherApi";
import { ClassInsightsPanel } from "@/components/teacher/insights/ClassInsightsPanel";
import { BudgetPanel } from "@/components/teacher/BudgetPanel";
import { ActingForOwnerBanner, LastEditedLine } from "@/components/teacher/ActingForOwnerBanner";
import { ClassDetailsPanel } from "@/components/teacher/ClassDetailsPanel";
import { ClassVoiceSettingsPanel } from "@/components/teacher/ClassVoiceSettingsPanel";
import { TutorPicker } from "@/components/teacher/TutorPicker";
import { ClassConceptsOverview } from "@/components/teacher/ClassConceptsOverview";
import { LatestLessonCard } from "@/components/teacher/lessons/LatestLessonCard";
import { ClassGroupPairings } from "@/components/teacher/ClassGroupPairings";
import { SettingsSection } from "@/components/teacher/ui/SettingsSection";
import { TeacherTabs } from "@/components/teacher/ui/TeacherTabs";
import { citedDocIds, FailedMaterialsWarning, useRagStatuses } from "@/components/teacher/FailedMaterialsWarning";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { CompareGroupsLink } from "@/components/teacher/compare/CompareGroupsLink";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { LoadError } from "@/components/ui/load-error";
import { RowMenu } from "@/components/ui/row-menu";
import { PageSkeleton, Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/components/ui/toast";
import { useUrlTab } from "@/hooks/useUrlTab";

import { handleExportSessions } from "./_exportHelpers";
import { ClassAnalyticsCopilot } from "./_ClassAnalyticsCopilot";
import { LiveSummary, RaisedHands, useLiveClass } from "./_LiveClassView";
import { GroupsTable } from "./_GroupsTable";
import { MenuButton } from "./_MenuButton";
import { CLASS_TABS, type ClassTab, pickDefaultClassTab } from "./_classTabs";
import { activeGroupCodes, revokedGroupCodes } from "@/lib/classCodes";
import { formatRelativeTime } from "@/lib/relativeTime";
import { useLocaleMode, useT } from "@/i18n";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";

type LoadState = "loading" | "ok" | "error";

/** Recent sessions shown before "Vis alle"; and the most "Vis alle" shows. */
const SESSIONS_FIRST = 3;
const SESSIONS_MAX = 10;

export default function TeacherClassDetailPage() {
  // 1.1.108 M2 — the teacher's own language (their DA | EN choice).
  const t = useT("ClassDetailPage");
  const localeMode = useLocaleMode();
  const timeLocale = localeMode === "bilingual" ? "da" : localeMode;
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();

  const [cls, setCls] = useState<ClassPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ok" | "not-found" | "error">("loading");
  const [retryingClass, setRetryingClass] = useState(false);
  const [minting, setMinting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Read after mount — the server render has no window, and the value must be
  // the address THIS teacher is on, not one baked at build time.
  const [joinOrigin, setJoinOrigin] = useState("");

  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<LoadState>("loading");
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  // ALS-1 M1.3 — the Activities section is backed by the teacher's class-independent
  // activity library (/api/activities) + cls.activityIds.
  const [libraryActivities, setLibraryActivities] = useState<ActivityPayload[]>([]);
  const [libraryStatus, setLibraryStatus] = useState<LoadState>("loading");
  const [showPicker, setShowPicker] = useState(false);
  const [busyActivity, setBusyActivity] = useState<string | null>(null);

  const live = useLiveClass(id);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const fresh = await getClass(id);
      setCls(fresh);
      setLoadStatus("ok");
    } catch (err) {
      if (err instanceof Error && err.name === "NotFoundError") {
        setLoadStatus("not-found");
      } else {
        setLoadError(err instanceof Error ? err.message : t("loadFailedGeneric"));
        setLoadStatus("error");
      }
    }
  }, [id, t]);

  useEffect(() => {
    if (id) void refresh();
  }, [id, refresh]);

  useEffect(() => {
    setJoinOrigin(window.location.origin);
  }, []);

  // A failed read is "could not read", never "no sessions" — the two used to
  // render the same, and a teacher believed the empty one.
  const loadSessions = useCallback(async () => {
    if (!id) return;
    setSessionsStatus("loading");
    try {
      setRecentSessions(await listClassRecentSessions(id, 20));
      setSessionsStatus("ok");
    } catch {
      setSessionsStatus("error");
    }
  }, [id]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // 1.1.123 M0 — whose class this is. A researcher may open (and edit) any
  // teacher's class; the picker must then offer the OWNER's library, not the
  // researcher's, because the assign rule is keyed on the class owner.
  const { user: viewer } = useTeacherAuth({ redirectOnSignedOut: false });
  const ownerUid = cls?.ownerUid ?? null;
  const onBehalf = Boolean(viewer?.uid && ownerUid && viewer.uid !== ownerUid);

  // The viewer's own library first; once the class and viewer are known and
  // differ, the researcher scan (scope=all) filtered down to the OWNER's — the
  // only list that includes another teacher's private activities. A request
  // counter drops a slower, older answer so the owner's list is never
  // overwritten by the researcher's own.
  const libraryReq = useRef(0);
  // Keyed on whose library, so the owner's own page reads it once (not again
  // when the class arrives and `ownerUid` goes from null to their own uid).
  const libraryOwner = onBehalf && ownerUid ? ownerUid : null;
  const loadLibrary = useCallback(async () => {
    const req = ++libraryReq.current;
    setLibraryStatus("loading");
    try {
      // 1.1.61: paginated — this is the assignment picker's full library, so
      // request the cap rather than the default page.
      const page = libraryOwner
        ? await listActivities("all", { limit: 200 })
        : await listActivities("own", { limit: 200 });
      if (req !== libraryReq.current) return;
      setLibraryActivities(
        libraryOwner ? page.activities.filter((a) => a.ownerUid === libraryOwner) : page.activities,
      );
      setLibraryStatus("ok");
    } catch {
      if (req !== libraryReq.current) return;
      setLibraryStatus("error");
    }
  }, [libraryOwner]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  // ── which view ─────────────────────────────────────────────────────────────
  const explicitTab = (CLASS_TABS as readonly string[]).includes(searchParams?.get("tab") ?? "");
  // Decided ONCE, when the inputs first arrive, so the view does not jump
  // under the teacher when a poll changes its mind.
  const [defaultTab, setDefaultTab] = useState<ClassTab | null>(null);
  useEffect(() => {
    if (defaultTab !== null || sessionsStatus === "loading") return;
    setDefaultTab(
      pickDefaultClassTab({
        now: Date.now(),
        sessions: sessionsStatus === "ok" ? recentSessions : null,
        liveGroupCount: live.data?.groups.length ?? 0,
      }),
    );
  }, [defaultTab, sessionsStatus, recentSessions, live.data]);
  const [tab, setTab] = useUrlTab<ClassTab>("tab", CLASS_TABS, defaultTab ?? "lesson");

  // ── derived ────────────────────────────────────────────────────────────────
  const assignedActivities = useMemo<ActivityPayload[]>(() => {
    if (!cls) return [];
    const byId = new Map(libraryActivities.map((a) => [a.activityId, a]));
    return (cls.activityIds ?? [])
      .map((aid) => byId.get(aid))
      .filter((a): a is ActivityPayload => a !== undefined);
  }, [cls, libraryActivities]);
  // 1.1.151 F1c — RAG status of every doc the assigned activities cite (one read).
  const assignedCitedIds = useMemo(
    () => assignedActivities.flatMap((a) => citedDocIds(a.materials)),
    [assignedActivities],
  );
  const { statuses: ragStatuses, update: updateRagStatus } = useRagStatuses(assignedCitedIds);

  const addableActivities = useMemo<ActivityPayload[]>(() => {
    if (!cls) return libraryActivities;
    const taken = new Set(cls.activityIds ?? []);
    return libraryActivities.filter((a) => !taken.has(a.activityId));
  }, [cls, libraryActivities]);

  // 1.1.146 — Revoke ends access, not evidence. Live codes get the join/reset/
  // revoke controls; revoked codes keep their report link in their own list.
  const liveCodes = useMemo(() => (cls ? activeGroupCodes(cls) : []), [cls]);
  const retiredCodes = useMemo(() => (cls ? revokedGroupCodes(cls) : []), [cls]);

  // Most recent session per group code — the table's "last active" fallback.
  const latestByGroup = useMemo<Map<string, SessionRow>>(() => {
    const map = new Map<string, SessionRow>();
    for (const s of recentSessions) {
      if (s.groupCode && !map.has(s.groupCode)) map.set(s.groupCode, s);
    }
    return map;
  }, [recentSessions]);

  // Best-effort skill-id → name for the session rows (a session records the
  // skill it ran); sessions usually carry their own `title`.
  const skillNameById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const a of libraryActivities) if (a.skillId && a.title) m.set(a.skillId, a.title);
    return m;
  }, [libraryActivities]);

  if (!id) {
    notFound();
  }

  if (loadStatus === "not-found") {
    notFound();
  }

  if (loadStatus === "loading") {
    return <PageSkeleton label={t("loading")} />;
  }

  if (loadStatus === "error" || !cls) {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        <p>{t("loadFailed", { error: loadError ?? t("unknownError") })}</p>
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          pending={retryingClass}
          onClick={async () => {
            setRetryingClass(true);
            await refresh();
            setRetryingClass(false);
          }}
        >
          {t("retry")}
        </Button>
      </div>
    );
  }
  const theClass = cls;

  // ── actions ────────────────────────────────────────────────────────────────

  /** Copy, and say so only when it worked; otherwise show the text to copy. */
  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify.success(done);
    } catch {
      notify.error(t("copyFailed", { text }));
    }
  }

  // A bare code doesn't say WHICH AIPLA it belongs to, and the three
  // deployments differ only by an opaque Cloud Run hostname — a teacher lost
  // two hours on 2026-08-04 handing out dev codes that students typed into
  // test, where every join 401s. The link carries the environment with it.
  function handleCopyJoinLink(code: string) {
    void copyText(`${window.location.origin}/group?code=${encodeURIComponent(code)}`, t("linkCopied", { code }));
  }

  function handleCopyCode(code: string) {
    void copyText(code, t("copied", { code }));
  }

  async function runExport(format: "csv" | "json") {
    if (exporting !== null) return;
    setExporting(format);
    try {
      await handleExportSessions(theClass, skillNameById, format);
    } catch (err) {
      notify.error(err instanceof Error ? t("exportFailedDetail", { error: err.message }) : t("exportFailed"));
    } finally {
      setExporting(null);
    }
  }

  async function handleNewGroup() {
    setMinting(true);
    try {
      const result = await mintGroupCodes(theClass.classId, 1);
      const code = result.codes[0] ?? "";
      await refresh();
      await copyText(code, t("codeCreated", { code }));
    } catch (err) {
      notify.error(
        err instanceof Error ? t("codeCreateFailedDetail", { error: err.message }) : t("codeCreateFailed"),
      );
    } finally {
      setMinting(false);
    }
  }

  /** "Start en ny samtale" — archives the group's active session, so the next
   *  join starts fresh. The old one is kept for the report; it deletes nothing. */
  async function handleResetSession(code: string) {
    const ok = await confirm({
      title: t("resetConfirmTitle", { code }),
      description: t("resetConfirmBody"),
      confirmLabel: t("resetConfirmLabel"),
    });
    if (!ok) return;
    try {
      await resetGroupSession(theClass.classId, code);
      notify.success(t("resetDone", { code }));
    } catch (err) {
      notify.error(err instanceof Error ? t("resetFailedDetail", { error: err.message }) : t("resetFailed"));
    }
  }

  /** Revoke a leaked join code (2026-09-29).
   *
   *  ⚠️ Harder than starting a new conversation, and the confirm says so:
   *  `revoke_group_code` writes a TOMBSTONE on the anon_groups doc (1.1.146),
   *  so the next token verification fails on any instance. A student
   *  mid-lesson is cut off at their next message. The code string can never be
   *  reissued, and the group's work is kept AND still reachable: the code moves
   *  to the "Revoked codes" list with its report link, and every class
   *  analytic keeps counting it (erasure is 1.1.80's own thing).
   */
  async function handleRevokeCode(code: string) {
    const ok = await confirm({
      title: t("revokeConfirmTitle", { code }),
      description: t("revokeWarning"),
      confirmLabel: t("revokeConfirm"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await revokeGroupCode(theClass.classId, code);
      notify.success(t("revokeDone", { code }));
      await refresh();
    } catch (err) {
      notify.error(err instanceof Error ? t("revokeFailedDetail", { error: err.message }) : t("revokeFailed"));
    }
  }

  async function handleAddActivity(activityId: string) {
    setBusyActivity(activityId);
    try {
      await patchClassActivities(theClass.classId, { add: [activityId] });
      setShowPicker(false);
      await refresh();
      const title = libraryActivities.find((a) => a.activityId === activityId)?.title ?? activityId;
      notify.success(t("added", { title }));
    } catch (err) {
      notify.error(err instanceof Error ? t("addFailedDetail", { error: err.message }) : t("addFailed"));
    } finally {
      setBusyActivity(null);
    }
  }

  async function handleRemoveActivity(activityId: string) {
    setBusyActivity(activityId);
    try {
      await patchClassActivities(theClass.classId, { remove: [activityId] });
      await refresh();
      const title = libraryActivities.find((a) => a.activityId === activityId)?.title ?? activityId;
      notify.success(t("removed", { title }));
    } catch (err) {
      notify.error(err instanceof Error ? t("removeFailedDetail", { error: err.message }) : t("removeFailed"));
    } finally {
      setBusyActivity(null);
    }
  }

  /** Delete the class — moved here from the class list's row (UI sweep
   *  2026-11), behind the same confirm and the same soft-delete endpoint. */
  async function handleDeleteClass() {
    const ok = await confirm({
      title: t("deleteConfirmTitle", { name: theClass.name }),
      description: t("deleteConfirmBody", { n: liveCodes.length }),
      confirmLabel: t("deleteConfirmLabel"),
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteClass(theClass.classId);
      notify.success(t("deleted", { name: theClass.name }));
      router.push("/teacher/classes");
    } catch (err) {
      notify.error(t("deleteFailed", { error: err instanceof Error ? err.message : t("unknownError") }));
      setDeleting(false);
    }
  }

  const newActivityHref = `/teacher/activities/new?classId=${encodeURIComponent(theClass.classId)}`;
  const assignedCount = (theClass.activityIds ?? []).length;

  // ── views ──────────────────────────────────────────────────────────────────

  const lessonView = (
    <>
      <RaisedHands calls={live.data?.calls ?? []} acking={live.acking} onAck={(g) => void live.ack(g)} />
      <LiveSummary summary={live.data?.summary ?? null} />
      <GroupsTable
        classId={theClass.classId}
        className={theClass.name}
        liveCodes={liveCodes}
        retiredCodes={retiredCodes}
        revokedAt={theClass.revokedGroupCodesAt}
        joinOrigin={joinOrigin}
        description={t.rich("groupsDescription", {
          origin: joinOrigin || "…",
          code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{chunks}</code>,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
        live={live.data}
        liveError={live.error}
        latestByGroup={latestByGroup}
        timeLocale={timeLocale}
        minting={minting}
        onNewGroup={() => void handleNewGroup()}
        onCopyLink={handleCopyJoinLink}
        onCopyCode={handleCopyCode}
        onReset={(code) => void handleResetSession(code)}
        onRevoke={(code) => void handleRevokeCode(code)}
      />
    </>
  );

  const shownSessions = recentSessions.slice(0, showAllSessions ? SESSIONS_MAX : SESSIONS_FIRST);
  const sessionsTotalShown = Math.min(recentSessions.length, SESSIONS_MAX);

  const afterView = (
    <>
      {/* 1.1.139 M2 — the latest lesson leads: what the class struggled with
          and what next, linking to the full lesson overview. Cached read only. */}
      <LatestLessonCard classId={theClass.classId} />
      <ClassConceptsOverview classId={theClass.classId} />

      {/* "Tal": insights and spend as two collapsibles of the same kind, each
          loading only when opened (insights are four BigQuery queries). */}
      <section aria-labelledby="class-numbers" className="flex flex-col gap-3">
        <h2 id="class-numbers" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("numbers")}
        </h2>
        <SettingsSection title={t("insights")} description={t("insightsHint")} collapsible defaultOpen={false}>
          <ClassInsightsPanel classId={theClass.classId} hideTitle />
        </SettingsSection>
        <SettingsSection title={t("spend")} description={t("spendHint")} collapsible defaultOpen={false}>
          <BudgetPanel classId={theClass.classId} hideTitle />
        </SettingsSection>
      </section>

      <SettingsSection
        title={t("recentActivity")}
        action={
          <MenuButton
            label={exporting ? t("exporting") : t("export")}
            icon={<Download className="h-3.5 w-3.5" aria-hidden="true" />}
            disabled={exporting !== null || (sessionsStatus === "ok" && recentSessions.length === 0)}
            items={[
              { id: "export-csv", label: "CSV", hint: t("exportCsvTitle"), onSelect: () => void runExport("csv") },
              { id: "export-json", label: "JSON", hint: t("exportJsonTitle"), onSelect: () => void runExport("json") },
            ]}
          />
        }
      >
        {sessionsStatus === "loading" ? (
          <div className="flex flex-col gap-2" aria-hidden>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : sessionsStatus === "error" ? (
          <LoadError what={t("sessionsWhat")} onRetry={() => void loadSessions()} />
        ) : recentSessions.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {t("noSessions")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="divide-y divide-border rounded border border-border" data-testid="recent-sessions">
              {shownSessions.map((row) => {
                const what = row.title ?? skillNameById.get(row.skillId) ?? row.skillId;
                const meta = `${t("turns", { n: row.turnCount })} · ${formatRelativeTime(row.lastMessageAt, Date.now(), timeLocale)}`;
                return row.groupCode ? (
                  <li key={row.sessionId}>
                    <Link
                      href={`/teacher/reports/groups/${encodeURIComponent(row.groupCode)}?session_id=${encodeURIComponent(row.sessionId)}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted"
                    >
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium">{row.groupCode}</code>
                        <span className="text-foreground">{what}</span>
                        <span className="text-xs text-muted-foreground">{meta}</span>
                      </span>
                      <span className="shrink-0 text-xs font-medium text-primary">{t("report")}</span>
                    </Link>
                  </li>
                ) : (
                  <li key={row.sessionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{what}</span>
                    <span className="text-xs text-muted-foreground">{meta}</span>
                  </li>
                );
              })}
            </ul>
            {sessionsTotalShown > SESSIONS_FIRST ? (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                aria-expanded={showAllSessions}
                onClick={() => setShowAllSessions((v) => !v)}
              >
                {showAllSessions ? t("showFewer") : t("showAll", { n: sessionsTotalShown })}
              </Button>
            ) : null}
          </div>
        )}
      </SettingsSection>

      <CompareGroupsLink classId={theClass.classId} />

      {/* CONCEPT-2 M7 — suggestions for who could talk to whom, never a standing. */}
      <SettingsSection
        title={t("pairingsTitle")}
        description={t("pairingsDescription")}
        collapsible
        defaultOpen={false}
      >
        <ClassGroupPairings classId={theClass.classId} />
      </SettingsSection>
    </>
  );

  const setupView = (
    <>
      {/* Replaces the "where settings live" box (SettingsMap), whose copy said
          activities were edited "here" — false on this page. */}
      <p className="text-sm text-muted-foreground">{t("setupIntro")}</p>

      <SettingsSection id="class-settings" title={t("classSection")}>
        {/* 1.1.112 — renaming lives here because this is where a teacher looks for it. */}
        <ClassDetailsPanel
          classId={theClass.classId}
          initialName={theClass.name}
          initialDescription={theClass.description ?? null}
          onSaved={refresh}
        />
        {/* 1.1.123 M3 — present only when someone other than the owner wrote this class. */}
        <div className="mt-2">
          <LastEditedLine resource={theClass} />
        </div>
      </SettingsSection>

      {/* 1.1.91 — ONE tutor choice: name, picture, voice, tone and teaching
          approach together. Existing classes carry `persona` and no `tutorId`,
          and the base tutor ids are the persona ids, so falling back to
          `persona` shows their current identity as already selected. */}
      <SettingsSection
        title={t("tutor")}
        action={
          // 1.1.125 M0 — where a teacher meets a teaching approach.
          <Link
            href="/teacher/research/frameworks?tab=tutors"
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("teachingApproaches")}
          </Link>
        }
      >
        <TutorPicker
          classId={theClass.classId}
          selectedTutorId={theClass.tutorId ?? theClass.persona ?? null}
          onChange={refresh}
          recordingEnabled={theClass.recordingEnabled ?? false}
          compact
        />
      </SettingsSection>

      <ClassVoiceSettingsPanel
        classId={theClass.classId}
        initial={theClass.voice ?? null}
        initialVoiceInput={theClass.voiceInputEnabled ?? false}
        initialRecording={theClass.recordingEnabled ?? false}
        onSaved={refresh}
      />

      <SettingsSection
        id="class-activities"
        title={t("activitiesCount", { n: assignedCount })}
        action={
          <MenuButton
            label={t("addActivity")}
            variant="primary"
            icon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            items={[
              {
                id: "from-library",
                label: t("fromLibrary"),
                hint: libraryStatus === "ok" && addableActivities.length === 0 ? t("allAssigned") : t("assignTitle"),
                disabled: libraryStatus === "ok" && addableActivities.length === 0,
                onSelect: () => setShowPicker(true),
              },
              {
                id: "create-new",
                label: t("createNew"),
                hint: t("createNewHint"),
                onSelect: () => router.push(newActivityHref),
              },
            ]}
          />
        }
      >
        <div className="flex flex-col gap-3">
          {showPicker && libraryStatus !== "error" ? (
            <ActivityPicker
              options={addableActivities}
              loading={libraryStatus === "loading"}
              onPick={handleAddActivity}
              onCancel={() => setShowPicker(false)}
              busyId={busyActivity}
            />
          ) : null}

          {libraryStatus === "error" ? (
            // The list (and the picker) are drawn from the library, so a failed
            // library read used to say "no activities assigned" while the
            // subtitle counted them.
            <LoadError what={t("activitiesWhat")} onRetry={() => void loadLibrary()} />
          ) : libraryStatus === "loading" && assignedCount > 0 ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-12 w-full" />
            </div>
          ) : assignedActivities.length === 0 ? (
            <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              {t("noAssigned")}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded border border-border">
              {assignedActivities.map((activity) => {
                const displayTitle = activity.title?.trim() || activity.activityId;
                const subtitle = activity.teachingGoal?.trim() || undefined;
                // Edit the activity itself (class-independent — it may run in
                // several classes). Carries THIS class, so the editor's tutor
                // line names the tutor this class chose, not "the default".
                const q = new URLSearchParams({ classId: theClass.classId });
                if (activity.title) q.set("title", activity.title);
                const editHref = `/teacher/activities/${encodeURIComponent(activity.activityId)}?${q.toString()}`;
                return (
                  <li key={activity.activityId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <LessonAvatar />
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{displayTitle}</span>
                        {subtitle ? <span className="line-clamp-1 text-xs text-muted-foreground">{subtitle}</span> : null}
                      </div>
                    </div>
                    {/* 1.1.151 F1c — warn here too: this is the list read before a lesson. */}
                    <div className="w-full empty:hidden">
                      <FailedMaterialsWarning
                        materials={activity.materials}
                        statuses={ragStatuses}
                        onUpdated={updateRagStatus}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={editHref}
                        title={t("editTitle", { title: displayTitle })}
                        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                      >
                        {t("edit")}
                      </Link>
                      <RowMenu
                        label={t("activityMenu", { title: displayTitle })}
                        items={[
                          {
                            id: "remove",
                            label: t("remove"),
                            disabled: busyActivity === activity.activityId,
                            onSelect: () => void handleRemoveActivity(activity.activityId),
                          },
                        ]}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SettingsSection>

      {/* Danger row — moved here from the class list (UI sweep 2026-11).
          Owner only: the backend refuses a delete from anyone else, so a
          researcher acting for the owner is not offered one. */}
      {!onBehalf && (
      <section
        aria-labelledby="class-danger"
        className="flex flex-wrap items-center justify-between gap-3 rounded border border-destructive/30 px-4 py-3"
      >
        <div className="flex min-w-0 flex-col">
          <h2 id="class-danger" className="text-sm font-semibold">
            {t("dangerTitle")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("dangerHint")}</p>
        </div>
        <Button variant="destructive-outline" size="sm" onClick={() => void handleDeleteClass()} pending={deleting}>
          {t("deleteClass")}
        </Button>
      </section>
      )}
    </>
  );

  return (
    <TeacherPage
      breadcrumb={
        <Link href="/teacher/classes" className="flex w-fit items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("breadcrumb")}
        </Link>
      }
      title={theClass.name}
      subtitle={t("subtitle", { groups: liveCodes.length, activities: assignedCount })}
    >
      <ActingForOwnerBanner resource={theClass} kind="class" />
      {explicitTab || defaultTab !== null ? (
        <TeacherTabs
          ariaLabel={t("tabsLabel")}
          active={tab}
          onChange={(next) => setTab(next as ClassTab)}
          tabs={[
            { id: "lesson", label: t("tabLesson"), content: lessonView },
            { id: "after", label: t("tabAfter"), content: afterView },
            { id: "setup", label: t("tabSetup"), content: setupView },
          ]}
        />
      ) : (
        <PageSkeleton rows={3} label={t("loading")} />
      )}
      {/* Read-only analytics co-pilot scoped to this class — ask about it while
          you look at it; answers in chat, changes nothing. */}
      <ClassAnalyticsCopilot classId={theClass.classId} className={theClass.name} />
    </TeacherPage>
  );
}

/** Inline picker (ALS-1 M1.3), opened from "Tilføj aktivitet ▾ › Fra dit
 *  bibliotek…". Lists the library activities not yet assigned to this class —
 *  click a row to assign it. Inline (vs a modal) so screen readers meet it in
 *  the natural document flow. */
function ActivityPicker({
  options,
  loading,
  onPick,
  onCancel,
  busyId,
}: {
  options: ActivityPayload[];
  loading: boolean;
  onPick: (activityId: string) => void;
  onCancel: () => void;
  busyId: string | null;
}) {
  const t = useT("ClassDetailPage");
  return (
    <div
      role="region"
      aria-label={t("pickerLabel")}
      className="flex flex-col gap-2 rounded border border-border bg-background p-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("yourActivities")}</h3>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </header>
      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : options.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("pickerAllAssigned")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {options.map((activity) => {
            const title = activity.title?.trim() || activity.activityId;
            return (
              <li key={activity.activityId}>
                <button
                  type="button"
                  onClick={() => onPick(activity.activityId)}
                  disabled={busyId !== null}
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <LessonAvatar />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{title}</span>
                      {activity.teachingGoal ? (
                        <span className="line-clamp-1 text-xs text-muted-foreground">{activity.teachingGoal}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {busyId === activity.activityId ? t("adding") : t("add")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Thumbnail for an activity row — the same fallback cover the student-side
 *  /lessons picker shows, so an activity reads the same on both surfaces. */
function LessonAvatar() {
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-gradient-to-br from-muted to-accent"
    >
      <BookOpen className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}
