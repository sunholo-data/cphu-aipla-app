"use client";

import Link from "next/link";
import { useToast } from "@/hooks/useToast";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
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
  revokeGroupCode,
} from "@/lib/teacherApi";
import { ClassInsightsPanel } from "@/components/teacher/insights/ClassInsightsPanel";
import { BudgetPanel } from "@/components/teacher/BudgetPanel";
import { ActingForOwnerBanner, LastEditedLine } from "@/components/teacher/ActingForOwnerBanner";
import { ClassDetailsPanel } from "@/components/teacher/ClassDetailsPanel";
import { ClassVoiceSettingsPanel } from "@/components/teacher/ClassVoiceSettingsPanel";
import { TutorPicker } from "@/components/teacher/TutorPicker";
import { ClassConceptsOverview } from "@/components/teacher/ClassConceptsOverview";
import { ClassGroupPairings } from "@/components/teacher/ClassGroupPairings";
import { SettingsSection } from "@/components/teacher/ui/SettingsSection";
import { SettingsMap } from "@/components/teacher/SettingsMap";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";

import { handleExportSessions } from "./_exportHelpers";
import { ClassAnalyticsCopilot } from "./_ClassAnalyticsCopilot";
import { LiveClassView } from "./_LiveClassView";
import { ClassListSheet } from "./_ClassListSheet";
import { formatRelativeTime } from "@/lib/relativeTime";
import { useLocaleMode, useT } from "@/i18n";
import { useTeacherAuth } from "@/hooks/useTeacherAuth";


