"use client";

import { useCallback, useState } from "react";
import { Send } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent } from "@/hooks/useSkillAgent";
import { useSkillSlugResolver } from "@/hooks/useSkillSlugResolver";
import { useSessionMessages } from "@/hooks/useSessionMessages";

import { FloatingCopilot } from "./FloatingCopilot";
import { ProposalCard } from "./ProposalCard";
import { DEFAULT_LABELS, type TeacherCopilotConfig } from "./types";

const STORAGE_PREFIX = "teacherCopilot:";

/** Read the persisted threadId for a co-pilot scope, or mint + persist a fresh
 *  one. SSR-safe (returns "" when there's no window; the panel only mounts the
 *  AG-UI provider client-side after the skill slug resolves). */
function readOrMintThreadId(storageKey: string): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    window.localStorage.setItem(storageKey, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * Shared teacher co-pilot — a floating, propose/Apply chat partner that drops
 * onto any teacher surface (class management, activity authoring, analytics).
 * The shell owns the panel, slug→UUID resolution, teacher auth, the AG-UI chat
 * transport, the proposal cards, AND cross-visit continuity (a persisted
 * threadId resumes the conversation, with a "New chat" reset). Each surface
 * supplies only its config (skill slug, scope prefix, proposal parser +
 * descriptor, apply router).
 *
 * Design: docs/design/aipla/v1.1.0-feedback/teacher-coworking-copilot.md.
 */
export function TeacherCopilot<P>(config: TeacherCopilotConfig<P>) {
  const storageKey = `${STORAGE_PREFIX}${config.persistKey ?? config.skillName}`;
  // Mint/restore a stable threadId so the conversation survives leaving the page
  // and coming back (the backend session is keyed on it; useSessionMessages
  // reloads the prior turns). Stable from mount → no URL-writeback rebuild.
  const [threadId, setThreadId] = useState<string>(() => readOrMintThreadId(storageKey));

  const newChat = useCallback(() => {
    const fresh = crypto.randomUUID();
    try {
      window.localStorage.setItem(storageKey, fresh);
    } catch {
      /* private mode / no storage — still resets in-memory below */
    }
    setThreadId(fresh);
  }, [storageKey]);

  return (
    <FloatingCopilot title={config.title} onNewChat={newChat}>
      <CopilotResolver config={config} threadId={threadId} />
    </FloatingCopilot>
  );
}

/**
 * Resolve the skill slug to its per-environment Firestore UUID (the stream
 * endpoint keys on UUID, not slug), then mount the teacher-auth AG-UI provider
 * seeded with the persisted threadId so the session resumes.
 */
function CopilotResolver<P>({ config, threadId }: { config: TeacherCopilotConfig<P>; threadId: string }) {
  const { skillId, resolveError } = useSkillSlugResolver(config.skillName);

  if (resolveError) {
    return (
      <div role="alert" className="m-3 rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
        {resolveError}
      </div>
    );
  }
  if (!skillId) {
    return (
      <p data-testid="copilot-loading" className="p-3 text-sm text-muted-foreground">
        {DEFAULT_LABELS.thinking}
      </p>
    );
  }
  return (
    <AGUIProvider key={skillId} skillId={skillId} sessionId={threadId || undefined} useTeacherAuth>
      <CopilotChat config={config} threadId={threadId} />
    </AGUIProvider>
  );
}

function CopilotChat<P>({ config, threadId }: { config: TeacherCopilotConfig<P>; threadId: string }) {
  const labels = { ...DEFAULT_LABELS, ...config.labels };
  const { messages: liveMessages, toolCalls, sendMessage, isLoading, error } = useSkillAgent();
  // Prior turns for a resumed thread (empty for a fresh one — a 404 lands as
  // sessionGone, not an error). Prepend before the live turns; ids never clash
  // (history ids are `hist-*`, live ids are AG-UI message ids).
  const { initialMessages } = useSessionMessages(threadId || null);
  const messages = initialMessages.length ? [...initialMessages, ...liveMessages] : liveMessages;
  const [input, setInput] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage(`${config.scopePrefix ?? ""}${trimmed}`);
  };

  const parse = config.parseProposal;
  const proposals = parse
    ? toolCalls
        .map((tc) => ({ id: tc.id, proposal: parse(tc) }))
        .filter((p): p is { id: string; proposal: P } => p.proposal !== null)
    : [];

  const empty = messages.length === 0 && proposals.length === 0 && !isLoading;
  const strip = config.stripPrefix ?? ((c: string) => c);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="teacher-copilot">
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3" aria-live="polite">
        {empty ? <p className="text-xs text-muted-foreground">{config.emptyText}</p> : null}
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
            <p className="whitespace-pre-wrap">{m.role === "user" ? strip(m.content) : m.content}</p>
          </article>
        ))}
        {config.proposalDescriptor && config.onApplyProposal
          ? proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p.proposal}
                descriptor={config.proposalDescriptor!}
                onApply={config.onApplyProposal!}
                labels={config.labels}
              />
            ))
          : null}
        {isLoading ? <p className="text-xs text-muted-foreground">{labels.thinking}</p> : null}
      </div>

      {error ? (
        <div role="alert" className="mx-3 mb-1 rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          {error.message}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex items-stretch gap-2 border-t border-border p-2">
        <input
          type="text"
          aria-label={config.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder={config.placeholder}
          className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="flex items-center gap-1.5 rounded border border-border bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Send
        </button>
      </form>
    </div>
  );
}
