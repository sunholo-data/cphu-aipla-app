import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Download,
  Send,
} from "lucide-react";

import {
  getMockClass,
  getMockSessionReport,
} from "../../../_mock-data";

type PageProps = {
  params: Promise<{ groupId: string }>;
};

export default async function TeacherGroupReportPage({ params }: PageProps) {
  const { groupId } = await params;
  const report = getMockSessionReport(groupId);
  if (!report) {
    notFound();
  }
  const parentClass = getMockClass(report.classId);

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
        ) : null}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {report.groupCode}
        </code>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">Report</span>
      </nav>

      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold sm:text-2xl">Session report</h1>
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
        <p className="text-xs text-muted-foreground">
          Students opt in at session end to receive a summary. Sharing is wired in Phase 3.
        </p>
        <div>
          <button
            type="button"
            disabled
            title="Share is wired in Phase 3"
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Send summary
          </button>
        </div>
      </section>
    </div>
  );
}
