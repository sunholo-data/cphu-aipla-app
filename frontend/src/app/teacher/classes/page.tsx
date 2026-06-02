"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  FileText,
  MessageCircle,
  Plus,
  Users,
} from "lucide-react";

import {
  type ClassPayload,
  type SessionRow,
  createClass,
  listClassRecentSessions,
  listClasses,
} from "@/lib/teacherApi";


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

export default function TeacherClassesPage() {
  const [classes, setClasses] = useState<ClassPayload[] | null>(null);
  const [recentSessions, setRecentSessions] = useState<SessionRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNewClassForm, setShowNewClassForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const list = await listClasses();
      setClasses(list);
      // Fetch recent student sessions across all classes (per-class endpoint
      // queries by groupCode, so only student sessions appear here).
      const batches = await Promise.all(list.map((c) => listClassRecentSessions(c.classId)));
      const merged = batches
        .flat()
        .sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime(),
        )
        .slice(0, 10);
      setRecentSessions(merged);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "failed to load classes",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

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
          onClick={() => setShowNewClassForm((v) => !v)}
          className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New class
        </button>
      </header>

      {showNewClassForm ? (
        <NewClassForm
          onCreated={() => {
            setShowNewClassForm(false);
            void refresh();
          }}
          onCancel={() => setShowNewClassForm(false)}
        />
      ) : null}

      {loadError ? (
        <p
          role="alert"
          className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Couldn&rsquo;t load classes: {loadError}
        </p>
      ) : null}

      <section
        aria-labelledby="classes-grid-label"
        className="grid gap-4 sm:grid-cols-2"
      >
        <h2 id="classes-grid-label" className="sr-only">
          Class cards
        </h2>
        {classes === null ? (
          <p className="text-sm text-muted-foreground">Loading classes&hellip;</p>
        ) : classes.length === 0 ? (
          <EmptyState onCreateClick={() => setShowNewClassForm(true)} />
        ) : (
          classes.map((cls) => <ClassCard key={cls.classId} cls={cls} />)
        )}
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

        {recentSessions.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No student sessions yet. Sessions appear here once students join a group and start chatting.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {recentSessions.map((row) =>
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
                      {row.title ? (
                        <span className="flex items-center gap-1 text-foreground">
                          <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          {row.title}
                        </span>
                      ) : null}
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
                    {row.title ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        {row.title}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {row.turnCount} turn{row.turnCount === 1 ? "" : "s"} · {relativeTime(row.lastMessageAt)}
                    </span>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

function ClassCard({ cls }: { cls: ClassPayload }) {
  return (
    <article className="flex flex-col gap-3 rounded border border-border bg-background p-4 shadow-sm">
      <header className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{cls.name}</h3>
        <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </header>
      <p className="text-sm text-muted-foreground">
        {cls.groupCodes.length} group{cls.groupCodes.length === 1 ? "" : "s"} ·{" "}
        {cls.lessons.length} lesson{cls.lessons.length === 1 ? "" : "s"}{" "}
        configured
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <Link
          href={`/teacher/classes/${cls.classId}`}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Manage
        </Link>
        {cls.groupCodes[0] ? (
          <Link
            href={`/teacher/reports/groups/${cls.groupCodes[0]}`}
            className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Latest report
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="col-span-full flex flex-col items-start gap-2 rounded border border-dashed border-border p-6">
      <p className="text-sm font-medium">No classes yet.</p>
      <p className="text-sm text-muted-foreground">
        Create your first class to start minting group codes for students.
      </p>
      <button
        type="button"
        onClick={onCreateClick}
        className="mt-2 flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Create class
      </button>
    </div>
  );
}

function NewClassForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createClass({
        name: name.trim(),
        description: description.trim() || null,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create class");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-border bg-background p-4"
      aria-label="Create class"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Class name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={1}
          maxLength={200}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
          placeholder="e.g. Physik 9A vår 2026"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description (optional)</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={2}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || name.trim().length === 0}
          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create"}
        </button>
      </div>
    </form>
  );
}
