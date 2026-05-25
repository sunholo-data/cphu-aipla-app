"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  FileText,
  MessageCircle,
  Plus,
  Settings,
} from "lucide-react";

import {
  type GroupStatus,
  type MockGroup,
  getMockClass,
} from "../../_mock-data";

const FAKE_NEW_GROUP_CODES = [
  "bright-fox-42",
  "soft-cloud-08",
  "lively-pine-93",
  "quiet-otter-21",
  "warm-meadow-65",
];

function statusBadgeClass(status: GroupStatus): string {
  switch (status) {
    case "active":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
    case "idle":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
    case "completed":
      return "bg-muted text-muted-foreground";
  }
}

export default function TeacherClassDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const cls = getMockClass(id);
  if (!cls) {
    notFound();
  }

  const initialGroups: MockGroup[] = cls.groups;
  const [groups, setGroups] = useState<MockGroup[]>(initialGroups);
  const [toast, setToast] = useState<string | null>(null);

  function handleNewGroup() {
    const next =
      FAKE_NEW_GROUP_CODES[groups.length % FAKE_NEW_GROUP_CODES.length] ??
      "bright-fox-42";
    setGroups((prev) => [
      ...prev,
      { code: next, status: "idle", lastActiveLabel: "just minted" },
    ]);
    void navigator.clipboard?.writeText(next).catch(() => {
      // No-op: clipboard access can fail in test or non-secure contexts.
    });
    setToast(`Group code ${next} created (mock) — copied to clipboard`);
    window.setTimeout(() => setToast(null), 4000);
  }

  function handleCopyCode(code: string) {
    void navigator.clipboard?.writeText(code).catch(() => {});
    setToast(`Copied ${code}`);
    window.setTimeout(() => setToast(null), 2500);
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link
          href="/teacher/classes"
          className="flex items-center gap-1 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Dashboard
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-foreground">{cls.name}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{cls.name}</h1>
          <p className="text-sm text-muted-foreground">
            {groups.length} groups · {cls.activities.length} lessons assigned
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {groups[0] ? (
            <Link
              href={`/teacher/reports/groups/${groups[0].code}`}
              className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              Latest group report
            </Link>
          ) : null}
          <Link
            href="/teacher/analytics"
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat with class data
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </header>

      <section aria-labelledby="groups-label" className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <h2 id="groups-label" className="text-lg font-semibold">
            Groups
          </h2>
          <button
            type="button"
            onClick={handleNewGroup}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            New group
          </button>
        </header>

        <ul className="divide-y divide-border rounded border border-border">
          {groups.map((g) => (
            <li
              key={g.code}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                  {g.code}
                </code>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${statusBadgeClass(
                    g.status,
                  )}`}
                >
                  {g.lastActiveLabel}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleCopyCode(g.code)}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  Copy code
                </button>
                <Link
                  href={`/teacher/reports/groups/${g.code}`}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                  aria-label={`Open report for ${g.code}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="activities-label" className="flex flex-col gap-3">
        <header className="flex items-center justify-between">
          <h2 id="activities-label" className="text-lg font-semibold">
            Activities available to this class
          </h2>
          <button
            type="button"
            disabled
            title="Add activity lands in Phase 3"
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add
          </button>
        </header>

        <ul className="divide-y divide-border rounded border border-border">
          {cls.activities.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {a.configured ? (
                  <CheckCircle2
                    className="h-4 w-4 text-emerald-600"
                    aria-label="Configured"
                  />
                ) : (
                  <Circle
                    className="h-4 w-4 text-muted-foreground"
                    aria-label="Not configured"
                  />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{a.name}</span>
                  <span className="text-xs text-muted-foreground">{a.blurb}</span>
                </div>
              </div>
              <Link
                href={`/teacher/activities/${a.id}`}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                {a.configured ? "Configure" : "Add"}
              </Link>
            </li>
          ))}
        </ul>
      </section>

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
    </div>
  );
}
