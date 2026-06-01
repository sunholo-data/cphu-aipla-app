"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  Lightbulb,
  MessageCircle,
  Send,
  Sparkles,
} from "lucide-react";

import {
  MOCK_ANALYTICS_ANSWER,
  MOCK_ANALYTICS_QUESTION,
  MOCK_ANALYTICS_SUGGESTIONS,
} from "../_mock-data";
import { type ClassPayload, listClasses } from "@/lib/teacherApi";

const TIME_SCOPES = ["All time", "This week", "Today"];

export default function TeacherAnalyticsPage() {
  const [classes, setClasses] = useState<ClassPayload[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [timeScope, setTimeScope] = useState(TIME_SCOPES[0]!);

  useEffect(() => {
    void listClasses()
      .then((cls) => {
        setClasses(cls);
        if (cls[0]) setSelectedClassId(cls[0].classId);
      })
      .catch(() => {
        // API unavailable (e.g. no auth yet) — show empty state; page
        // still renders and the teacher can try again after sign-in.
      });
  }, []);

  const selectedClass = classes.find((c) => c.classId === selectedClassId);

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
        <span className="text-foreground">Analytics chat</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" aria-hidden="true" />
          <h1 className="text-xl font-semibold sm:text-2xl">Analytics chat</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Data scope:</span>
          <ClassSelect
            classes={classes}
            value={selectedClassId}
            onChange={setSelectedClassId}
          />
          <TimeSelect value={timeScope} onChange={setTimeScope} options={TIME_SCOPES} />
        </div>
      </header>

      {selectedClass ? (
        <p className="text-xs text-muted-foreground">
          Showing data for <strong>{selectedClass.name}</strong> · {timeScope.toLowerCase()}
        </p>
      ) : null}

      <article className="flex flex-col gap-3 rounded border border-border bg-background p-4">
        <h2 className="text-sm font-semibold">{MOCK_ANALYTICS_QUESTION}</h2>
        <div className="h-px w-full bg-border" aria-hidden="true" />
        <p className="text-sm leading-relaxed text-foreground">
          {MOCK_ANALYTICS_ANSWER}
        </p>
      </article>

      <section aria-labelledby="ask-label" className="flex flex-col gap-2">
        <label
          id="ask-label"
          htmlFor="analytics-input"
          className="text-sm font-medium"
        >
          Ask a question about your session data
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            id="analytics-input"
            type="text"
            disabled
            placeholder="Ask a question about your session data…"
            className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm text-muted-foreground opacity-70"
          />
          <button
            type="button"
            disabled
            title="Analytics chat skill wired in M6"
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Ask
          </button>
        </div>
      </section>

      <section
        aria-labelledby="suggested-label"
        className="flex flex-col gap-2"
      >
        <h2
          id="suggested-label"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Suggested questions
        </h2>
        <ul className="flex flex-col gap-1.5">
          {MOCK_ANALYTICS_SUGGESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                disabled
                title="Suggested-question prefill wired in M6"
                className="flex w-full items-center gap-2 rounded border border-dashed border-border bg-muted/30 px-3 py-2 text-left text-sm text-muted-foreground opacity-80"
              >
                <Lightbulb className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{q}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ClassSelect({
  classes,
  value,
  onChange,
}: {
  classes: ClassPayload[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (classes.length === 0) {
    return (
      <span className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
        Loading classes…
      </span>
    );
  }
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">Class</span>
      <select
        aria-label="Filter by class"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        {classes.map((c) => (
          <option key={c.classId} value={c.classId}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
    </label>
  );
}

function TimeSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      <span className="sr-only">Time range</span>
      <select
        aria-label="Filter by time range"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none bg-transparent text-xs focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
    </label>
  );
}
