"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Send, Sparkles, SquarePen } from "lucide-react";

import { AGUIProvider } from "@/providers/AGUIProvider";
import { useSkillAgent } from "@/hooks/useSkillAgent";
import { useSkillSlugResolver } from "@/hooks/useSkillSlugResolver";
import { useSessionMessages } from "@/hooks/useSessionMessages";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { fetchWithTeacherAuth } from "@/lib/apiClient";

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
  // Whether a turn is running, for the docked panel's phone launcher.
  const [busy, setBusy] = useState(false);

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
      <DockedCopilot title={config.title} onNewChat={newChat} busy={busy}>
        <CopilotResolver
          config={config}
          threadId={threadId}
          pendingAsk={pendingAsk}
          onAskSent={() => setPendingAsk(null)}
          onBusyChange={setBusy}
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

/**
 * The co-pilot as a page column (same header and chat as the floating panel).
 *
 * Below `lg` a column under the page put the chat a long scroll down, its input
 * under the phone's bottom bar, scrolling inside a scrolling page. There it is a
 * launcher instead, opening the chat as a full-screen sheet. The chat stays
 * MOUNTED while the sheet is closed (hidden, not unmounted), so a build keeps
 * streaming while the teacher looks at the sim.
 */
function DockedCopilot({
  title,
  onNewChat,
  busy,
  children,
}: {
  title: string;
  onNewChat: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const t = useT("FloatingCopilot");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="docked-copilot-launcher"
        className={`${open ? "hidden" : "flex"} w-full items-center justify-between gap-3 rounded border border-border bg-background px-3 py-3 text-left text-sm shadow-sm lg:hidden`}
      >
        <span className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </span>
        <span
          className={`shrink-0 text-xs ${busy ? "animate-pulse text-foreground" : "text-muted-foreground"}`}
        >
          {busy ? t("working") : t("openChat")}
        </span>
      </button>
    <section
      aria-label={title}
      data-testid="docked-copilot"
      className={`${open ? "fixed inset-0 z-50 flex h-dvh" : "hidden"} flex-col overflow-hidden bg-background lg:static lg:z-auto lg:flex lg:h-[min(80vh,760px)] lg:min-h-[420px] lg:rounded lg:border lg:border-border`}
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles
            className="h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />{" "}
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onNewChat}
            aria-label={t("newChat")}
            className="rounded p-2 text-muted-foreground hover:bg-muted lg:p-1"
          >
            <SquarePen className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t("backToPage")}
            data-testid="docked-copilot-close"
            className="rounded p-2 text-muted-foreground hover:bg-muted lg:hidden"
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>
      {children}
    </section>
    </>
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
  onBusyChange,
}: {
  config: TeacherCopilotConfig<P>;
  threadId: string;
  pendingAsk?: string | null;
  onAskSent?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { skillId, resolveError } = useSkillSlugResolver(config.skillName);
  const labels = useCopilotLabels(config.labels);
  // Bumped to remount the chat, which reloads the conversation from the server
  // (after a dropped stream, once the run it lost has finished).
  const [reloadSeq, setReloadSeq] = useState(0);
  const reload = useCallback(() => setReloadSeq((n) => n + 1), []);

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
      key={`${skillId}:${reloadSeq}`}
      skillId={skillId}
      sessionId={threadId || undefined}
      useTeacherAuth
    >
      <CopilotChat
        config={config}
        threadId={threadId}
        pendingAsk={pendingAsk}
        onAskSent={onAskSent}
        onBusyChange={onBusyChange}
        onReload={reload}
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

/** How long the page must have been hidden mid-turn before the stream is
 *  presumed dead: iOS suspends a backgrounded tab and its fetch with it. */
const HIDDEN_DROP_MS = 10_000;
const RUN_POLL_MS = 4000;

/**
 * Keep a scrolling list pinned to its newest line while the reader is at the
 * bottom; leave it alone once they scroll up to read back. Pinned on mount, so
 * a reopened conversation opens at its end.
 */
function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement | null>(null);
  const pinned = useRef(true);
  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return { ref, onScroll };
}

