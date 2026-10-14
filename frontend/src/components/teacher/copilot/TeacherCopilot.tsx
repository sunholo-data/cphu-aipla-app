"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Sparkles, SquarePen } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent } from "@/hooks/useSkillAgent";
import { useSkillSlugResolver } from "@/hooks/useSkillSlugResolver";
import { useSessionMessages } from "@/hooks/useSessionMessages";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

import { FloatingCopilot } from "./FloatingCopilot";
import { ProposalCard } from "./ProposalCard";
import { type TeacherCopilotConfig } from "./types";
import { useCopilotLabels } from "./useCopilotLabels";
import { useLocaleMode, useT } from "@/i18n";

// 1.1.108 — every co-pilot turn carries the language the teacher reads the app
// in, so a reply to a canned request (a button, a pending ask) — where the
// teacher wrote nothing the model could match — still comes back in their
// language. The skills' rule: match what the teacher writes; fall back to this.
// Stripped before display, ahead of each surface's own `stripPrefix`.
export const UI_LANGUAGE_TAG = /^\[ui_language=(?:da|en)\] /;

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
  const [threadId, setThreadId] = useState<string>(() =>
    readOrMintThreadId(storageKey),
  );
  // CONCEPT-2 M3 — a question asked from the surface (a button on the page,
  // via `useCopilotEntry().ask`). Held here because the chat that can send it
  // lives several layers down, inside the AG-UI provider. Cleared by the chat
  // when it goes out, so the same ask cannot fire twice.
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);

  const newChat = useCallback(() => {
    const fresh = crypto.randomUUID();
    try {
      window.localStorage.setItem(storageKey, fresh);
    } catch {
      /* private mode / no storage — still resets in-memory below */
    }
    setThreadId(fresh);
  }, [storageKey]);

  // A surface asked to reopen a conversation (the sim workshop's "carry on
  // with this sim"). Keyed on `seq` so asking for the same thread again counts.
  const resumeId = config.resume?.threadId;
  const resumeSeq = config.resume?.seq;
  useEffect(() => {
    if (!resumeId) return;
    try {
      window.localStorage.setItem(storageKey, resumeId);
    } catch {
      /* no storage — still switches in memory */
    }
    setThreadId(resumeId);
  }, [resumeId, resumeSeq, storageKey]);

  const { onThreadChange } = config;
  useEffect(() => {
    if (threadId) onThreadChange?.(threadId);
  }, [threadId, onThreadChange]);

  if (config.docked) {
    return (
      <DockedCopilot title={config.title} onNewChat={newChat}>
        <CopilotResolver
          config={config}
          threadId={threadId}
          pendingAsk={pendingAsk}
          onAskSent={() => setPendingAsk(null)}
        />
      </DockedCopilot>
    );
  }
  return (
    <FloatingCopilot
      title={config.title}
      onNewChat={newChat}
      minimizeLabel={config.minimizeLabel}
      onClose={config.onClose}
      align={config.align}
      onAsk={setPendingAsk}
    >
      <CopilotResolver
        config={config}
        threadId={threadId}
        pendingAsk={pendingAsk}
        onAskSent={() => setPendingAsk(null)}
      />
    </FloatingCopilot>
  );
}

