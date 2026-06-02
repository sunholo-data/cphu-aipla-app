/**
 * `_AnalyticsChat` — the AG-UI chat island for /teacher/analytics.
 *
 * Renders against the `analytics-chat` skill (sprint
 * ANALYTICS-CHAT-AND-INSIGHTS, M6). The page-level shell stays in
 * `page.tsx` so it can do auth gating and class-list loading without
 * pulling the chat hook into that surface. The island here is the
 * only thing that talks to the skill stream.
 *
 * Design choices that are deliberate, not preliminary:
 *
 * - **Scope prefill is system-message-prefixed**, not state-passed.
 *   The analytics-chat agent reads `class_id` + time-scope from the
 *   first user message rather than `tool_context.state`. M5's
 *   `aiplatform analytics ask` CLI uses the same prefix shape; the
 *   contract is consistent across surfaces.
 * - **Tool-call pills + "Show data" disclosure**: the pill renders
 *   while the tool runs; once `argsJson` is populated the disclosure
 *   shows the raw kwargs the agent passed. The full SQL lives at the
 *   route layer (M5 `/api/analytics/probe`); this surface stays
 *   client-side. (If we ever want the SQL inline, we can wire a
 *   second event channel — out of scope for v1.)
 * - **Suggested questions prefill the input but do not auto-submit**.
 *   Per the design doc: the teacher should review and edit before
 *   sending. Auto-submit on click was on the table and was rejected
 *   (axiom 11: USABLE BY DESIGN).
 */

"use client";

import { useState } from "react";
import { Lightbulb, Send, Sparkles } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent, type ToolCallState } from "@/hooks/useSkillAgent";

const SKILL_ID = "analytics-chat";

export const SUGGESTED_QUESTIONS = [
  "How many messages did groups send this week?",
  "Which group was most active in the last session?",
  "What misconceptions came up most often?",
  "How long did groups spend on the simulator?",
] as const;

interface AnalyticsChatProps {
  classId: string;
  className: string;
  timeScope: string;
}

/**
 * Public entry point. Wraps the inner client with an `AGUIProvider`
 * scoped to the analytics-chat skill. Re-mounts when `classId` changes
 * via the React `key` — that resets the AG-UI session so a previous
 * class's conversation doesn't leak into the next one.
 */
export function AnalyticsChat(props: AnalyticsChatProps) {
  if (!props.classId) {
    return <EmptyState />;
  }
  return (
    <AGUIProvider key={props.classId} skillId={SKILL_ID}>
      <AnalyticsChatInner {...props} />
    </AGUIProvider>
  );
}

function EmptyState() {
  return (
    <div className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      Select a class above to start asking questions about its session
      data.
    </div>
  );
}

