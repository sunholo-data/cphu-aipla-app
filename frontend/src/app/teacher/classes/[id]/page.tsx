"use client";

import Link from "next/link";
import { useToast } from "@/hooks/useToast";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Link as LinkIcon,
  MessageSquare,
  Plus,
  Settings,
  X,
} from "lucide-react";

import {
  type ActivityPayload,
  type ClassPayload,
  type SessionRow,
  getClass,
  listActivities,
  listClassRecentSessions,
  mintGroupCodes,
  patchClassActivities,
  resetGroupSession,
} from "@/lib/teacherApi";
import { ClassInsightsPanel } from "@/components/teacher/insights/ClassInsightsPanel";
import { BudgetPanel } from "@/components/teacher/BudgetPanel";
import { ClassVoiceSettingsPanel } from "@/components/teacher/ClassVoiceSettingsPanel";
import { ClassPersonaPanel } from "@/components/teacher/ClassPersonaPanel";
import { SettingsSection } from "@/components/teacher/ui/SettingsSection";
import { SettingsMap } from "@/components/teacher/SettingsMap";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

import { handleExportSessions } from "./_exportHelpers";
import { ClassAnalyticsCopilot } from "./_ClassAnalyticsCopilot";
import { LiveClassView } from "./_LiveClassView";
import { formatRelativeTime } from "@/lib/relativeTime";

