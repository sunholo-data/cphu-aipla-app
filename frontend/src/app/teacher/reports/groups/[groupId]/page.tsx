"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import { ArrowLeft, Download } from "lucide-react";

import {
  NotFoundError,
  type ChatLogTimeline,
  type SessionSummaryPayload,
  fetchGroupLatestReport,
  getGroupReportTimeline,
} from "@/lib/teacherApi";
import { downloadCsv, downloadJson } from "@/lib/download";
import { ChatLogTranscript, timelineFromSummary } from "@/components/teacher/research/ChatLogTranscript";
import {
  type ExportTimeline,
  resolveExportTimeline,
  timelineToCsvRows,
} from "@/components/teacher/research/timelineExport";
import { GroupTranscriptSection } from "@/components/teacher/GroupTranscriptSection";
import { TeachingApproachSection } from "@/components/teacher/TeachingApproachSection";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { useT, type Translate } from "@/i18n";

const TRANSCRIPT_OPEN_KEY = "aipla.report.transcriptOpen";

/** UI copy for the 1.1.136 timeline additions (1.1.108 M4: copy object, not JSX). */
// Copy lives in messages/{da,en}/teacher-research.json (TeacherGroupReportPage) — 1.1.108.
type T = Translate<"TeacherGroupReportPage">;

// Mirrors backend analytics/live_class.py LIVE_WINDOW_S: a latest session quiet
// longer than this is historical, not "live" — the report shows "last active …"
// instead of the live badge.
const LIVE_WINDOW_S = 5400;

/** "…/2026-06-29T12:00:00Z" → "3 min ago" for the AI-summary freshness line. */
function relAgo(iso: string | null | undefined, t: T): string {
  if (!iso) return "";
  // An unparseable timestamp used to fall through every branch as NaN and
  // render "last active NaNh ago" — say nothing rather than nonsense.
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const secs = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (secs < 60) return t("justNow");
  const mins = Math.round(secs / 60);
  return mins < 60 ? t("minAgo", { n: mins }) : t("hoursAgo", { n: Math.round(mins / 60) });
}

/** The shape the report UI renders — derived from the live session summary.
 *  No mock fallback: a teacher only ever sees real session data, an honest
 *  "no sessions yet" empty state, or a load error. */
type ReportTurn = { timestamp: string; role: "student" | "tutor"; content: string };
type ReportDisplay = {
  groupCode: string;
  activityName: string;
  classId: string | null;
  className: string | null;
  startedAtLabel: string;
  durationMinutes: number;
  messageCount: number;
  simRunCount: number;
  conversation: ReportTurn[];
};

type ReportState =
  | { kind: "loading" }
  | { kind: "live"; data: SessionSummaryPayload }
  | { kind: "empty" }
  | { kind: "error" };

/** "946" -> "15h 46m"; under an hour stays "Nm". The report's time is the span
 *  from the group's first to last activity (across sessions), so a raw "946 min"
 *  reads badly — 1.1.36 feedback. */
