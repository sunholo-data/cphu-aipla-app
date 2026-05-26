"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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

import { getMockClass } from "../../_mock-data";
import {
  type ClassPayload,
  getClass,
  mintGroupCodes,
} from "@/lib/teacherApi";

export default function TeacherClassDetailPage() {
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";

  const [cls, setCls] = useState<ClassPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<
    "loading" | "ok" | "not-found" | "error"
  >("loading");
  const [toast, setToast] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);

  // Activities still come from the mock until /api/skills + per-class
  // lessons UX lands in v1.1 (teacher-artefact-parameters.md). We
  // resolve the activities list off MOCK as a soft fallback when the
  // class id matches a mocked class id (1.G-Ph2 demo); otherwise show
  // an empty placeholder.
  const mockClass = getMockClass(id);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const fresh = await getClass(id);
      setCls(fresh);
      setLoadStatus("ok");
    } catch (err) {
      if (err instanceof Error && err.name === "NotFoundError") {
        setLoadStatus("not-found");
      } else {
        setLoadError(
          err instanceof Error ? err.message : "failed to load class",
        );
        setLoadStatus("error");
      }
    }
  }, [id]);

  useEffect(() => {
    if (id) void refresh();
  }, [id, refresh]);

  if (!id) {
    notFound();
  }

  if (loadStatus === "not-found") {
    notFound();
  }

  if (loadStatus === "loading") {
    return (
      <p className="text-sm text-muted-foreground">Loading class&hellip;</p>
    );
  }

  if (loadStatus === "error" || !cls) {
    return (
      <p
        role="alert"
        className="rounded border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        Couldn&rsquo;t load class: {loadError ?? "unknown error"}
      </p>
    );
  }

  async function handleNewGroup() {
    setMinting(true);
    try {
      const result = await mintGroupCodes(cls!.classId, 1);
      const code = result.codes[0] ?? "";
      void navigator.clipboard?.writeText(code).catch(() => {});
      setToast(`Group code ${code} created — copied to clipboard`);
      window.setTimeout(() => setToast(null), 4000);
      await refresh();
    } catch (err) {
      setToast(
        err instanceof Error
          ? `Mint failed: ${err.message}`
          : "Mint failed",
      );
      window.setTimeout(() => setToast(null), 5000);
    } finally {
      setMinting(false);
    }
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
            {cls.groupCodes.length} group
            {cls.groupCodes.length === 1 ? "" : "s"} · {cls.lessons.length}{" "}
            lesson{cls.lessons.length === 1 ? "" : "s"} assigned
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cls.groupCodes[0] ? (
            <Link
              href={`/teacher/reports/groups/${cls.groupCodes[0]}`}
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
            disabled={minting}
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {minting ? "Minting…" : "New group"}
          </button>
        </header>

        {cls.groupCodes.length === 0 ? (
          <p className="rounded border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No group codes yet. Mint one with &ldquo;New group&rdquo; — students
            join the chat by entering the code.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded border border-border">
            {cls.groupCodes.map((code) => (
              <li
                key={code}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">
                    {code}
                  </code>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleCopyCode(code)}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy code
                  </button>
                  <Link
                    href={`/teacher/reports/groups/${code}`}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                    aria-label={`Open report for ${code}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mockClass ? (
        <section
          aria-labelledby="activities-label"
          className="flex flex-col gap-3"
        >
          <header className="flex items-center justify-between">
            <h2 id="activities-label" className="text-lg font-semibold">
              Activities available to this class
            </h2>
            <button
              type="button"
              disabled
              title="Lessons-picker UI lands with v1.1 teacher-artefact-parameters"
              className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add
            </button>
          </header>

          <ul className="divide-y divide-border rounded border border-border">
            {mockClass.activities.map((a) => (
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
                    <span className="text-xs text-muted-foreground">
                      {a.blurb}
                    </span>
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
      ) : null}

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