export default function TeacherClassDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [cls, setCls] = useState<ClassPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ok" | "not-found" | "error"
  >("loading");
  const { toast, showToast } = useToast();
  const [minting, setMinting] = useState(false);
  // Read after mount — the server render has no window, and the value must be
  // the address THIS teacher is on, not one baked at build time.
  const [joinOrigin, setJoinOrigin] = useState("");
  const [confirmResetCode, setConfirmResetCode] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Insights (4 BigQuery queries) are deferred — load on demand so opening a
  // class is fast (Firestore-only). See ClassInsightsPanel.
  const [showInsights, setShowInsights] = useState(false);

  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  // ALS-1 M1.3 — the Activities section is backed by the teacher's class-independent
  // activity library (/api/activities) + cls.activityIds. "Add activity" assigns one
  // of the teacher's own activities to this class (replaces the old skills-catalogue
  // "Add from catalogue" → patchLessons path).
  const [libraryActivities, setLibraryActivities] = useState<ActivityPayload[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [busyActivity, setBusyActivity] = useState<string | null>(null);

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
        setLoadError(
          err instanceof Error ? err.message : "failed to load class",
        );
        setLoadStatus("error");
      }
    }
  }, [id]);

  useEffect(() => {
    if (id) void refresh();
  }, [id, refresh]);

  useEffect(() => {
    setJoinOrigin(window.location.origin);
  }, []);

  // Refresh recent sessions alongside the class. Runs whenever id changes.
  useEffect(() => {
    if (!id) return;
    void listClassRecentSessions(id, 20)
      .then(setRecentSessions)
      .catch(() => setRecentSessions([]));
  }, [id]);

  // Load the teacher's activity library once on mount. Fire-and-forget — the
  // class itself loads independently; the picker shows an empty state on failure.
  useEffect(() => {
    // 1.1.61: paginated now — this is the assignment picker's full library, so
    // request the cap rather than the default page.
    void listActivities("own", { limit: 200 })
      .then((page) => setLibraryActivities(page.activities))
      .catch(() => setLibraryActivities([]));
  }, []);

  // Derived views of the library split by whether they're assigned to this class.
  const assignedActivities = useMemo<ActivityPayload[]>(() => {
    if (!cls) return [];
    const byId = new Map(libraryActivities.map((a) => [a.activityId, a]));
    return (cls.activityIds ?? [])
      .map((aid) => byId.get(aid))
      .filter((a): a is ActivityPayload => a !== undefined);
  }, [cls, libraryActivities]);

  const addableActivities = useMemo<ActivityPayload[]>(() => {
    if (!cls) return libraryActivities;
    const taken = new Set(cls.activityIds ?? []);
    return libraryActivities.filter((a) => !taken.has(a.activityId));
  }, [cls, libraryActivities]);

  // Most recent session per group code — for the per-row "last active" hint.
  const latestByGroup = useMemo<Map<string, SessionRow>>(() => {
    const map = new Map<string, SessionRow>();
    for (const s of recentSessions) {
      if (s.groupCode && !map.has(s.groupCode)) {
        map.set(s.groupCode, s);
      }
    }
    return map;
  }, [recentSessions]);

  // Best-effort skill-id → name for the session-history rows (a session records
  // the skill it ran). Derived from the library by skill id; sessions usually
  // carry their own `title`, so this is only a fallback before the row's id.
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
    return (
      <p className="text-sm text-muted-foreground">Loading class&hellip;</p>
    );
  }

  if (loadStatus === "error" || !cls) {
    return (
      <p
        role="alert"
        className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        Couldn&rsquo;t load class: {loadError ?? "unknown error"}
      </p>
    );
  }

  async function runExport(format: "csv" | "json") {
    if (exporting !== null) return;
    setExporting(format);
    try {
      await handleExportSessions(cls, skillNameById, format);
    } catch (err) {
      showToast(
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
        5000,
      );
    } finally {
      setExporting(null);
    }
  }

  async function handleNewGroup() {
    setMinting(true);
    try {
      const result = await mintGroupCodes(cls!.classId, 1);
      const code = result.codes[0] ?? "";
      void navigator.clipboard?.writeText(code).catch(() => {});
      showToast(`Group code ${code} created — copied to clipboard`, 4000);
      await refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? `Mint failed: ${err.message}` : "Mint failed",
        5000,
      );
    } finally {
      setMinting(false);
    }
  }

  function handleCopyCode(code: string) {
    void navigator.clipboard?.writeText(code).catch(() => {});
    showToast(`Copied ${code}`, 2500);
  }

  // A bare code doesn't say WHICH AIPLA it belongs to, and the three
  // deployments differ only by an opaque Cloud Run hostname — a teacher lost
  // two hours on 2026-08-04 handing out dev codes that students typed into
  // test, where every join 401s. The link carries the environment with it.
  function handleCopyJoinLink(code: string) {
    const link = `${window.location.origin}/group?code=${encodeURIComponent(code)}`;
    void navigator.clipboard?.writeText(link).catch(() => {});
    showToast(`Copied join link for ${code}`, 2500);
  }

  async function handleResetSession(code: string) {
    setResetting(true);
    try {
      await resetGroupSession(cls!.classId, code);
      setConfirmResetCode(null);
      showToast(`Session reset for ${code} — next join starts fresh`, 4000);
    } catch (err) {
      showToast(
        err instanceof Error ? `Reset failed: ${err.message}` : "Reset failed",
        5000,
      );
    } finally {
      setResetting(false);
    }
  }

  async function handleAddActivity(activityId: string) {
    setBusyActivity(activityId);
    try {
      await patchClassActivities(cls!.classId, { add: [activityId] });
      setShowPicker(false);
      await refresh();
      const title = libraryActivities.find((a) => a.activityId === activityId)?.title ?? activityId;
      showToast(`Added "${title}"`, 3000);
    } catch (err) {
      showToast(
        err instanceof Error ? `Add failed: ${err.message}` : "Add failed",
        5000,
      );
    } finally {
      setBusyActivity(null);
    }
  }

  async function handleRemoveActivity(activityId: string) {
    setBusyActivity(activityId);
    try {
      await patchClassActivities(cls!.classId, { remove: [activityId] });
      await refresh();
      const title = libraryActivities.find((a) => a.activityId === activityId)?.title ?? activityId;
      showToast(`Removed "${title}"`, 3000);
    } catch (err) {
      showToast(
        err instanceof Error ? `Remove failed: ${err.message}` : "Remove failed",
        5000,
      );
    } finally {
      setBusyActivity(null);
    }
  }

  return (
    <TeacherPage
      breadcrumb={
        <Link
          href="/teacher/classes"
          className="flex w-fit items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
      }
      title={cls.name}
      subtitle={
        <>
          {cls.groupCodes.length} group
          {cls.groupCodes.length === 1 ? "" : "s"} · {(cls.activityIds ?? []).length}{" "}
          {(cls.activityIds ?? []).length === 1 ? "activity" : "activities"} assigned
        </>
      }
    >
      <SettingsMap highlight="class" classId={cls.classId} />
      <LiveClassView classId={cls.classId} />
      <SettingsSection
        title="Groups"
        description={
          <>
            Students join at{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {joinOrigin || "…"}/group
            </code>
            . Codes work <strong>only</strong> on this address — a code from
            another AIPLA site will be rejected. &ldquo;Copy join link&rdquo;
            hands out the address and the code together.
          </>
        }
        action={
          <button
            type="button"
            onClick={handleNewGroup}
            disabled={minting}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {minting ? "Minting…" : "New group"}
          </button>
        }
      >
        {cls.groupCodes.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No group codes yet. Mint one with &ldquo;New group&rdquo; — students
            join the chat by entering the code.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {cls.groupCodes.map((code) => {
              const latest = latestByGroup.get(code);
              return (
                <li
                  key={code}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm w-fit">
                      {code}
                    </code>
                    {latest ? (
                      <span className="text-xs text-muted-foreground">
                        Last active {formatRelativeTime(latest.lastMessageAt)} · {latest.turnCount} turn{latest.turnCount === 1 ? "" : "s"}
                        {latest.title ? ` · ${latest.title}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No activity yet</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyJoinLink(code)}
                      title={`${joinOrigin}/group?code=${code} — the address and the code together, so students can't land on the wrong AIPLA site`}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy join link
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(code)}
                      title="Just the code — the student must already be on the right site"
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      Copy code
                    </button>
                    {confirmResetCode === code ? (
                      <>
                        <span className="text-xs text-muted-foreground">Reset session?</span>
                        <button
                          type="button"
                          onClick={() => void handleResetSession(code)}
                          disabled={resetting}
                          className="rounded border border-destructive px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {resetting ? "Resetting…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmResetCode(null)}
                          disabled={resetting}
                          className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmResetCode(code)}
                        title="Archive the current session — the next student join will start a new conversation"
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                      >
                        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        Reset session
                      </button>
                    )}
                    <Link
                      href={`/teacher/reports/groups/${code}`}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                      aria-label={`View session report for ${code}`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Report
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        id="class-settings"
        title="Class settings"
        description="The tutor persona, voice, and what students can do — for this class."
      >
        <div className="flex flex-col gap-6">
          <ClassPersonaPanel
            classId={cls.classId}
            initialPersona={cls.persona ?? null}
            onSaved={refresh}
          />
          <ClassVoiceSettingsPanel
            classId={cls.classId}
            initial={cls.voice ?? null}
            initialVoiceInput={cls.voiceInputEnabled ?? false}
            initialRecording={cls.recordingEnabled ?? false}
            onSaved={refresh}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Activities assigned to this class"
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/activities/new?classId=${encodeURIComponent(cls.classId)}`}
              title="Create a new chat-only concept activity from scratch"
              className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New activity
            </Link>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              disabled={addableActivities.length === 0}
              title={
                addableActivities.length === 0
                  ? "All your activities are already assigned to this class"
                  : "Assign one of your activities to this class"
              }
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add activity
            </button>
          </div>
        }
      >
        {showPicker ? (
          <ActivityPicker
            options={addableActivities}
            onPick={handleAddActivity}
            onCancel={() => setShowPicker(false)}
            busyId={busyActivity}
          />
        ) : null}

        {assignedActivities.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No activities assigned yet. Click &ldquo;New activity&rdquo; to create
            one from scratch, or &ldquo;Add activity&rdquo; to assign one from your
            library. Students who join via this class&rsquo;s group codes will only
            see activities listed here.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {assignedActivities.map((activity) => {
              const displayTitle = activity.title?.trim() || activity.activityId;
              const subtitle = activity.teachingGoal?.trim() || undefined;
              // Edit the activity itself (class-independent — it may run in several
              // classes); the Activities-page editor is the one coherent surface.
              const editHref = `/teacher/activities/${encodeURIComponent(activity.activityId)}${
                activity.title ? `?title=${encodeURIComponent(activity.title)}` : ""
              }`;
              return (
                <li
                  key={activity.activityId}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <LessonAvatar avatar="" title={displayTitle} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{displayTitle}</span>
                      {subtitle ? (
                        <span className="line-clamp-1 text-xs text-muted-foreground">{subtitle}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Link
                      href={editHref}
                      title={`Edit ${displayTitle}`}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemoveActivity(activity.activityId)}
                      disabled={busyActivity === activity.activityId}
                      aria-label={`Remove ${displayTitle}`}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Spend"
        description="Model cost for this class. Estimated from token usage at current provider rates."
        collapsible
        defaultOpen={false}
      >
        <BudgetPanel classId={cls.classId} />
      </SettingsSection>

      {showInsights ? (
        <ClassInsightsPanel classId={cls.classId} />
      ) : (
        <button
          type="button"
          onClick={() => setShowInsights(true)}
          className="flex items-center gap-2 self-start rounded border border-dashed border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted/50"
        >
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          Show class insights
          <span className="text-xs font-normal text-muted-foreground/70">— loads analytics (a few seconds)</span>
        </button>
      )}

      <SettingsSection
        title="Recent activity"
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => runExport("csv")}
              disabled={recentSessions.length === 0 || exporting !== null}
              title="Export all sessions in this class with full transcripts as CSV"
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {exporting === "csv" ? "Exporting…" : "CSV"}
            </button>
            <button
              type="button"
              onClick={() => runExport("json")}
              disabled={recentSessions.length === 0 || exporting !== null}
              title="Export all sessions in this class with full transcripts as JSON"
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {exporting === "json" ? "Exporting…" : "JSON"}
            </button>
          </div>
        }
      >
        {recentSessions.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No student sessions yet. Sessions appear here once students join a group and start chatting.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {recentSessions.slice(0, 10).map((row) =>
              row.groupCode ? (
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
                        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        {row.title ?? skillNameById.get(row.skillId) ?? row.skillId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} · {formatRelativeTime(row.lastMessageAt)}
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
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {row.title ?? skillNameById.get(row.skillId) ?? row.skillId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} · {formatRelativeTime(row.lastMessageAt)}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </SettingsSection>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 text-sm"
      >
        {toast ? (
          <div className="pointer-events-auto rounded border border-border bg-background px-4 py-2 shadow-md">
            {toast}
          </div>
        ) : null}
      </div>
      {/* Read-only analytics co-pilot scoped to this class — ask about it while
          you look at it; answers in chat, changes nothing. */}
      <ClassAnalyticsCopilot classId={cls.classId} className={cls.name} />
    </TeacherPage>
  );
}

/** Inline picker (ALS-1 M1.3) rendered above the assigned-activities list when
 *  the teacher clicks "Add activity". Lists the teacher's library activities not
 *  yet assigned to this class — click a row to assign it. Cancel collapses without
 *  writing. Inline (vs a modal) so page state stays simple and screen readers see
 *  it in the natural document flow. */
function ActivityPicker({
  options,
  onPick,
  onCancel,
  busyId,
}: {
  options: ActivityPayload[];
  onPick: (activityId: string) => void;
  onCancel: () => void;
  busyId: string | null;
}) {
  return (
    <div
      role="region"
      aria-label="Pick an activity to assign"
      className="flex flex-col gap-2 rounded border border-border bg-background p-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Your activities</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </header>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every activity in your library is already assigned to this class. Create a
          new one with &ldquo;New activity&rdquo;.
        </p>
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
                  className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <LessonAvatar avatar="" title={title} />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{title}</span>
                      {activity.teachingGoal ? (
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {activity.teachingGoal}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {busyId === activity.activityId ? "Adding…" : "Add"}
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

/** Thumbnail used in the linked-lessons list + the picker. Mirrors the
 *  LessonCover fallback pattern from the student-side /lessons picker
 *  so a lesson's identity reads the same on both surfaces. Square
 *  64px-ish thumb works for both list-row and picker contexts. */
function LessonAvatar({ avatar, title }: { avatar: string; title: string }) {
  if (avatar) {
    return (
      <div className="h-10 w-14 shrink-0 overflow-hidden rounded bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatar}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-gradient-to-br from-muted to-accent"
    >
      <BookOpen className="h-5 w-5 text-muted-foreground" />
    </div>
  );
  // title param kept in signature for API parity with the avatar
  // branch (where the alt text might be derived from it later); not
  // rendered here since the surrounding row already labels the lesson.
  void title;
}
