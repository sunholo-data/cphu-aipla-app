"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, MessagesSquare, ShieldAlert, TriangleAlert } from "lucide-react";

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
import { ChatLogTranscript } from "@/components/teacher/research/ChatLogTranscript";
import { useT, type Translate } from "@/i18n";

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
  const [status, setStatus] = useState<Status>("loading");
  const [tabs, setTabs] = useState<ChatLogTab[]>([]);
  const [excluded, setExcluded] = useState<{ sessions: number; turns: number } | null>(null);
  const [unattributed, setUnattributed] = useState(0);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  // ?approach=<id> opens straight on that tab. Read once as the initial value
  // rather than held in sync: a researcher who then clicks another tab should
  // stay there, not be yanked back by the URL they arrived on.
  // ⚠️ Optional-chained: `useSearchParams()` is null outside a router context —
  // during prerender, and in any test that renders the page directly. An
  // unguarded `.get()` crashes the whole page for a convenience feature.
  const initialApproach = useSearchParams()?.get("approach") ?? null;
  const [active, setActive] = useState<string | null>(initialApproach);
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
        // Honour ?approach= only if that tab actually exists, so a stale link
        // lands on something real instead of an empty page.
        setActive((cur) => {
          if (cur && all.some((tab) => tab.framework_id === cur)) return cur;
          return all[0]?.framework_id ?? null;
        });
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
  }, []);

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
  }, [active]);

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

  if (status === "loading") {
    return (
      <TeacherPage title={t("title")}>
        <InsightsTabs />
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
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
        <EmptyState icon={TriangleAlert} title={t("unreadableTitle")} description={t("unreadableBody")} />
      </TeacherPage>
    );
  }

  return (
    <TeacherPage
      title={t("title")}
      subtitle={t("subtitleFor", { sessions: totals.sessions, turns: totals.turns })}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void runExport("csv")}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exporting ? t("exporting") : t("exportCsv")}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void runExport("jsonl")}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exporting ? t("exporting") : t("exportJsonl")}
          </button>
        </div>
      }
    >
      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}

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

      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => {
          const selected = tab.framework_id === active;
          return (
            <button
              key={tab.framework_id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => setActive(tab.framework_id)}
              className={
                selected
                  ? "-mb-px rounded-t border border-b-background border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground"
                  : "-mb-px rounded-t border border-transparent px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              {tabLabel(tab.framework_id, names, t)}
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">{tab.sessions}</span>
            </button>
          );
        })}
      </div>

      {active === UNASSIGNED_FRAMEWORK ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {t("unassignedNote")}
        </p>
      ) : null}

      <TeacherCard>
        {sessionsStatus === "loading" ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : sessionsStatus === "error" ? (
          <EmptyState icon={TriangleAlert} title={t("unreadableTitle")} description={t("unreadableBody")} />
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
                    <td className="py-1.5 pr-3 font-mono text-xs">{s.class_id?.slice(0, 10) ?? NONE}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{s.activity_id?.slice(0, 14) ?? NONE}</td>
                    <td className="py-1.5 pr-3">{s.interaction_style ?? NONE}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {(s.readable_turns === s.turns ? String(s.turns) : t("turnsOf", { readable: s.readable_turns, total: s.turns }))}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                      {s.last_at ? s.last_at.slice(0, 16).replace("T", " ") : NONE}
                    </td>
                    <td className="py-1.5">
                      <button
                        type="button"
                        // No session id means no transcript to open.
                        disabled={!s.session_id}
                        onClick={() => s.session_id && openTranscript(s.session_id)}
                        className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
                      >
                        {t("openTranscript")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TeacherCard>

      {openSession ? (
        <TeacherCard>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">{t("transcriptFor", { id: openSession.slice(0, 8) })}</h2>
            <button
              type="button"
              onClick={() => setOpenSession(null)}
              className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
            >
              {t("close")}
            </button>
          </div>
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