function formatGroupTime(minutes: number, t: T): string {
  if (minutes < 60) return t("duration_m", { m: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? t("duration_h", { h }) : t("duration_hm", { h, m });
}

function toDisplay(state: ReportState): ReportDisplay | null {
  if (state.kind !== "live") return null;
  const d = state.data;
  return {
    groupCode: d.groupCode ?? "",
    activityName: d.activityName || d.activityId,
    classId: d.classId ?? null,
    className: d.className ?? null,
    startedAtLabel: d.startedAt.slice(0, 16).replace("T", " "),
    durationMinutes: Math.round(d.durationSeconds / 60),
    messageCount: d.messageCount,
    simRunCount: d.simRunCount,
    conversation: d.conversation.map((t) => ({
      timestamp: t.timestamp.slice(11, 16),
      role: t.role,
      content: t.content,
    })),
  };
}

export default function TeacherGroupReportPage() {
  const t = useT("TeacherGroupReportPage");
  // The work cards' labels (and their fallback for unlabelled rows), for exports.
  const tCards = useT("ChatLogTranscript");
  const params = useParams();
  const searchParams = useSearchParams();
  const groupId =
    typeof params?.groupId === "string" ? params.groupId : "";
  const sessionId = searchParams?.get("session_id") ?? null;

  const [state, setState] = useState<ReportState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  // 1.1.4 — transcript collapses by default (summary-first). The choice
  // persists per teacher so a researcher reviewing many sessions can leave
  // it open.
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage?.getItem(TRANSCRIPT_OPEN_KEY) === "1") {
        setTranscriptOpen(true);
      }
    } catch {
      /* localStorage unavailable (private mode / test env) — default collapsed */
    }
  }, []);
  const toggleTranscript = () => {
    setTranscriptOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage?.setItem(TRANSCRIPT_OPEN_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal */
      }
      return next;
    });
  };

  // Load the report. ``refresh`` forces the AI summary to regenerate
  // (?refresh=1); a plain load just streams the raw data (transcript /
  // workbench / signals) with no LLM call. Once we have live data, a failed
  // poll keeps the last good data rather than flipping to empty/error.
  const load = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (opts?.refresh) setRefreshing(true);
      try {
        const data = await fetchGroupLatestReport(groupId, sessionId, opts);
        setState({ kind: "live", data });
      } catch (err) {
        if (err instanceof NotFoundError) {
          setState((prev) => (prev.kind === "live" ? prev : { kind: "empty" }));
          return;
        }
        console.warn("[teacher-ui] group report load failed:", err);
        setState((prev) => (prev.kind === "live" ? prev : { kind: "error" }));
      } finally {
        if (opts?.refresh) setRefreshing(false);
      }
    },
    [groupId, sessionId],
  );

  // Initial load + live poll of the raw layer. Viewing a specific past session
  // (?session_id=) is historical, so it doesn't poll. The poll never forces the
  // LLM — the AI summary regenerates on its own debounce, or via Refresh.
  useEffect(() => {
    void load();
    if (sessionId) return; // historical session — no live polling
    const id = window.setInterval(() => void load(), 12_000);
    return () => window.clearInterval(id);
  }, [load, sessionId]);

  // 1.1.136 M1 — the transcript with the group's work between the turns,
  // labelled as the student saw it. Fetched only while the transcript is open,
  // and again when the live poll brings new messages or work. If the labelled
  // timeline cannot be read (a session with no BigQuery rows yet), the report's
  // own payload is interleaved instead, with derived labels.
  const live = state.kind === "live" ? state.data : null;
  const liveSession = live?.sessionId ?? null;
  const liveGroup = live?.groupCode || groupId;
  const liveMessages = live?.messageCount ?? 0;
  const liveWork = live?.simRunCount ?? 0;
  const [timeline, setTimeline] = useState<ChatLogTimeline | null>(null);
  useEffect(() => {
    if (!transcriptOpen || !liveSession) return;
    let cancelled = false;
    getGroupReportTimeline(liveGroup, liveSession)
      .then((tl) => {
        if (!cancelled) setTimeline(tl);
      })
      .catch(() => {
        if (!cancelled) setTimeline(null);
      });
    return () => {
      cancelled = true;
    };
  }, [transcriptOpen, liveGroup, liveSession, liveMessages, liveWork]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("emptyTitle")}</p>
        <p>{t.rich("emptyGroup", { group: groupId, code: (chunks) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{chunks}</code> })}</p>
        <p>{t("emptyHint")}</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("errorTitle")}</p>
        <p>{t.rich("errorBody", { group: groupId, code: (chunks) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{chunks}</code> })}</p>
      </div>
    );
  }

  // Only the "live" state reaches here (loading / empty / error returned
  // above), so the report is always real session data.
  const report = toDisplay(state)!;
  const narrative = state.kind === "live" ? (state.data.narrative ?? null) : null;
  // 1.1.36 A3/A5 — "what's included": the sources the narrative was built from.
  const inputs = state.kind === "live" ? (state.data.inputs ?? null) : null;
  // Recency for the live badge: the last chat turn's timestamp. Viewing the
  // latest session (no ?session_id) AND active within the live window → "live";
  // otherwise it's historical → "last active N ago".
  // From the RAW data: `report.conversation` timestamps are trimmed to "HH:MM"
  // for display, which parses as NaN — so every report read "last active NaNh
  // ago" and the live badge could never show.
  const lastActivityIso = state.kind === "live" ? (state.data.conversation.at(-1)?.timestamp ?? null) : null;
  const liveActive =
    !sessionId &&
    lastActivityIso !== null &&
    (Date.now() - new Date(lastActivityIso).getTime()) / 1000 < LIVE_WINDOW_S;

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link
          href="/teacher/classes"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("dashboard")}
        </Link>
        {report.classId ? (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/teacher/classes/${report.classId}`} className="hover:text-foreground hover:underline">
              {report.className || t("classFallback")}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {groupId}
        </code>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">{t("sessionHistory")}</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
          {sessionId ? t("session") : t("latestSession")}
          {liveActive ? (
            <span className="flex items-center gap-1 text-xs font-normal text-green-600">
              <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" aria-hidden /> {t("live")}
            </span>
          ) : (
            !sessionId &&
            relAgo(lastActivityIso, t) && (
              <span className="text-xs font-normal text-muted-foreground">
                {t("lastActive", { ago: relAgo(lastActivityIso, t) })}
              </span>
            )
          )}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t.rich("activityLine", {
            activity: report.activityName,
            started: report.startedAtLabel,
            b: (chunks) => <strong>{chunks}</strong>,
          })}
        </p>
      </header>

      <section
        aria-labelledby="narrative-label"
        className="flex flex-col gap-2 rounded border border-border bg-background p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="narrative-label" className="text-base font-semibold">
            {t("summary")}
          </h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {narrative && inputs?.generatedAt && <span>{t("updated", { ago: relAgo(inputs.generatedAt, t) })}</span>}
            <button
              type="button"
              onClick={() => void load({ refresh: true })}
              disabled={refreshing}
              className="flex items-center gap-1 rounded border px-2 py-1 hover:bg-muted disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              {refreshing ? t("refreshing") : t("refresh")}
            </button>
          </div>
        </div>
        {narrative ? (
          <div className="text-sm">
            {/* Summaries carry no doc-block links, so navigation is a no-op. */}
            <ChatMarkdown content={narrative} navigateToBlock={() => {}} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {report.conversation.length === 0 && !(inputs && inputs.audioMinutes > 0)
              ? t("noConversation")
              : t("generating", {
                  turns: report.messageCount,
                  audio: inputs && inputs.audioMinutes > 0 ? String(inputs.audioMinutes) : "none",
                })}
          </p>
        )}
        {/* 1.1.36 A5 — "what's included": names the sources so the wait is transparent. */}
        {inputs ? (
          <p className="text-xs text-muted-foreground">
            {t("basedOn", { turns: inputs.chatTurns })}
            {inputs.audioMinutes > 0
              ? t("basedOnAudio", { minutes: inputs.audioMinutes, clips: inputs.audioSegments })
              : ""}
            {inputs.simEvents > 0 ? t("basedOnSim", { n: inputs.simEvents }) : ""}
            {` · ${inputs.model}`}
            {inputs.generatedAt ? t("generatedAt", { time: inputs.generatedAt.slice(11, 16) }) : ""}
          </p>
        ) : null}
      </section>

      {/* 1.1.107 M5 — how the session's ONE teaching approach was used. */}
      <TeachingApproachSection fidelity={state.kind === "live" ? state.data.fidelity : null} />

      <section
        aria-labelledby="summary-label"
        className="flex flex-col gap-2 rounded border border-border bg-background p-4"
      >
        <h2 id="summary-label" className="text-base font-semibold">
          {t("atAGlance")}
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">{t("groupTime")}</dt>
            <dd
              className="font-medium"
              title={t("groupTimeTitle")}
            >
              {formatGroupTime(report.durationMinutes, t)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">{t("messages")}</dt>
            <dd className="font-medium">{report.messageCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">{t("simRuns")}</dt>
            <dd className="font-medium">{report.simRunCount}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="highlights-label" className="flex flex-col gap-2">
        <h2 id="highlights-label" className="text-base font-semibold">
          {t("whatTheyDid")}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {[
            t("highlightMessages", { n: report.messageCount }),
            t("highlightWork", { n: report.simRunCount }),
          ].map((h) => (
            <li key={h} className="flex items-start gap-2">
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/70"
              />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 1.1.36 feedback — group the chat + recording transcripts as one
          "Source material" (provenance) block so they read together. */}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{t("sourceMaterial")}</h2>
        <p className="text-xs text-muted-foreground">{t("sourceMaterialHint")}</p>
      </div>

      <section aria-labelledby="log-label" className="flex flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggleTranscript}
            aria-expanded={transcriptOpen}
            className="group flex items-center gap-1.5 text-base font-semibold hover:text-foreground/80"
          >
            <ChevronRight
              className={`h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground ${
                transcriptOpen ? "rotate-90" : ""
              }`}
              aria-hidden="true"
            />
            <span id="log-label">
              {transcriptOpen ? t("hideTranscript") : t("viewTranscript")}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              ({t("messageCount", { n: report.conversation.length })}
              {live && (live.workbenchEvents?.length ?? 0) > 0
                ? t("workCount", { n: live.workbenchEvents?.length ?? 0 })
                : ""}
              )
            </span>
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleDownloadCsv(state, groupId, tCards)}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadJson(state, groupId)}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              JSON
            </button>
          </div>
        </header>
        {transcriptOpen && live ? (
          // 1.1.136 M1 — one timeline: the turns AND the work, in the order they
          // happened. Replaces the raw `server · field · value` list that used
          // to sit below the recording transcript, values cut at 80 chars.
          <div className="rounded border border-border bg-background p-3">
            <ChatLogTranscript
              items={timeline?.items ?? timelineFromSummary(live.conversation, live.workbenchEvents ?? [])}
              status="ok"
              workStatus={timeline?.workStatus}
            />
          </div>
        ) : null}
      </section>

      {/* The group's lesson-recording transcript, directly beside the chat above so
          the two sources read as one provenance block (1.1.36 feedback). Renders only
          when a recorded session produced a transcript. */}
      <GroupTranscriptSection groupId={groupId} />
    </div>
  );
}

/** Stem used for downloaded report filenames. */
function reportFilenameStem(state: ReportState, groupId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (state.kind === "live") {
    const shortSession = state.data.sessionId.slice(0, 8);
    return `report-${state.data.groupCode ?? groupId}-${shortSession}-${today}`;
  }
  return `report-${groupId}-${today}`;
}

/** 1.1.136 §Exports — the timeline to export: the labelled server timeline, read
 *  fresh (same `fetchWithAuth` client the transcript uses; the route admits the
 *  class owner or a researcher), else the report's own payload interleaved. The
 *  RAW `state.data.conversation` timestamps, never the HH:MM display copy. */
async function exportTimeline(state: ReportState, groupId: string): Promise<ExportTimeline | null> {
  if (state.kind !== "live") return null;
  const d = state.data;
  return resolveExportTimeline(
    () => getGroupReportTimeline(d.groupCode || groupId, d.sessionId),
    () => timelineFromSummary(d.conversation, d.workbenchEvents ?? []),
  );
}

/** CSV: the turns AND the work, one row each, in time order. Columns
 *  `timestamp, role, content` are the chat-only file's, unchanged in name and
 *  position; `kind` (turn | work) and `label` are appended. Work rows carry the
 *  card's label and a readable summary of the state, not the raw snapshot. */
async function handleDownloadCsv(
  state: ReportState,
  groupId: string,
  tCards: Translate<"ChatLogTranscript">,
): Promise<void> {
  const tl = await exportTimeline(state, groupId);
  downloadCsv(`${reportFilenameStem(state, groupId)}.csv`, timelineToCsvRows(tl?.items ?? [], tCards));
}

/** JSON: the full SessionSummary payload (metadata, conversation, raw
 *  workbench events) plus `timeline` — the API's timeline items as-is, raw
 *  values included — with where it came from and whether work was readable. */
async function handleDownloadJson(state: ReportState, groupId: string): Promise<void> {
  const tl = await exportTimeline(state, groupId);
  const data =
    state.kind === "live" && tl
      ? { ...state.data, timeline: tl.items, timelineSource: tl.source, timelineWorkStatus: tl.workStatus }
      : {};
  downloadJson(`${reportFilenameStem(state, groupId)}.json`, data);
}

