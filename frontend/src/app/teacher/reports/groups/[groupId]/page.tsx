"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Download,
  Send,
} from "lucide-react";

import {
  type MockSessionReport,
  getMockClass,
  getMockSessionReport,
} from "../../../_mock-data";
import {
  NotFoundError,
  type SessionSummaryPayload,
  fetchGroupLatestReport,
} from "@/lib/teacherApi";

type ReportState =
  | { kind: "loading" }
  | { kind: "live"; data: SessionSummaryPayload }
  | { kind: "mock"; data: MockSessionReport }
  | { kind: "empty" };

function toDisplay(state: ReportState): MockSessionReport | null {
  if (state.kind === "live") {
    const d = state.data;
    return {
      classId: "",
      groupCode: d.groupCode ?? "",
      activityName: d.activityId,
      startedAtLabel: d.startedAt.slice(0, 16).replace("T", " "),
      durationMinutes: Math.round(d.durationSeconds / 60),
      messageCount: d.messageCount,
      simRunCount: d.simRunCount,
      highlights: [
        `${d.messageCount} messages exchanged`,
        `${d.simRunCount} workbench interactions`,
      ],
      checklistComplete: [],
      checklistIncomplete: [],
      conversation: d.conversation.map((t) => ({
        timestamp: t.timestamp.slice(11, 16),
        role: t.role,
        content: t.content,
      })),
    };
  }
  if (state.kind === "mock") {
    return state.data;
  }
  return null;
}

export default function TeacherGroupReportPage() {
  const params = useParams();
  const groupId =
    typeof params?.groupId === "string" ? params.groupId : "";

  const [state, setState] = useState<ReportState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    fetchGroupLatestReport(groupId)
      .then((data) => {
        if (alive) {
          setState({ kind: "live", data });
        }
      })
      .catch((err) => {
        if (!alive) return;
        const mock = getMockSessionReport(groupId);
        if (err instanceof NotFoundError) {
          if (mock) {
            setState({ kind: "mock", data: mock });
          } else {
            setState({ kind: "empty" });
          }
          return;
        }
        console.warn("[teacher-ui] group report load failed:", err);
        if (mock) {
          setState({ kind: "mock", data: mock });
        } else {
          setState({ kind: "empty" });
        }
      });
    return () => {
      alive = false;
    };
  }, [groupId]);

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

  const report = toDisplay(state)!;
  const parentClass =
    state.kind === "mock" && report.classId
      ? getMockClass(report.classId)
      : undefined;
  const isLive = state.kind === "live";
  const sharedWithTeacher = state.kind === "live" ? state.data.sharedWithTeacher : false;

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {parentClass ? (
          <>
            <Link
              href={`/teacher/classes/${parentClass.id}`}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {parentClass.name}
            </Link>
            <span aria-hidden="true">/</span>
          </>
        ) : (
          <Link
            href="/teacher/classes"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </Link>
        )}
        <span aria-hidden="true">/</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {groupId}
        </code>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Report</span>
      </nav>

      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold sm:text-2xl">Session report</h1>
          {!isLive ? (
            <span className="rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
              mock data
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Activity: <strong>{report.activityName}</strong> · Session:{" "}
          {report.startedAtLabel}
        </p>
      </header>

      <section
        aria-labelledby="summary-label"
        className="flex flex-col gap-2 rounded border border-border bg-background p-4"
      >
        <h2 id="summary-label" className="text-base font-semibold">
          Session summary
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

        {report.checklistComplete.length + report.checklistIncomplete.length >
        0 ? (
          <>
            <h3 className="mt-2 text-sm font-semibold">Self-assessment</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {report.checklistComplete.map((c) => (
                <li key={c} className="flex items-start gap-2">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                    aria-label="Completed"
                  />
                  <span>{c}</span>
                </li>
              ))}
              {report.checklistIncomplete.map((c) => (
                <li key={c} className="flex items-start gap-2 text-muted-foreground">
                  <Circle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-label="Not completed"
                  />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section aria-labelledby="log-label" className="flex flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="log-label" className="text-base font-semibold">
            Conversation log
          </h2>
          <button
            type="button"
            disabled
            title="CSV export lands in Phase 3"
            className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium text-muted-foreground opacity-60"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download CSV
          </button>
        </header>
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
      </section>

      <section
        aria-labelledby="share-label"
        className="flex flex-col gap-2 rounded border border-dashed border-border bg-muted/30 p-4"
      >
        <h2 id="share-label" className="text-base font-semibold">
          Share with the student group?
        </h2>
        {isLive ? (
          sharedWithTeacher ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              The group has opted in to share this session.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              The group has not opted in to share yet.
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            Students opt in via the chat toggle to share their session.
          </p>
        )}
        <div>
          <button
            type="button"
            disabled={!sharedWithTeacher}
            title={sharedWithTeacher ? "Send a summary to the group" : "The group has not opted in to sharing"}
            className={`flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium ${
              sharedWithTeacher
                ? "text-foreground hover:bg-accent"
                : "text-muted-foreground opacity-60"
            }`}
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send summary
          </button>
        </div>
      </section>
    </div>
  );
}