function AnalyticsChatInner({ classId, className, timeScope }: AnalyticsChatProps) {
  const { messages, toolCalls, sendMessage, isLoading, error, stageLabel } =
    useSkillAgent();
  const [input, setInput] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    // System-message-style scope prefix. Matches the
    // `aiplatform analytics ask` CLI shape so the agent sees one
    // consistent contract regardless of surface.
    const prefixed = `[class_id=${classId} time_scope="${timeScope}"] ${trimmed}`;
    setInput("");
    await sendMessage(prefixed);
  };

  const onSuggest = (q: string) => {
    setInput(q);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="analytics-chat">
      <p className="text-xs text-muted-foreground">
        Scope: <strong>{className}</strong> · {timeScope.toLowerCase()}
      </p>

      <ConversationLog
        messages={messages}
        toolCalls={toolCalls}
        isLoading={isLoading}
        stageLabel={stageLabel}
      />

      {error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error.message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} aria-labelledby="ask-label" className="flex flex-col gap-2">
        <label id="ask-label" htmlFor="analytics-input" className="text-sm font-medium">
          Ask a question about your session data
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            id="analytics-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="Ask a question about your session data…"
            className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex items-center gap-1.5 rounded border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {isLoading ? "Asking…" : "Ask"}
          </button>
        </div>
      </form>

      <section aria-labelledby="suggested-label" className="flex flex-col gap-2">
        <h2 id="suggested-label" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Suggested questions
        </h2>
        <ul className="flex flex-col gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => onSuggest(q)}
                className="flex w-full items-center gap-2 rounded border border-border bg-background px-3 py-2 text-left text-sm hover:border-primary hover:bg-muted"
              >
                <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{q}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function ConversationLog({
  messages,
  toolCalls,
  isLoading,
  stageLabel,
}: {
  messages: ReturnType<typeof useSkillAgent>["messages"];
  toolCalls: ToolCallState[];
  isLoading: boolean;
  stageLabel: string | null;
}) {
  if (messages.length === 0 && !isLoading) {
    return (
      <article className="rounded border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        No conversation yet. Pick a suggested question below or type your
        own to start.
      </article>
    );
  }
  return (
    <div className="flex flex-col gap-3" aria-live="polite">
      {messages.map((m) => (
        <article
          key={m.id}
          data-role={m.role}
          className={
            m.role === "user"
              ? "ml-auto max-w-prose rounded border border-border bg-muted px-3 py-2 text-sm"
              : "max-w-prose rounded border border-border bg-background px-3 py-2 text-sm"
          }
        >
          {m.role === "assistant" ? (
            <AssistantBubble content={m.content} toolCalls={toolCalls.filter((tc) => tc.parentMessageId === m.id)} />
          ) : (
            <p className="whitespace-pre-wrap">{stripScopePrefix(m.content)}</p>
          )}
        </article>
      ))}
      {isLoading ? (
        <p className="text-xs text-muted-foreground" data-testid="loading-stage">
          {stageLabel ?? "Thinking…"}
        </p>
      ) : null}
    </div>
  );
}

function AssistantBubble({ content, toolCalls }: { content: string; toolCalls: ToolCallState[] }) {
  return (
    <div className="flex flex-col gap-2">
      {toolCalls.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {toolCalls.map((tc) => (
            <ToolCallPill key={tc.id} toolCall={tc} />
          ))}
        </div>
      ) : null}
      <p className="whitespace-pre-wrap">{content}</p>
      {toolCalls.length > 0 ? <ToolCallsDisclosure toolCalls={toolCalls} /> : null}
    </div>
  );
}

function ToolCallPill({ toolCall }: { toolCall: ToolCallState }) {
  const colour =
    toolCall.status === "running"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : toolCall.status === "success"
        ? "border-emerald-300 bg-emerald-50 text-emerald-900"
        : "border-red-300 bg-red-50 text-red-900";
  return (
    <span
      data-testid="tool-call-pill"
      data-status={toolCall.status}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-mono ${colour}`}
    >
      {toolCall.name}
    </span>
  );
}

/**
 * "Show data" disclosure under each agent turn. Surfaces the raw
 * tool-call arguments (`argsJson`). The full SQL lives behind
 * `/api/analytics/probe/{tool}` — this island stays client-side and
 * does not re-issue the query.
 */
function ToolCallsDisclosure({ toolCalls }: { toolCalls: ToolCallState[] }) {
  return (
    <details className="rounded border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">Show data</summary>
      <div className="mt-2 flex flex-col gap-2">
        {toolCalls.map((tc) => (
          <div key={tc.id}>
            <p className="font-mono">{tc.name}</p>
            {tc.argsJson ? (
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-[11px]">{tc.argsJson}</pre>
            ) : (
              <p className="text-[11px] italic">no arguments captured</p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Hide the `[class_id=… time_scope=…] ` prefix from the rendered user
 * bubble. The prefix is for the agent's eyes; teachers see the
 * question they actually typed.
 */
function stripScopePrefix(content: string): string {
  const match = content.match(/^\[class_id=[^\]]+\]\s*/);
  return match ? content.slice(match[0].length) : content;
}
