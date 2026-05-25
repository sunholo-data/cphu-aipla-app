import Link from "next/link";
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
  MOCK_CLASSES,
  MOCK_DEFAULT_CLASS_ID,
} from "../_mock-data";

const TIME_SCOPES = [
  "All time",
  "This week",
  "Today",
];

export default function TeacherAnalyticsPage() {
  const defaultClass =
    MOCK_CLASSES.find((c) => c.id === MOCK_DEFAULT_CLASS_ID) ?? MOCK_CLASSES[0]!;

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
          <ScopePill label={defaultClass.name} />
          <ScopePill label={TIME_SCOPES[0]!} />
        </div>
      </header>

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
            title="Analytics chat is wired in Phase 3"
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
                title="Suggested-question prefill is wired in Phase 3"
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

function ScopePill({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground">
      {label}
      <ChevronDown className="h-3 w-3" aria-hidden="true" />
    </span>
  );
}
