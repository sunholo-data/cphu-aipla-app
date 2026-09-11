"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, MessagesSquare, ShieldAlert, TriangleAlert } from "lucide-react";

import {
  type ChatLogFilter,
  type ChatLogSession,
  type ChatLogTab,
  type ChatLogTurn,
  UNASSIGNED_FRAMEWORK,
  fetchChatLogExport,
  getChatLogTranscript,
  listChatLogSessions,
  listChatLogTabs,
  listTeachingFrameworks,
} from "@/lib/teacherApi";
import { EmptyState } from "@/components/teacher/ui/EmptyState";
import { TeacherCard } from "@/components/teacher/ui/TeacherCard";
import { TeacherPage } from "@/components/teacher/ui/TeacherPage";
import { ChatLogTranscript } from "@/components/teacher/research/ChatLogTranscript";

/** UI copy, lifted out of JSX (1.1.108 M4) so a translator can reach it. */
const copy = {
  title: "Conversations by teaching approach",
  subtitleFor: (sessions: number, turns: number) =>
    `${sessions} conversations · ${turns} turns recorded`,
  loading: "Loading conversations…",
  forbiddenTitle: "Researcher access required",
  forbiddenBody:
    "These are student conversations across every class and every teacher. Ask a platform admin for the researcher role.",
  unreadableTitle: "Could not read the conversation store",
  unreadableBody:
    "This is a failed read, not an empty result — the tabs below would otherwise look like a finding. Try again, or check that the chat-log dataset is reachable.",
  unassignedTab: "Not recorded",
  unassignedNote:
    "These conversations ran before the tutor was recorded on each turn (2026-09-11), or under a tutor with no teaching approach set. NULL here means “not recorded”, never “no framework” — the values are deliberately not backfilled, because a class's tutor changes and guessing would file old conversations under approaches they never ran under.",
  emptyTabTitle: "No conversations under this approach yet",
  emptyTabBody:
    "Assign this approach to a tutor, then run a lesson. Turns are stamped at the time they happen, so this fills from the next conversation onward.",
  exportCsv: "Export CSV",
  exportJsonl: "Export JSONL",
  exporting: "Preparing…",
  exportFailed: "Export failed. Try again.",
  colConversation: "Conversation",
  colTutor: "Tutor",
  colClass: "Class",
  colActivity: "Activity",
  colStyle: "Style",
  colTurns: "Turns",
  colLast: "Last activity",
  turnsFor: (readable: number, total: number) =>
    readable === total ? `${total}` : `${readable} of ${total}`,
  sourceTutor: "set by tutor",
  sourceFields: "set by class/activity",
  none: "—",
  transcriptFor: (id: string) => `Transcript · ${id.slice(0, 8)}`,
  close: "Close",
  openTranscript: "Read",
} as const;

type Status = "loading" | "ok" | "forbidden" | "unreadable" | "error";