/**
 * After a dropped stream: ask the server whether the turn is still running
 * (protocols/detached_runs.py: a teacher's turn finishes without its client),
 * and call `onDone` once it is not, so the conversation can be reloaded.
 */
function useWaitForRun(
  threadId: string,
  watching: boolean,
  onDone: (() => void) | undefined,
) {
  useEffect(() => {
    if (!watching || !threadId) return;
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const res = await fetchWithTeacherAuth(
          `/api/proxy/api/skill-runs/${encodeURIComponent(threadId)}`,
        );
        const body = res.ok ? ((await res.json()) as { running?: boolean }) : {};
        if (cancelled) return;
        if (body.running) {
          timer = window.setTimeout(check, RUN_POLL_MS);
          return;
        }
        onDone?.();
      } catch {
        // Still offline (the phone is waking up): ask again shortly.
        if (!cancelled) timer = window.setTimeout(check, RUN_POLL_MS);
      }
    };
    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [threadId, watching, onDone]);
}

function CopilotChat<P>({
  config,
  threadId,
  pendingAsk,
  onAskSent,
  onBusyChange,
  onReload,
}: {
  config: TeacherCopilotConfig<P>;
  threadId: string;
  pendingAsk?: string | null;
  onAskSent?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onReload?: () => void;
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
    stop,
    turnRefused,
    clearTurnRefused,
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

  useEffect(() => {
    onBusyChange?.(isLoading);
  }, [isLoading, onBusyChange]);

  // A phone drops the stream when its screen locks or the browser goes to the
  // background; the turn carries on on the server. Rather than "Connection
  // lost. Try again." (which would start a second build), wait for the run to
  // finish and reload the conversation, which then holds the whole turn.
  const [watching, setWatching] = useState(false);
  const [resendHint, setResendHint] = useState(false);
  useEffect(() => {
    if (error?.kind === "network") setWatching(true);
  }, [error]);
  const loadingRef = useRef(isLoading);
  loadingRef.current = isLoading;
  useEffect(() => {
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      // The suspended fetch may never settle by itself: let it go.
      if (away >= HIDDEN_DROP_MS && loadingRef.current) {
        setWatching(true);
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);
  // A send refused because the last turn is still running (HTTP 409): put the
  // text back in the box and wait with the teacher.
  useEffect(() => {
    if (!turnRefused) return;
    clearTurnRefused();
    setInput(
      (config.stripPrefix ?? ((c: string) => c))(
        turnRefused.replace(UI_LANGUAGE_TAG, ""),
      ),
    );
    setResendHint(true);
    setWatching(true);
  }, [turnRefused, clearTurnRefused, config.stripPrefix]);
  useWaitForRun(threadId, watching, onReload);

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
  const scroller = useStickToBottom(
    `${visibleMessages.length}:${visibleMessages[visibleMessages.length - 1]?.content.length ?? 0}:${proposals.length}:${isLoading}:${thinkingContent?.length ?? 0}:${watching}`,
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid={config.testId ?? "teacher-copilot"}
    >
      <div
        ref={scroller.ref}
        onScroll={scroller.onScroll}
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3"
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

      {watching ? (
        <div
          role="status"
          data-testid="copilot-still-working"
          className="mx-3 mb-1 flex flex-col gap-1 rounded border border-border bg-muted/60 p-2 text-xs text-muted-foreground"
        >
          <span className="animate-pulse">{t("stillWorking")}</span>
          {resendHint ? <span>{t("resendHint")}</span> : null}
        </div>
      ) : error ? (
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
        className={`flex items-stretch gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${config.helpLink ? "" : "border-t border-border"}`}
      >
        <input
          type="text"
          aria-label={config.inputAriaLabel ?? config.placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          placeholder={config.placeholder}
          // 16px on phones: iOS zooms the whole page into any smaller input on
          // focus, and the zoomed page no longer fits or scrolls properly.
          className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-base sm:text-sm"
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
