"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Download, MessagesSquare, ShieldAlert } from "lucide-react";

import {
  type ChatLogFilter,
  type ChatLogSession,
  type ChatLogTab,
  type ChatLogTimeline,
  UNASSIGNED_FRAMEWORK,
  fetchChatLogExport,
  getChatLogTimeline,
  listChatLogSessions,
  listChatLogTabs,
  listTeachingFrameworks,
} from "@/lib/teacherApi";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { InsightsTabs } from "@/components/teacher/insights/InsightsTabs";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { TeacherTabs } from "@/components/teacher/ui/TeacherTabs";
import { ChatLogTranscript } from "@/components/teacher/research/ChatLogTranscript";
import { FinalWorkPanel } from "@/components/teacher/work/FinalWorkPanel";
import { LoadError } from "@/components/ui/load-error";
import { PageSkeleton } from "@/components/ui/skeleton";
import { useUrlTab } from "@/hooks/useUrlTab";
import { useLocaleMode, useT, type Translate } from "@/i18n";
import { formatAbsoluteTime } from "@/lib/relativeTime";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
// Copy lives in messages/{da,en}/teacher-research.json (ResearchLogsPage) — 1.1.108.
const NONE = "—";

type Status = "loading" | "ok" | "forbidden" | "unreadable" | "error";

/** A tab's label: the framework's human name where we know it, else its id. */
function tabLabel(id: string, names: Map<string, string>, t: Translate<"ResearchLogsPage">): string {
  if (id === UNASSIGNED_FRAMEWORK) return t("unassignedTab");
  return names.get(id) ?? id;
}

/**
 * The researcher chat-log lens (1.1.109).
 *
 * Every conversation, grouped by the teaching approach that produced it, with
 * the transcript one click away. The read side of TUTOR-5: before it, the
 * pipeline recorded `skill_id` and nothing about the pedagogy, so "show me
 * everything taught with ESRU" was not an answerable question.
 *
 * Two things this surface refuses to do, both deliberate:
 *
 * 1. **It never renders an unreadable store as an empty one.** A BigQuery
 *    failure shows as a failed read. An empty tab and a broken query would
 *    otherwise be byte-identical on screen, and the empty one reads as a
 *    research finding ("nothing ran under ESRU") manufactured out of an outage.
 * 2. **It labels the null bucket as "not recorded", never "no framework".**
 *    Every row before 2026-09-11 is null because the field did not exist.
 *
 * Access is enforced by the backend (`assert_researcher` on every route); this
 * page renders the access-required state when that 403s.
 *
 * UI sweep 2026-11-11: the approach tabs are the shared `TeacherTabs` (arrow
 * keys, roving tabindex) and the active one lives in `?approach=`, so Back and
 * a shared link keep it; CSV and JSONL are one "Eksportér" menu; "Læs" moves
 * focus to the transcript, which renders below a table of up to 100 rows; and
 * every failed read offers Retry.
 */
/**
 * Wrapped for `useSearchParams`, which Next requires to sit under Suspense.
 * The param exists so an APPROACH can link straight to its own conversations —
 * "what does ESRU actually produce" needs the approach and its transcripts, and
 * until 2026-09-11 those were two unlinked pages a reader had to know about.
 */
export default function ResearchLogsPage() {
  return (
    <Suspense fallback={null}>
      <ResearchLogsPageInner />
    </Suspense>
  );
}