export default function TeacherClassDetailPage() {
  // 1.1.108 M2 — the teacher's own language (their DA | EN choice).
  const t = useT("ClassDetailPage");
  const tList = useT("ClassListSheet");
  const localeMode = useLocaleMode();
  const timeLocale = localeMode === "bilingual" ? "da" : localeMode;
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
  const [confirmRevokeCode, setConfirmRevokeCode] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
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
          err instanceof Error ? err.message : t("loadFailedGeneric"),
        );
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

  // Refresh recent sessions alongside the class. Runs whenever id changes.
  useEffect(() => {
    if (!id) return;
    void listClassRecentSessions(id, 20)
      .then(setRecentSessions)
      .catch(() => setRecentSessions([]));
  }, [id]);

  // 1.1.123 M0 — whose class this is. A researcher may open (and edit) any
  // teacher's class; the picker below must then offer the OWNER's library, not
  // the researcher's, because the assign rule is keyed on the class owner.
  const { user: viewer } = useTeacherAuth({ redirectOnSignedOut: false });
  const ownerUid = cls?.ownerUid ?? null;
  const onBehalf = Boolean(viewer?.uid && ownerUid && viewer.uid !== ownerUid);

  // Load the viewer's own activity library once on mount. Fire-and-forget — the
  // class itself loads independently; the picker shows an empty state on failure.
  useEffect(() => {
    // 1.1.61: paginated now — this is the assignment picker's full library, so
    // request the cap rather than the default page.
    void listActivities("own", { limit: 200 })
      .then((page) => setLibraryActivities(page.activities))
      .catch(() => setLibraryActivities([]));
  }, []);

  // …and, once the class and viewer are both known and differ, replace it with
  // the OWNER's library: the researcher scan (scope=all) is the only list that
  // includes another teacher's private activities; filter it down to theirs.
  useEffect(() => {
    if (!onBehalf || !ownerUid) return;
    void listActivities("all", { limit: 200 })
      .then((page) => setLibraryActivities(page.activities.filter((a) => a.ownerUid === ownerUid)))
      .catch(() => setLibraryActivities([]));
  }, [ownerUid, onBehalf]);

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
      <p className="text-sm text-muted-foreground">{t("loading")}</p>
    );
  }

  if (loadStatus === "error" || !cls) {
    return (
      <p
        role="alert"
        className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {t("loadFailed", { error: loadError ?? t("unknownError") })}
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
        err instanceof Error ? t("exportFailedDetail", { error: err.message }) : t("exportFailed"),
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
      showToast(t("codeCreated", { code }), 4000);
      await refresh();
    } catch (err) {
      showToast(
        err instanceof Error
          ? t("codeCreateFailedDetail", { error: err.message })
          : t("codeCreateFailed"),
        5000,
      );
    } finally {
      setMinting(false);
    }
  }

  function handleCopyCode(code: string) {
    void navigator.clipboard?.writeText(code).catch(() => {});
    showToast(t("copied", { code }), 2500);
  }

  // A bare code doesn't say WHICH AIPLA it belongs to, and the three
  // deployments differ only by an opaque Cloud Run hostname — a teacher lost
  // two hours on 2026-08-04 handing out dev codes that students typed into
  // test, where every join 401s. The link carries the environment with it.
  function handleCopyJoinLink(code: string) {
    const link = `${window.location.origin}/group?code=${encodeURIComponent(code)}`;
    void navigator.clipboard?.writeText(link).catch(() => {});
    showToast(t("linkCopied", { code }), 2500);
  }

  async function handleResetSession(code: string) {
    setResetting(true);
    try {
      await resetGroupSession(cls!.classId, code);
      setConfirmResetCode(null);
      showToast(t("resetDone", { code }), 4000);
    } catch (err) {
      showToast(
        err instanceof Error ? t("resetFailedDetail", { error: err.message }) : t("resetFailed"),
        5000,
      );
    } finally {
      setResetting(false);
    }
  }

  /** Revoke a leaked join code (2026-09-29).
   *
   *  The endpoint has existed since the permission model landed and had NO UI,
   *  so a teacher whose code got out could only reset the session — which does
   *  not stop anyone rejoining with the same code. Found by the new
   *  check-client-api gate, not by anyone noticing.
   *
   *  ⚠️ Harder than Reset, and the copy says so: `revoke_group_code` DELETES
   *  the anon_groups doc, so the next token verification fails. A student
   *  mid-lesson is cut off at their next message. The code string can never be
   *  reissued — a replacement is a different code — and the group's existing
   *  work is kept, not erased (erasure is 1.1.80's own thing).
   */
  async function handleRevokeCode(code: string) {
    setRevoking(true);
    try {
      await revokeGroupCode(cls!.classId, code);
      setConfirmRevokeCode(null);
      showToast(t("revokeDone", { code }), 5000);
      await refresh();
    } catch (err) {
      showToast(err instanceof Error ? t("revokeFailedDetail", { error: err.message }) : t("revokeFailed"), 5000);
    } finally {
      setRevoking(false);
    }
  }

  async function handleAddActivity(activityId: string) {
    setBusyActivity(activityId);
    try {
      await patchClassActivities(cls!.classId, { add: [activityId] });
      setShowPicker(false);
      await refresh();
      const title = libraryActivities.find((a) => a.activityId === activityId)?.title ?? activityId;
      showToast(t("added", { title }), 3000);
    } catch (err) {
      showToast(
        err instanceof Error ? t("addFailedDetail", { error: err.message }) : t("addFailed"),
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
      showToast(t("removed", { title }), 3000);
    } catch (err) {
      showToast(
        err instanceof Error ? t("removeFailedDetail", { error: err.message }) : t("removeFailed"),
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
          {t("breadcrumb")}
        </Link>
      }
      title={cls.name}
      subtitle={t("subtitle", { groups: cls.groupCodes.length, activities: (cls.activityIds ?? []).length })}
    >
      <ActingForOwnerBanner resource={cls} kind="class" />
      <SettingsMap highlight="class" classId={cls.classId} />
      {/* 1.1.139 M2 (first slice) — the class's concepts, in aggregate, are
          the first thing after the header. They used to sit collapsed at the
          very bottom; JB: "the UI of finding concepts [should be] easier".
          Renders nothing (or one muted line) until there are concepts. */}
      <ClassConceptsOverview classId={cls.classId} />
      <LiveClassView classId={cls.classId} />
      <SettingsSection
        title={t("groups")}
        description={t.rich("groupsDescription", {
          origin: joinOrigin || "…",
          code: (chunks) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{chunks}</code>,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
        action={
          <button
            type="button"
            onClick={handleNewGroup}
            disabled={minting}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {minting ? t("creating") : t("newGroup")}
          </button>
        }
      >
        {cls.groupCodes.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {t("noCodes")}
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
                        {t("lastActive", { when: formatRelativeTime(latest.lastMessageAt, Date.now(), timeLocale), n: latest.turnCount })}
                        {latest.title ? ` · ${latest.title}` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("noActivity")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyJoinLink(code)}
                      title={t("copyJoinLinkTitle", { link: `${joinOrigin}/group?code=${code}` })}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      <LinkIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("copyJoinLink")}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyCode(code)}
                      title={t("copyCodeTitle")}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("copyCode")}
                    </button>
                    {confirmResetCode === code ? (
                      <>
                        <span className="text-xs text-muted-foreground">{t("resetConfirmQ")}</span>
                        <button
                          type="button"
                          onClick={() => void handleResetSession(code)}
                          disabled={resetting}
                          className="rounded border border-destructive px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {resetting ? t("resetting") : t("confirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmResetCode(null)}
                          disabled={resetting}
                          className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          {t("cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmResetCode(code)}
                        title={t("resetTitle")}
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
                      >
                        <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("resetSession")}
                      </button>
                    )}
                    {confirmRevokeCode === code ? (
                      <>
                        {/* Two-step, and the consequence is stated rather than
                            implied: this signs students out mid-lesson and the
                            code can never be reissued. */}
                        <span className="text-xs text-destructive">{t("revokeWarning")}</span>
                        <button
                          type="button"
                          onClick={() => void handleRevokeCode(code)}
                          disabled={revoking}
                          className="rounded border border-destructive px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                        >
                          {revoking ? t("revoking") : t("revokeConfirm")}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeCode(null)}
                          disabled={revoking}
                          className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
                        >
                          {t("cancel")}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevokeCode(code)}
                        aria-label={t("revokeAria", { code })}
                        title={t("revokeTitle")}
                        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("revoke")}
                      </button>
                    )}
                    <Link
                      href={`/teacher/reports/groups/${code}`}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                      aria-label={t("reportAria", { code })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("report")}
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      {/* 1.1.137 — names against codes, kept ONLY in this browser (ADR-001).
          Collapsed by default: it is a before/after-lesson tool, and closed it
          renders nothing, so no code appears twice on the page. */}
      <SettingsSection
        id="class-list"
        title={tList("title")}
        description={tList("description")}
        collapsible
        defaultOpen={false}
      >
        <ClassListSheet
          classId={cls.classId}
          className={cls.name}
          codes={cls.groupCodes}
          joinOrigin={joinOrigin}
        />
      </SettingsSection>

      <SettingsSection
        id="class-settings"
        title={t("classSettings")}
        description={t("classSettingsDescription")}
      >
        <div className="flex flex-col gap-6">
          {/* 1.1.112 — renaming lives here because this is where a teacher looks
              for it. The endpoint and the API client both already existed; only
              the control was missing. */}
          <div>
            <h3 className="mb-2 text-sm font-medium">{t("name")}</h3>
            <ClassDetailsPanel
              classId={cls.classId}
              initialName={cls.name}
              initialDescription={cls.description ?? null}
              onSaved={refresh}
            />
            {/* 1.1.123 M3 — present only when someone other than the owner
                wrote this class; the owner's own edits never stamp it. */}
            <div className="mt-2">
              <LastEditedLine resource={cls} />
            </div>
          </div>
          {/* 1.1.91 — ONE tutor choice: name, picture, voice, tone and
              teaching approach together. This REPLACES the separate persona
              picker; showing both was two lists of the same thing.

              Existing classes carry `persona` and no `tutorId`, and the base
              tutor ids are the persona ids, so falling back to `persona` shows
              their current identity as already selected rather than as
              unconfigured. Choosing anything writes `tutorId`, which supersedes
              `persona` at resolution time. */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t("tutor")}</h3>
              {/* 1.1.125 M0 — Approaches left the nav; this is where a teacher
                  meets one (the tutor's teaching approach), so it is linked
                  from here. Decision 1 in the design doc picks between this
                  and the account-menu entry; both ship until then. */}
              <Link
                href="/teacher/research/frameworks"
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t("teachingApproaches")}
              </Link>
            </div>
            <TutorPicker
              classId={cls.classId}
              selectedTutorId={cls.tutorId ?? cls.persona ?? null}
              onChange={refresh}
              recordingEnabled={cls.recordingEnabled ?? false}
            />
          </div>
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
        title={t("assignedTitle")}
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/teacher/activities/new?classId=${encodeURIComponent(cls.classId)}`}
              title={t("newActivityTitle")}
              className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("newActivity")}
            </Link>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              disabled={addableActivities.length === 0}
              title={
                addableActivities.length === 0
                  ? t("allAssigned")
                  : t("assignTitle")
              }
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("addActivity")}
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
            {t("noAssigned")}
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
                      title={t("editTitle", { title: displayTitle })}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("edit")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleRemoveActivity(activity.activityId)}
                      disabled={busyActivity === activity.activityId}
                      aria-label={t("removeAria", { title: displayTitle })}
                      className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("remove")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection
        title={t("spend")}
        description={t("spendDescription")}
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
          {t("showInsights")}
          <span className="text-xs font-normal text-muted-foreground/70">{t("showInsightsHint")}</span>
        </button>
      )}

      <SettingsSection
        title={t("recentActivity")}
        action={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => runExport("csv")}
              disabled={recentSessions.length === 0 || exporting !== null}
              title={t("exportCsvTitle")}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {exporting === "csv" ? t("exporting") : "CSV"}
            </button>
            <button
              type="button"
              onClick={() => runExport("json")}
              disabled={recentSessions.length === 0 || exporting !== null}
              title={t("exportJsonTitle")}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {exporting === "json" ? t("exporting") : "JSON"}
            </button>
          </div>
        }
      >
        {recentSessions.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            {t("noSessions")}
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
                        {t("turns", { n: row.turnCount })} · {formatRelativeTime(row.lastMessageAt, Date.now(), timeLocale)}
                      </span>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      {t("view")}
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
                      {t("turns", { n: row.turnCount })} · {formatRelativeTime(row.lastMessageAt, Date.now(), timeLocale)}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </SettingsSection>

      {/* CONCEPT-2 M7 — the payoff of not flattening the class into an average
          at M4: a class average has no pairings in it. Suggestions for who
          could talk to whom, never a standing. */}
      <SettingsSection
        title={t("pairingsTitle")}
        description={t("pairingsDescription")}
        collapsible
        defaultOpen={false}
      >
        <ClassGroupPairings classId={cls.classId} />
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
  const t = useT("ClassDetailPage");
  return (
    <div
      role="region"
      aria-label={t("pickerLabel")}
      className="flex flex-col gap-2 rounded border border-border bg-background p-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("yourActivities")}</h3>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {t("cancel")}
        </button>
      </header>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("pickerAllAssigned")}
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
