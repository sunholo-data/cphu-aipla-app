import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  FileText,
  MessageCircle,
  Plus,
  Users,
} from "lucide-react";

import {
  MOCK_CLASSES,
  MOCK_RECENT_SESSIONS,
} from "../_mock-data";

export default function TeacherClassesPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">My classes</h1>
          <p className="text-sm text-muted-foreground">
            Classes you own. Pick one to manage groups and configure lessons.
          </p>
        </div>
        <button
          type="button"
          disabled
          title="Class creation lands in Phase 3"
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New class
        </button>
      </header>

      <section
        aria-labelledby="classes-grid-label"
        className="grid gap-4 sm:grid-cols-2"
      >
        <h2 id="classes-grid-label" className="sr-only">
          Class cards
        </h2>
        {MOCK_CLASSES.map((cls) => (
          <article
            key={cls.id}
            className="flex flex-col gap-3 rounded border border-border bg-background p-4 shadow-sm"
          >
            <header className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold">{cls.name}</h3>
              <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </header>
            <p className="text-sm text-muted-foreground">
              {cls.groupsActive} groups active
              {cls.groupsTotal !== cls.groupsActive
                ? ` of ${cls.groupsTotal}`
                : ""}
              {" · "}
              {cls.activities.filter((a) => a.configured).length} lessons configured
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Link
                href={`/teacher/classes/${cls.id}`}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Manage
              </Link>
              {cls.groups[0] ? (
                <Link
                  href={`/teacher/reports/groups/${cls.groups[0].code}`}
                  className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  Latest report
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      <section aria-labelledby="recent-activity-label" className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <h2 id="recent-activity-label" className="text-lg font-semibold">
            Recent activity
          </h2>
          <Link
            href="/teacher/analytics"
            className="flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            <span>Chat with all session data</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </header>

        <ul className="divide-y divide-border rounded border border-border">
          {MOCK_RECENT_SESSIONS.map((row) => (
            <li
              key={`${row.classId}:${row.groupCode}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {row.groupCode}
                </code>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                  {row.activityName}
                </span>
                <span className="text-xs text-muted-foreground">{row.whenLabel}</span>
              </div>
              <Link
                href={`/teacher/reports/groups/${row.groupCode}`}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
              >
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                View
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