/** A tab's label: the framework's human name where we know it, else its id. */
function tabLabel(id: string, names: Map<string, string>): string {
  if (id === UNASSIGNED_FRAMEWORK) return copy.unassignedTab;
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
export default function ResearchLogsPage() {
  const [status, setStatus] = useState<Status>("loading");
  const [tabs, setTabs] = useState<ChatLogTab[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [active, setActive] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatLogSession[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState<"loading" | "ok" | "error">("loading");
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatLogTurn[] | null>(null);
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
        const present = new Set(tabsBody.tabs.map((t) => t.framework_id));
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
        setActive((cur) => cur ?? all[0]?.framework_id ?? null);
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
    setTurns(null);
    getChatLogTranscript(sessionId)
      .then((rows) => {
        setTurns(rows);
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
        setExportError(copy.exportFailed);
      } finally {
        setExporting(false);
      }
    },
    [filter, active],
  );

  const totals = useMemo(
    () => tabs.reduce((acc, t) => ({ sessions: acc.sessions + t.sessions, turns: acc.turns + t.turns }), { sessions: 0, turns: 0 }),
    [tabs],
  );

  if (status === "loading") {
    return (
      <TeacherPage title={copy.title}>
        <p className="text-sm text-muted-foreground">{copy.loading}</p>
      </TeacherPage>
    );
  }

  if (status === "forbidden") {
    return (
      <TeacherPage title={copy.title}>
        <EmptyState icon={ShieldAlert} title={copy.forbiddenTitle} description={copy.forbiddenBody} />
      </TeacherPage>
    );
  }

  if (status === "unreadable" || status === "error") {
    return (
      <TeacherPage title={copy.title}>
        <EmptyState icon={TriangleAlert} title={copy.unreadableTitle} description={copy.unreadableBody} />
      </TeacherPage>
    );
  }

  return (
    <TeacherPage
      title={copy.title}
      subtitle={copy.subtitleFor(totals.sessions, totals.turns)}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={exporting}
            onClick={() => void runExport("csv")}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exporting ? copy.exporting : copy.exportCsv}
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={() => void runExport("jsonl")}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exporting ? copy.exporting : copy.exportJsonl}
          </button>
        </div>
      }
    >
      {exportError ? <p className="text-sm text-destructive">{exportError}</p> : null}

      <div role="tablist" aria-label={copy.title} className="flex flex-wrap gap-1 border-b border-border">
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
              {tabLabel(tab.framework_id, names)}
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums">{tab.sessions}</span>
            </button>
          );
        })}
      </div>

      {active === UNASSIGNED_FRAMEWORK ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {copy.unassignedNote}
        </p>
      ) : null}

      <TeacherCard>
        {sessionsStatus === "loading" ? (
          <p className="text-sm text-muted-foreground">{copy.loading}</p>
        ) : sessionsStatus === "error" ? (
          <EmptyState icon={TriangleAlert} title={copy.unreadableTitle} description={copy.unreadableBody} />
        ) : sessions.length === 0 ? (
          <EmptyState icon={MessagesSquare} title={copy.emptyTabTitle} description={copy.emptyTabBody} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">{copy.colConversation}</th>
                  <th className="py-1 pr-3 font-medium">{copy.colTutor}</th>
                  <th className="py-1 pr-3 font-medium">{copy.colClass}</th>
                  <th className="py-1 pr-3 font-medium">{copy.colActivity}</th>
                  <th className="py-1 pr-3 font-medium">{copy.colStyle}</th>
                  <th className="py-1 pr-3 text-right font-medium">{copy.colTurns}</th>
                  <th className="py-1 pr-3 font-medium">{copy.colLast}</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={`${s.session_id}-${s.framework_id}`} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 font-mono text-xs">{s.session_id.slice(0, 8)}</td>
                    <td className="py-1.5 pr-3">
                      {s.tutor_id ?? copy.none}
                      {s.teaching_source ? (
                        <span className="ml-1 text-[11px] text-muted-foreground">
                          ({s.teaching_source === "tutor" ? copy.sourceTutor : copy.sourceFields})
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{s.class_id?.slice(0, 10) ?? copy.none}</td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{s.activity_id?.slice(0, 14) ?? copy.none}</td>
                    <td className="py-1.5 pr-3">{s.interaction_style ?? copy.none}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {copy.turnsFor(s.readable_turns, s.turns)}
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">
                      {s.last_at ? s.last_at.slice(0, 16).replace("T", " ") : copy.none}
                    </td>
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => openTranscript(s.session_id)}
                        className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
                      >
                        {copy.openTranscript}
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
            <h2 className="text-sm font-semibold">{copy.transcriptFor(openSession)}</h2>
            <button
              type="button"
              onClick={() => setOpenSession(null)}
              className="rounded border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
            >
              {copy.close}
            </button>
          </div>
          <ChatLogTranscript turns={turns} status={turnsStatus} />
        </TeacherCard>
      ) : null}
    </TeacherPage>
  );
}