function ResearchLogsPageInner() {
  const t = useT("ResearchLogsPage");
  const mode = useLocaleMode();
  const locale = mode === "bilingual" ? "da" : mode;
  const [status, setStatus] = useState<Status>("loading");
  const [reloadTabs, setReloadTabs] = useState(0);
  const [reloadSessions, setReloadSessions] = useState(0);
  const [tabs, setTabs] = useState<ChatLogTab[]>([]);
  const [excluded, setExcluded] = useState<{ sessions: number; turns: number } | null>(null);
  const [unattributed, setUnattributed] = useState(0);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  // ?approach=<id> is the active tab (UI sweep 2026-11-11). It used to be read
  // once on arrival; now clicking a tab writes it back, so a link from an
  // approach (TutorCrossviewPanel) still lands on that approach's tab, and Back
  // or a refresh keep the one the researcher picked. An id that is not a tab
  // falls back to the first, so a stale link lands on something real.
  const tabIds = useMemo(() => tabs.map((tab) => tab.framework_id), [tabs]);
  const [activeTab, setActiveTab] = useUrlTab<string>("approach", tabIds, tabIds[0] ?? "");
  const active: string | null = activeTab || null;
  const [sessions, setSessions] = useState<ChatLogSession[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<"loading" | "ok" | "error">("loading");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ChatLogTimeline | null>(null);
  const [turnsStatus, setTurnsStatus] = useState<"loading" | "ok" | "error">("loading");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Tabs + the framework catalogue. The catalogue matters: a framework with no
  // conversations does not appear in the log rollup at all, and "ESRU has been
  // assigned to nobody yet" is itself a finding a researcher should be able to
  // see rather than infer from an absence.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    Promise.all([listChatLogTabs(), listTeachingFrameworks().catch(() => [])])
      .then(([tabsBody, frameworks]) => {
        if (cancelled) return;
        const catalogue = new Map<string, string>();
        for (const fw of frameworks) catalogue.set(fw.id, fw.label ?? fw.id);
        const present = new Set(tabsBody.tabs.map((tab) => tab.framework_id));
        const zeroes: ChatLogTab[] = [...catalogue.keys()]
          .filter((id) => !present.has(id))
          .map((id) => ({
            framework_id: id,
            sessions: 0,
            turns: 0,
            groups_seen: 0,
            student_turns: 0,
            tutor_turns: 0,
            first_ts: null,
            last_ts: null,
          }));
        const all = [...tabsBody.tabs, ...zeroes];
        setNames(catalogue);
        setTabs(all);
        const ex = tabsBody.excluded;
        if (ex) {
          const s = (ex.teacher_sessions ?? 0) + (ex.preview_sessions ?? 0);
          const n = (ex.teacher_turns ?? 0) + (ex.preview_turns ?? 0);
          setExcluded(s || n ? { sessions: s, turns: n } : null);
          setUnattributed(ex.unattributed_turns ?? 0);
        }
        setStatus("ok");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes(" 403")) setStatus("forbidden");
        else if (msg.includes(" 503")) setStatus("unreadable");
        else setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTabs]);

  const filter: ChatLogFilter = useMemo(() => ({ framework: active }), [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setSessionsStatus("loading");
    setOpenSession(null);
    listChatLogSessions({ framework: active }, 100)
      .then((rows) => {
        if (cancelled) return;
        setSessions(rows);
        setSessionsStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setSessionsStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [active, reloadSessions]);

  // "Læs" opens the transcript BELOW a table of up to 100 rows — off-screen,
  // and silent for a keyboard or screen-reader user. Move focus to its heading.
  const transcriptHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!openSession) return;
    const el = transcriptHeading.current;
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: "start" });
  }, [openSession]);

  const openTranscript = useCallback((sessionId: string) => {
    setOpenSession(sessionId);
    setTurnsStatus("loading");
    setTimeline(null);
    getChatLogTimeline(sessionId)
      .then((tl) => {
        setTimeline(tl);
        setTurnsStatus("ok");
      })
      .catch(() => setTurnsStatus("error"));
  }, []);

  const runExport = useCallback(
    async (format: "csv" | "jsonl") => {
      setExporting(true);
      setExportError(null);
      try {
        const blob = await fetchChatLogExport(filter, format);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `aipla-chat-turns-${active ?? "all"}.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setExportError(t("exportFailed"));
      } finally {
        setExporting(false);
      }
    },
    [filter, active, t],
  );

  const totals = useMemo(
    () => tabs.reduce((acc, tab) => ({ sessions: acc.sessions + tab.sessions, turns: acc.turns + tab.turns }), { sessions: 0, turns: 0 }),
    [tabs],
  );
  const openRow = openSession ? (sessions.find((s) => s.session_id === openSession) ?? null) : null;

  if (status === "loading") {
    return (
      <TeacherPage title={t("title")}>
        <InsightsTabs />
        <PageSkeleton rows={4} label={t("loading")} />
      </TeacherPage>
    );
  }

  if (status === "forbidden") {
    return (
      <TeacherPage title={t("title")}>
        <InsightsTabs />
        <EmptyState icon={ShieldAlert} title={t("forbiddenTitle")} description={t("forbiddenBody")} />
      </TeacherPage>
    );
  }

  if (status === "unreadable" || status === "error") {
    return (
      <TeacherPage title={t("title")}>
        <InsightsTabs />
        <LoadError what={t("whatArchive")} onRetry={() => setReloadTabs((n) => n + 1)} />
        {/* Why a failed read is shown as one: the tabs would otherwise look like a finding. */}
        <p className="text-xs text-muted-foreground">{t("unreadableBody")}</p>
      </TeacherPage>
    );
  }

  const sessionsTable: ReactNode =
    sessionsStatus === "loading" ? (
      <PageSkeleton rows={3} label={t("loading")} />
    ) : sessionsStatus === "error" ? (
      <LoadError what={t("whatSessions")} onRetry={() => setReloadSessions((n) => n + 1)} />
    ) : sessions.length === 0 ? (
      <EmptyState icon={MessagesSquare} title={t("emptyTabTitle")} description={t("emptyTabBody")} />
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">{t("colConversation")}</th>
              <th className="py-1 pr-3 font-medium">{t("colTutor")}</th>
              <th className="py-1 pr-3 font-medium">{t("colClass")}</th>
              <th className="py-1 pr-3 font-medium">{t("colActivity")}</th>
              <th className="py-1 pr-3 font-medium">{t("colStyle")}</th>
              <th className="py-1 pr-3 text-right font-medium">{t("colTurns")}</th>
              <th className="py-1 pr-3 font-medium">{t("colLast")}</th>
              <th className="py-1 font-medium" />
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={`${s.session_id ?? "none"}-${s.framework_id}`} className="border-t border-border align-top">
                {/* ⚠️ Optional-chained. A single row with a null session_id
                    threw here and took the ENTIRE page down with
                    "Application error" — React unmounts the tree on a render
                    throw, so one bad field cost every other row too. The
                    query layer no longer returns these, but a table cell
                    must not be able to crash a page whatever it is handed. */}
                <td className="py-1.5 pr-3 font-mono text-xs">
                  {s.session_id ? s.session_id.slice(0, 8) : t("noSession")}
                </td>
                <td className="py-1.5 pr-3">
                  {s.tutor_id ?? NONE}
                  {s.teaching_source ? (
                    <span className="ml-1 text-[11px] text-muted-foreground">
                      ({s.teaching_source === "tutor" ? t("sourceTutor") : t("sourceFields")})
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs" title={s.class_id ?? undefined}>
                  {s.class_id?.slice(0, 10) ?? NONE}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs" title={s.activity_id ?? undefined}>
                  {s.activity_id?.slice(0, 14) ?? NONE}
                </td>
                <td className="py-1.5 pr-3">{s.interaction_style ?? NONE}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  {s.readable_turns === s.turns
                    ? String(s.turns)
                    : t("turnsOf", { readable: s.readable_turns, total: s.turns })}
                </td>
                <td className="py-1.5 pr-3 text-xs text-muted-foreground" title={s.last_at ?? undefined}>
                  {s.last_at ? formatAbsoluteTime(s.last_at, locale) || s.last_at : NONE}
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    // No session id means no transcript to open.
                    disabled={!s.session_id}
                    aria-pressed={!!s.session_id && s.session_id === openSession}
                    onClick={() => s.session_id && openTranscript(s.session_id)}
                    className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("openTranscript")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <TeacherPage
      title={t("title")}
      subtitle={t("subtitleFor", { sessions: totals.sessions, turns: totals.turns })}
      actions={<ExportMenu exporting={exporting} onExport={(format) => void runExport(format)} />}
    >
      {exportError ? (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      ) : null}

      {/* Reported rather than silently filtered. Until 2026-09-11 these rows
          were IN the tabs, separable from student conversations only by having
          no content. */}
      {excluded ? (
        <p className="text-xs text-muted-foreground">
          {t("excludedNote", { sessions: excluded.sessions, turns: excluded.turns })}
        </p>
      ) : null}
      {unattributed > 0 ? (
        <p className="text-xs text-muted-foreground">{t("unattributedNote", { turns: unattributed })}</p>
      ) : null}

      {active === UNASSIGNED_FRAMEWORK ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {t("unassignedNote")}
        </p>
      ) : null}

      <TeacherTabs
        ariaLabel={t("title")}
        active={active ?? ""}
        onChange={(id) => setActiveTab(id)}
        tabs={tabs.map((tab) => ({
          id: tab.framework_id,
          label: tabLabel(tab.framework_id, names, t),
          count: tab.sessions,
          // One table, shown under whichever tab is active; the others hold nothing.
          content: tab.framework_id === active ? <TeacherCard>{sessionsTable}</TeacherCard> : null,
        }))}
      />

      {openSession ? (
        <TeacherCard>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 ref={transcriptHeading} tabIndex={-1} className="text-sm font-semibold outline-none">
              {t("transcriptFor", { id: openSession.slice(0, 8) })}
            </h2>
            <button
              type="button"
              onClick={() => setOpenSession(null)}
              className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
            >
              {t("close")}
            </button>
          </div>
          {/* 1.1.136 M2 — what the group ended with on this session's activity,
              above the timeline. Needs both a group and an activity on the row.
              No classId: this page is researcher-only, and the researcher branch
              reads every group on the activity — a class id stamped on an old
              log row (a since-deleted class) would otherwise 404 the read. */}
          {openRow?.group_id && openRow.activity_id ? (
            <div className="mb-4">
              <FinalWorkPanel activityId={openRow.activity_id} groupCode={openRow.group_id} />
            </div>
          ) : null}
          <ChatLogTranscript
            items={timeline?.items ?? null}
            status={turnsStatus}
            workStatus={timeline?.workStatus}
          />
        </TeacherCard>
      ) : null}
    </TeacherPage>
  );
}

/** CSV and JSONL behind one "Eksportér" menu (UI sweep 2026-11-11). Both
 *  export the ACTIVE tab, as the two buttons did. */
function ExportMenu({ exporting, onExport }: { exporting: boolean; onExport: (format: "csv" | "jsonl") => void }) {
  const t = useT("ResearchLogsPage");
  const item =
    "flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-50";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={exporting}
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        {exporting ? t("exporting") : t("export")}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[14rem] rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Item className={item} onSelect={() => onExport("csv")}>
            <span className="font-medium">{t("exportCsv")}</span>
            <span className="text-xs text-muted-foreground">{t("exportCsvHint")}</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => onExport("jsonl")}>
            <span className="font-medium">{t("exportJsonl")}</span>
            <span className="text-xs text-muted-foreground">{t("exportJsonlHint")}</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
