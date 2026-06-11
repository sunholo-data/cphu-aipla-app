"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Copy,
  Download,
  ExternalLink,
  FileText,
  MessageCircle,
  MessageSquare,
  Plus,
  Settings,
  X,
} from "lucide-react";

import {
  type ClassPayload,
  type SessionRow,
  type SkillSummary,
  getClass,
  listAccessibleSkills,
  listClassRecentSessions,
  mintGroupCodes,
  patchLessons,
  resetGroupSession,
} from "@/lib/teacherApi";
import { ClassInsightsPanel } from "@/components/teacher/insights/ClassInsightsPanel";
import { ClassVoiceSettingsPanel } from "@/components/teacher/ClassVoiceSettingsPanel";
import { SettingsSection } from "@/components/teacher/ui/SettingsSection";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

import { handleExportSessions } from "./_exportHelpers";

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

export default function TeacherClassDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [cls, setCls] = useState<ClassPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ok" | "not-found" | "error"
  >("loading");
  const [toast, setToast] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [confirmResetCode, setConfirmResetCode] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // Insights (4 BigQuery queries) are deferred — load on demand so opening a
  // class is fast (Firestore-only). See ClassInsightsPanel.
  const [showInsights, setShowInsights] = useState(false);

  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);

  // 1.A follow-up (2026-05-26) — Lessons section now backed by the
  // real /api/skills catalogue + cls.lessons[]. Pick-from-list UI
  // replaces the disabled "v1.1 placeholder" button.
  const [catalogue, setCatalogue] = useState<SkillSummary[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [busyLesson, setBusyLesson] = useState<string | null>(null);

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

  // Refresh recent sessions alongside the class. Runs whenever id changes.
  useEffect(() => {
    if (!id) return;
    void listClassRecentSessions(id, 20)
      .then(setRecentSessions)
      .catch(() => setRecentSessions([]));
  }, [id]);

  // Load the lesson catalogue once on mount. Fire-and-forget — picker
  // shows "Loading lessons…" if the fetch is in flight at click time.
  useEffect(() => {
    void listAccessibleSkills()
      .then(setCatalogue)
      .catch(() => {
        // Picker just shows an empty state on failure — class itself
        // still loads independently.
        setCatalogue([]);
      });
  }, []);

  // Derived views of the catalogue split by whether they're already on
  // the class. Memoised so the picker doesn't recompute per render.
  const linkedLessons = useMemo<SkillSummary[]>(() => {
    if (!cls) return [];
    const byId = new Map(catalogue.map((s) => [s.skillId, s]));
    return cls.lessons
      .map((sid) => byId.get(sid))
      .filter((s): s is SkillSummary => s !== undefined);
  }, [cls, catalogue]);

  const availableLessons = useMemo<SkillSummary[]>(() => {
    if (!cls) return catalogue;
    const taken = new Set(cls.lessons);
    return catalogue.filter((s) => !taken.has(s.skillId));
  }, [cls, catalogue]);

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

  // Skill name lookup for the activity list.
  const skillNameById = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const s of catalogue) m.set(s.skillId, s.displayName || s.name);
    return m;
  }, [catalogue]);

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
      setToast(
        err instanceof Error ? `Export failed: ${err.message}` : "Export failed",
      );
      window.setTimeout(() => setToast(null), 5000);
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
      setToast(`Group code ${code} created — copied to clipboard`);
      window.setTimeout(() => setToast(null), 4000);
      await refresh();
    } catch (err) {
      setToast(
        err instanceof Error
          ? `Mint failed: ${err.message}`
          : "Mint failed",
      );
      window.setTimeout(() => setToast(null), 5000);
    } finally {
      setMinting(false);
    }
  }

  function handleCopyCode(code: string) {
    void navigator.clipboard?.writeText(code).catch(() => {});
    setToast(`Copied ${code}`);
    window.setTimeout(() => setToast(null), 2500);
  }

  async function handleResetSession(code: string) {
    setResetting(true);
    try {
      await resetGroupSession(cls!.classId, code);
      setConfirmResetCode(null);
      setToast(`Session reset for ${code} — next join starts fresh`);
      window.setTimeout(() => setToast(null), 4000);
    } catch (err) {
      setToast(
        err instanceof Error ? `Reset failed: ${err.message}` : "Reset failed",
      );
      window.setTimeout(() => setToast(null), 5000);
    } finally {
      setResetting(false);
    }
  }

  async function handleAddLesson(skillId: string) {
    setBusyLesson(skillId);
    try {
      await patchLessons(cls!.classId, { add: [skillId] });
      setShowPicker(false);
      await refresh();
      const title = catalogue.find((s) => s.skillId === skillId)?.displayName ?? skillId;
      setToast(`Added "${title}"`);
      window.setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(
        err instanceof Error ? `Add failed: ${err.message}` : "Add failed",
      );
      window.setTimeout(() => setToast(null), 5000);
    } finally {
      setBusyLesson(null);
    }
  }

  async function handleRemoveLesson(skillId: string) {
    setBusyLesson(skillId);
    try {
      await patchLessons(cls!.classId, { remove: [skillId] });
      await refresh();
      const title = catalogue.find((s) => s.skillId === skillId)?.displayName ?? skillId;
      setToast(`Removed "${title}"`);
      window.setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setToast(
        err instanceof Error ? `Remove failed: ${err.message}` : "Remove failed",
      );
      window.setTimeout(() => setToast(null), 5000);
    } finally {
      setBusyLesson(null);
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
          {cls.groupCodes.length === 1 ? "" : "s"} · {cls.lessons.length}{" "}
          {cls.lessons.length === 1 ? "activity" : "activities"} assigned
        </>
      }
      actions={
        <Link
          href="/teacher/analytics"
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          Chat with class data
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      }
    >
      <SettingsSection
        title="Groups"
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
                        Last active {relativeTime(latest.lastMessageAt)} · {latest.turnCount} turn{latest.turnCount === 1 ? "" : "s"}
                        {latest.title ? ` · ${latest.title}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No activity yet</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyCode(code)}
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
              disabled={availableLessons.length === 0}
              title={
                availableLessons.length === 0
                  ? "No more activities available to add"
                  : "Add an existing activity from the catalogue"
              }
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add from catalogue
            </button>
          </div>
        }
      >
        {showPicker ? (
          <LessonPicker
            options={availableLessons}
            onPick={handleAddLesson}
            onCancel={() => setShowPicker(false)}
            busyId={busyLesson}
          />
        ) : null}

        {linkedLessons.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No activities assigned yet. Click &ldquo;New activity&rdquo; to create
            a chat-only concept activity from scratch, or &ldquo;Add from
            catalogue&rdquo; to pick an existing one. Students who join via this
            class&rsquo;s group codes will only see activities listed here.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {linkedLessons.map((lesson) => (
              <li
                key={lesson.skillId}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <LessonAvatar
                    avatar={lesson.avatar}
                    title={lesson.displayName}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{lesson.displayName}</span>
                    {lesson.description ? (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {lesson.description}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* "Configure" button intentionally absent. The
                      /teacher/activities/<id> page exists for mock
                      activity ids only and 404s for real skill_ids.
                      Wiring it to /api/activity-configs for arbitrary
                      lessons is v1.1 territory
                      (teacher-artefact-parameters.md). */}
                  <button
                    type="button"
                    onClick={() => handleRemoveLesson(lesson.skillId)}
                    disabled={busyLesson === lesson.skillId}
                    aria-label={`Remove ${lesson.displayName}`}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title="Class settings"
        description="Voice and read-aloud language for this class."
      >
        <ClassVoiceSettingsPanel
          classId={cls.classId}
          initial={cls.voice ?? null}
          initialVoiceInput={cls.voiceInputEnabled ?? false}
          initialRecording={cls.recordingEnabled ?? false}
          onSaved={refresh}
        />
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
                      <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {row.title ?? skillNameById.get(row.skillId) ?? row.skillId}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} · {relativeTime(row.lastMessageAt)}
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
    </TeacherPage>
  );
}

/** Inline picker rendered above the linked-lessons list when the
 *  teacher clicks "Add lesson". Lists every catalogue entry not yet on
 *  the class — click a row to add it. Cancel collapses without writing.
 *  Kept inline (vs a modal) so the page state is simpler and screen
 *  readers see the picker in the natural document flow. */
function LessonPicker({
  options,
  onPick,
  onCancel,
  busyId,
}: {
  options: SkillSummary[];
  onPick: (skillId: string) => void;
  onCancel: () => void;
  busyId: string | null;
}) {
  return (
    <div
      role="region"
      aria-label="Pick an activity to add"
      className="flex flex-col gap-2 rounded border border-border bg-background p-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Catalogue</h3>
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
          No more activities available to add. Drop new activities into{" "}
          <code>backend/skills/templates/</code> and re-seed.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {options.map((lesson) => (
            <li key={lesson.skillId}>
              <button
                type="button"
                onClick={() => onPick(lesson.skillId)}
                disabled={busyId !== null}
                className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <LessonAvatar
                    avatar={lesson.avatar}
                    title={lesson.displayName}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{lesson.displayName}</span>
                    {lesson.description ? (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {lesson.description}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {busyId === lesson.skillId ? "Adding…" : "Add"}
                </span>
              </button>
            </li>
          ))}
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
