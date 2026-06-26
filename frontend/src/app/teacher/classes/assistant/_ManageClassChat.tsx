/**
 * `_ManageClassChat` — the AG-UI chat island for /teacher/classes/assistant.
 *
 * Renders against the `manage-class` skill, the conversational twin of
 * the React /teacher/classes dashboard. The skill's tools
 * (`list_my_classes`, `create_class`, `mint_group_codes`) resolve the
 * signed-in teacher server-side and gate on ownership, so — unlike
 * `_AnalyticsChat` — this island needs NO class-scope prefix: the agent
 * discovers the teacher's classes itself.
 *
 * Structure mirrors `_AnalyticsChat` deliberately (slug→UUID resolution,
 * teacher-auth AGUIProvider, tool-call pills + "Show data" disclosure)
 * so the two teacher chat surfaces behave identically. If/when a third
 * teacher chat skill lands (e.g. activity-creation), extract the shared
 * shell — see the coordination note in the PR.
 */

"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Send, Sparkles } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent, type ToolCallState } from "@/hooks/useSkillAgent";
import { fetchWithTeacherAuth } from "@/lib/apiClient";

const SKILL_NAME = "manage-class";
const PLATFORM_OWNER_ID = "aipla-platform";

export const SUGGESTED_QUESTIONS = [
  "Show my classes and how active they are",
  "Create a new class called Fysik 9A",
  "Mint 3 group codes for Fysik 9A",
  "What activities do I have, and which are still drafts?",
  "How much has Fysik 9A cost this month?",
] as const;

/**
 * Public entry point. Resolves the `manage-class` slug to its Firestore
 * UUID (the stream endpoint keys on UUID, not slug — same 404 gotcha as
 * analytics-chat) then mounts an `AGUIProvider` in teacher-auth mode.
 */
export function ManageClassChat() {
  const [skillId, setSkillId] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolveError(null);
    fetchWithTeacherAuth(
      `/api/proxy/api/skills/by-slug/${encodeURIComponent(PLATFORM_OWNER_ID)}/${encodeURIComponent(SKILL_NAME)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "Manage-class skill is not registered on this environment yet — run scripts/seed-platform-skills.sh."
              : `failed to resolve skill (${res.status})`,
          );
        }
        const body = (await res.json()) as { skillId?: string; skill_id?: string };
        const id = body.skillId ?? body.skill_id;
        if (!id) throw new Error("skill resolution returned no id");
        setSkillId(id);
      })
      .catch((e) => {
        if (!cancelled) setResolveError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (resolveError) {
    return (
      <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
        {resolveError}
      </div>
    );
  }
  if (!skillId) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="manage-class-loading">
        Loading chat…
      </p>
    );
  }
  return (
    <AGUIProvider key={skillId} skillId={skillId} useTeacherAuth>
      <ManageClassChatInner />
    </AGUIProvider>
  );
}

function ManageClassChatInner() {
  const { messages, toolCalls, sendMessage, isLoading, error, stageLabel } = useSkillAgent();
  const [input, setInput] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage(trimmed);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="manage-class-chat">
      <ConversationLog messages={messages} toolCalls={toolCalls} isLoading={isLoading} stageLabel={stageLabel} />

      {error ? (
        <div role="alert" className="rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error.message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} aria-labelledby="manage-label" className="flex flex-col gap-2">
        <label id="manage-label" htmlFor="manage-input" className="text-sm font-medium">
          Tell me what you want to do with your classes
        </label>
        <div className="flex flex-wrap items-stretch gap-2">
          <input
            id="manage-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="e.g. Create a class called Fysik 9A and mint 3 codes…"
            className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="flex items-center gap-1.5 rounded border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {isLoading ? "Working…" : "Send"}
          </button>
        </div>
      </form>

      <section aria-labelledby="suggested-label" className="flex flex-col gap-2">
        <h2 id="suggested-label" className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Try
        </h2>
        <ul className="flex flex-col gap-1.5">
          {SUGGESTED_QUESTIONS.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => setInput(q)}
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
        No conversation yet. Pick a suggestion below or type what you want
        to do — create a class, mint join-codes, look up your activities,
        or ask how a class is doing.
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
            <p className="whitespace-pre-wrap">{m.content}</p>
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
