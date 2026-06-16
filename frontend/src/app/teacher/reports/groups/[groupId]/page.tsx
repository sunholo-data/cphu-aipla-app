"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Sliders } from "lucide-react";

import {
  NotFoundError,
  type SessionSummaryPayload,
  type WorkbenchEventPayload,
  fetchGroupLatestReport,
} from "@/lib/teacherApi";
import { downloadCsv, downloadJson } from "@/lib/download";
import { GroupTranscriptSection } from "@/components/teacher/GroupTranscriptSection";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

const TRANSCRIPT_OPEN_KEY = "aipla.report.transcriptOpen";

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
  highlights: string[];
  conversation: ReportTurn[];
};

type ReportState =
  | { kind: "loading" }
  | { kind: "live"; data: SessionSummaryPayload }
  | { kind: "empty" }
  | { kind: "error" };

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
    highlights: [
      `${d.messageCount} messages exchanged`,
      `${d.simRunCount} workbench interactions`,
    ],
    conversation: d.conversation.map((t) => ({
      timestamp: t.timestamp.slice(11, 16),
      role: t.role,
      content: t.content,
    })),
  };
}

export default function TeacherGroupReportPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const groupId =
    typeof params?.groupId === "string" ? params.groupId : "";
  const sessionId = searchParams?.get("session_id") ?? null;

  const [state, setState] = useState<ReportState>({ kind: "loading" });

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

  useEffect(() => {
    let alive = true;
    fetchGroupLatestReport(groupId, sessionId)
      .then((data) => {
        if (alive) {
          setState({ kind: "live", data });
        }
      })
      .catch((err) => {
        if (!alive) return;
        // No mock fallback — a teacher must never see fabricated session
        // data. 404 = no session yet (honest empty state); anything else is
        // a real load failure.
        if (err instanceof NotFoundError) {
          setState({ kind: "empty" });
          return;
        }
        console.warn("[teacher-ui] group report load failed:", err);
        setState({ kind: "error" });
      });
    return () => {
      alive = false;
    };
  }, [groupId, sessionId]);

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        Loading report…
      </div>
    );
  }

  if (state.kind === "empty") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No sessions yet</p>
        <p>
          Group <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{groupId}</code> has not completed a session.
        </p>
        <p>Students need to join and chat before a report appears here.</p>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Couldn&apos;t load this report</p>
        <p>
          Something went wrong fetching the session for group{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{groupId}</code>. Refresh to try again.
        </p>
      </div>
    );
  }

  // Only the "live" state reaches here (loading / empty / error returned
  // above), so the report is always real session data.
  const report = toDisplay(state)!;
  const narrative = state.kind === "live" ? (state.data.narrative ?? null) : null;

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        <Link
          href="/teacher/classes"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
        {report.classId ? (
          <>
            <span aria-hidden="true">/</span>
            <Link href={`/teacher/classes/${report.classId}`} className="hover:text-foreground hover:underline">
              {report.className || "Class"}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {groupId}
        </code>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Session history</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold sm:text-2xl">
          {sessionId ? "Session" : "Latest session"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Activity: <strong>{report.activityName}</strong> · Session:{" "}
          {report.startedAtLabel}
        </p>
      </header>

      <section
        aria-labelledby="narrative-label"
        className="flex flex-col gap-2 rounded border border-border bg-background p-4"
      >
        <h2 id="narrative-label" className="text-base font-semibold">
          Summary
        </h2>
        {narrative ? (
          <div className="text-sm">
            {/* Summaries carry no doc-block links, so navigation is a no-op. */}
            <ChatMarkdown content={narrative} navigateToBlock={() => {}} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {report.conversation.length === 0
              ? "No conversation yet — a summary appears once the group has chatted."
              : "Generating a summary… reopen the report in a moment."}
          </p>
        )}
      </section>

      <section
        aria-labelledby="summary-label"
        className="flex flex-col gap-2 rounded border border-border bg-background p-4"
      >
        <h2 id="summary-label" className="text-base font-semibold">
          At a glance
        </h2>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Duration</dt>
            <dd className="font-medium">{report.durationMinutes} min</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Messages</dt>
            <dd className="font-medium">{report.messageCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-muted-foreground">Sim runs</dt>
            <dd className="font-medium">{report.simRunCount}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="highlights-label" className="flex flex-col gap-2">
        <h2 id="highlights-label" className="text-base font-semibold">
          What the group did
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {report.highlights.map((h) => (
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

      <section aria-labelledby="log-label" className="flex flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={toggleTranscript}
            aria-expanded={transcriptOpen}
            className="flex items-center gap-1.5 text-base font-semibold hover:text-foreground/80"
          >
            <span id="log-label">
              {transcriptOpen ? "Hide full transcript" : "View full transcript"}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              ({report.conversation.length} message
              {report.conversation.length === 1 ? "" : "s"})
            </span>
          </button>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleDownloadCsv(state, groupId)}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleDownloadJson(state, groupId)}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              JSON
            </button>
          </div>
        </header>
        {transcriptOpen ? (
          <ol className="flex flex-col gap-2 rounded border border-border bg-background p-3 text-sm">
            {report.conversation.length === 0 ? (
              <li className="text-muted-foreground">
                No messages exchanged in this session yet.
              </li>
            ) : null}
            {report.conversation.map((turn, i) => (
              <li key={`${turn.timestamp}-${i}`} className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  [{turn.timestamp}] {turn.role === "student" ? "Student" : "Tutor"}
                </span>
                <span>{turn.content}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {state.kind === "live" && state.data.workbenchEvents && state.data.workbenchEvents.length > 0 ? (
        <WorkbenchActivitySection events={state.data.workbenchEvents} />
      ) : null}

      {/* REC-TRANSCRIPT M4 — the group's lesson-recording transcript (renders
          only when a recorded session produced one). */}
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

/** CSV: flat conversation log (timestamp, role, content). The teacher
 *  audience asked for spreadsheet-friendly transcripts; workbench
 *  interactions live in the JSON export instead. */
function handleDownloadCsv(state: ReportState, groupId: string): void {
  const conversation = state.kind === "live" ? state.data.conversation : [];
  const rows: ReadonlyArray<ReadonlyArray<unknown>> = [
    ["timestamp", "role", "content"],
    ...conversation.map((t) => [t.timestamp, t.role, t.content]),
  ];
  downloadCsv(`${reportFilenameStem(state, groupId)}.csv`, rows);
}

/** JSON: the full SessionSummary payload including metadata, conversation,
 *  and workbench events. */
function handleDownloadJson(state: ReportState, groupId: string): void {
  const data = state.kind === "live" ? state.data : {};
  downloadJson(`${reportFilenameStem(state, groupId)}.json`, data);
}

function WorkbenchActivitySection({ events }: { events: WorkbenchEventPayload[] }) {
  return (
    <section aria-labelledby="workbench-label" className="flex flex-col gap-2">
      <h2 id="workbench-label" className="flex items-center gap-2 text-base font-semibold">
        <Sliders className="h-4 w-4" aria-hidden="true" />
        Workbench activity
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
          {events.length}
        </span>
      </h2>
      <ol className="flex flex-col gap-1 rounded border border-border bg-background p-3 text-sm">
        {events.map((evt, i) => (
          <li
            key={`${evt.timestamp}-${i}`}
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              [{evt.timestamp.slice(11, 16)}]
            </span>
            <span className="font-medium">{evt.server}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{evt.field || evt.tool}</span>
            {evt.value ? (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {evt.value.length > 80 ? `${evt.value.slice(0, 80)}…` : evt.value}
              </code>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