/** The co-pilot as a page column (same header and chat as the floating panel). */
function DockedCopilot({
  title,
  onNewChat,
  children,
}: {
  title: string;
  onNewChat: () => void;
  children: React.ReactNode;
}) {
  const t = useT("FloatingCopilot");
  return (
    <section
      aria-label={title}
      data-testid="docked-copilot"
      className="flex h-[min(80vh,760px)] min-h-[420px] flex-col overflow-hidden rounded border border-border bg-background"
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />{" "}
          {title}
        </h2>
        <button
          type="button"
          onClick={onNewChat}
          aria-label={t("newChat")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          <SquarePen className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </section>
  );
}

/**
 * Resolve the skill slug to its per-environment Firestore UUID (the stream
 * endpoint keys on UUID, not slug), then mount the teacher-auth AG-UI provider
 * seeded with the persisted threadId so the session resumes.
 */
function CopilotResolver<P>({
  config,
  threadId,
  pendingAsk,
  onAskSent,
}: {
  config: TeacherCopilotConfig<P>;
  threadId: string;
  pendingAsk?: string | null;
  onAskSent?: () => void;
}) {
  const { skillId, resolveError } = useSkillSlugResolver(config.skillName);
  const labels = useCopilotLabels(config.labels);

  if (resolveError) {
    return (
      <div
        role="alert"
        className="m-3 rounded border border-destructive bg-destructive/10 p-3 text-xs text-destructive"
      >
        {resolveError}
      </div>
    );
  }
  if (!skillId) {
    return (
      <p
        data-testid="copilot-loading"
        className="p-3 text-sm text-muted-foreground"
      >
        {config.loadingText ?? labels.thinking}
      </p>
    );
  }
  return (
    <AGUIProvider
      key={skillId}
      skillId={skillId}
      sessionId={threadId || undefined}
      useTeacherAuth
    >
      <CopilotChat
        config={config}
        threadId={threadId}
        pendingAsk={pendingAsk}
        onAskSent={onAskSent}
      />
    </AGUIProvider>
  );
}

/** Seconds since `running` turned on; 0 while off. */
function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running]);
  return elapsed;
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Server stage keys a co-pilot knows how to say in the teacher's language
 *  (the sim workshop's progress); any other stage shows the server's English
 *  label, and no stage shows "Thinking…". */
const STAGE_KEYS = {
  simReading: "stage_simReading",
  simChecking: "stage_simChecking",
  simChecked: "stage_simChecked",
  simEditing: "stage_simEditing",
} as const;

function stageText(
  stage: {
    label: string;
    key: string | null;
    params: Record<string, string | number>;
  } | null,
  t: ReturnType<typeof useT<"TeacherCopilot">>,
): string | null {
  if (!stage) return null;
  const key = stage.key
    ? STAGE_KEYS[stage.key as keyof typeof STAGE_KEYS]
    : undefined;
  return key ? t(key, stage.params) : stage.label;
}

function CopilotChat<P>({
  config,
  threadId,
  pendingAsk,
  onAskSent,
}: {
  config: TeacherCopilotConfig<P>;
  threadId: string;
  pendingAsk?: string | null;
  onAskSent?: () => void;
}) {
  const labels = useCopilotLabels(config.labels);
  const t = useT("TeacherCopilot");
  const {
    messages: liveMessages,
    toolCalls,
    sendMessage,
    isLoading,
    error,
    stage,
    thinkingContent,
  } = useSkillAgent();
  const elapsed = useElapsedSeconds(isLoading);
  const localeMode = useLocaleMode();
  const langTag = `[ui_language=${localeMode === "bilingual" ? "da" : localeMode}] `;
  // Prior turns for a resumed thread (empty for a fresh one — a 404 lands as
  // sessionGone, not an error). Prepend before the live turns; ids never clash
  // (history ids are `hist-*`, live ids are AG-UI message ids).
  const { initialMessages } = useSessionMessages(threadId || null);
  const messages = initialMessages.length
    ? [...initialMessages, ...liveMessages]
    : liveMessages;
  // AG-UI tool-call turns arrive as assistant messages with empty text content
  // (the proposal card stands in for them) — skip those so they don't render as
  // empty bubbles above the proposals.
  const visibleMessages = messages.filter(
    (m) => m.content && m.content.trim().length > 0,
  );
  const [input, setInput] = useState("");

  // Send a surface-asked question as a turn, once. Cleared BEFORE the await so
  // a re-render mid-flight cannot send it twice; a question that arrives while
  // the copilot is mid-turn waits for the next render rather than being
  // dropped, because `isLoading` is in the dependency list.
  useEffect(() => {
    if (!pendingAsk || isLoading) return;
    onAskSent?.();
    void sendMessage(`${langTag}${config.scopePrefix ?? ""}${pendingAsk}`);
    // `sendMessage` identity is not stable across renders; the guard above is
    // what makes this fire once, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, isLoading]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage(`${langTag}${config.scopePrefix ?? ""}${trimmed}`);
  };

  const parse = config.parseProposal;
  const proposals = parse
    ? toolCalls
        .map((tc) => ({ id: tc.id, proposal: parse(tc) }))
        .filter((p): p is { id: string; proposal: P } => p.proposal !== null)
    : [];

  const empty =
    visibleMessages.length === 0 && proposals.length === 0 && !isLoading;
  const surfaceStrip = config.stripPrefix ?? ((c: string) => c);
  const strip = (c: string) => surfaceStrip(c.replace(UI_LANGUAGE_TAG, ""));

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid={config.testId ?? "teacher-copilot"}
    >
      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
        aria-live="polite"
      >
        {empty ? (
          <p className="text-xs text-muted-foreground">{config.emptyText}</p>
        ) : null}
        {visibleMessages.map((m) => (
          <article
            key={m.id}
            data-role={m.role}
            className={
              m.role === "user"
                ? "ml-auto max-w-prose rounded border border-border bg-muted px-3 py-2 text-sm"
                : "max-w-prose rounded border border-border bg-background px-3 py-2 text-sm"
            }
          >
            {m.role === "user" ? (
              <p className="whitespace-pre-wrap">{strip(m.content)}</p>
            ) : (
              // Assistant turns are Markdown (bold, lists, links) — render them,
              // don't show the raw source. navigateToBlock is a no-op here (no
              // document-citation surface in the co-pilot panel).
              // A small model sometimes echoes the turn's language tag at the start
              // of its reply; it is plumbing, never content.
              <ChatMarkdown
                content={m.content.replace(UI_LANGUAGE_TAG, "")}
                navigateToBlock={() => {}}
              />
            )}
          </article>
        ))}
        {config.proposalDescriptor && config.onApplyProposal
          ? proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p.proposal}
                descriptor={config.proposalDescriptor!}
                onApply={config.onApplyProposal!}
                dismissOnApply={config.dismissOnApply}
                labels={config.labels}
              />
            ))
          : null}
        {isLoading ? (
          <div className="flex flex-col gap-1">
            <p
              data-testid="copilot-progress"
              className="text-xs text-muted-foreground"
            >
              {stageText(stage, t) ?? labels.thinking}
              {elapsed >= 5 ? (
                <span className="ml-1 tabular-nums">
                  · {formatElapsed(elapsed)}
                </span>
              ) : null}
            </p>
            {thinkingContent ? (
              // The model's streamed thought summaries (AG-UI REASONING), for skills
              // that opt in (the Sim workshop): what it is working on during a long
              // silent step. The latest lines only; a window, not a transcript.
              <p
                data-testid="copilot-thinking"
                className="max-h-24 overflow-hidden whitespace-pre-wrap border-l-2 border-border pl-2 text-xs italic text-muted-foreground"
              >
                {thinkingContent.slice(-400)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mx-3 mb-1 rounded border border-destructive bg-destructive/10 p-2 text-xs text-destructive"
        >
          {error.message}
        </div>
      ) : null}

      {config.helpLink ? (
        <div className="border-t border-border px-3 py-1.5 text-center">
          <a
            href={config.helpLink.href}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            {config.helpLink.label}
          </a>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className={`flex items-stretch gap-2 p-2 ${config.helpLink ? "" : "border-t border-border"}`}
      >
        <input
          type="text"
          aria-label={config.inputAriaLabel ?? config.placeholder}
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
          {t("send")}
        </button>
      </form>
    </div>
  );
}
