// Workshop W5b — AG-UI: text events → chat bubbles
// TypingIndicator is shown between RUN_STARTED and the first TEXT_MESSAGE_CONTENT.
// Surfaces three layers of progress, in priority order:
//   1. stageLabel — server-authored STAGE_PROGRESS Custom event (Reading 2 documents…,
//      Thinking…). Wins over toolName so the per-stage breakdown the agent emits
//      stays the source of truth — see docs/design/v6.1.0/ttft-instrumentation.md.
//   2. activeToolName — fallback when no stage label, but a tool is running.
//   3. Bouncing dots — pure waiting, no signal yet. After 5 s of that the dots
//      say so in words ("Working on it…", then "Still working…" at 20 s), so a
//      slow start never reads as a hang. Ported from platform-source's UI audit
//      (2026-11-03, step 4); AIPLA keeps the copy in messages/{da,en}/chat.json.
// Disappears on first token.
// See: docs/talks/workshop.md §W5

"use client";

import { useEffect, useState } from "react";
import { BrandAvatar } from "@/components/chat/BrandAvatar";
import { useT } from "@/i18n";

interface TypingIndicatorProps {
  /**
   * Server-authored stage label from AG-UI STAGE_PROGRESS Custom events.
   * Takes priority over activeToolName so the agent's own progress signal
   * stays canonical. Null when no STAGE_PROGRESS has fired this run.
   */
  stageLabel?: string | null;
  activeToolName?: string | null;
}

export function TypingIndicator({ stageLabel, activeToolName }: TypingIndicatorProps) {
  const t = useT("TypingIndicator");
  const labelText = stageLabel ?? null;
  const toolText = !labelText && activeToolName ? activeToolName : null;
  const waited = useSecondsSinceMount();
  const waitText = waited >= 20 ? t("stillWorking") : waited >= 5 ? t("workingOnIt") : null;

  return (
    <div className="flex items-start gap-3 py-1 animate-in fade-in-0 duration-300" role="status" aria-live="polite">
      <BrandAvatar />
      <div className="flex items-center gap-2 rounded-[2px_8px_8px_8px] border border-border bg-[hsl(0,0%,98%)] px-3 py-2.5">
        {labelText ? (
          <>
            <span className="text-xs text-muted-foreground">{labelText}</span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          </>
        ) : toolText ? (
          <>
            <span className="text-xs text-muted-foreground">
              {t("using")} <span className="font-medium text-foreground">{toolText}</span>…
            </span>
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
          </>
        ) : (
          <>
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full bg-primary animate-bounce"
              style={{ animationDelay: "300ms" }}
            />
            {waitText && <span className="ml-1 text-xs text-muted-foreground">{waitText}</span>}
          </>
        )}
      </div>
    </div>
  );
}

/** Whole seconds since the indicator appeared (ticks once a second). */
function useSecondsSinceMount(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return seconds;
}
