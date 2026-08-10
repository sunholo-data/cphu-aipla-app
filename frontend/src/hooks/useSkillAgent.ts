// Workshop W5d — AG-UI: Subscribing to the Stream
// The AG-UI subscription is the `agent.subscribe(...)` block: four callbacks map
// lifecycle events (RUN_STARTED, TEXT_MESSAGE_*, RUN_FINISHED) to React state.
// `sendMessage` is the full round-trip: add message → runAgent() → await. The
// subscription fires streaming updates while we wait. No polling, no EventSource.

"use client";

import type { Message } from "@ag-ui/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isProactiveSentinel } from "@/lib/proactiveSentinels";
import { useAGUIAgent } from "@/providers/AGUIProvider";
import { useOptionalSurfaceRegistry } from "@/providers/SurfaceRegistry";
import {
  recordFirstEvent,
  recordFirstStageLabel,
  recordFirstTextChunk,
  recordServerReport,
  startMark,
} from "@/stores/latencyStore";

export interface SkillMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 1.1.7 — inline image parts on a multimodal user turn. Sourced from the
   * native AG-UI `ImageInputContent` parts in the message content; rendered as
   * thumbnails in the user bubble. `data` is raw base64 (no data-URL prefix). */
  images?: { mimeType: string; data: string }[];
  /** Epoch seconds the turn was recorded (from the session store, for restored
   * history). Optional — live messages omit it and render at "now", which is
   * correct since they just arrived. Without it, restored history all showed
   * the current render time (every bubble's timestamp identical). */
  timestamp?: number;
}

/** Shape the AG-UI user-message content: plain string, or a multimodal
 * `InputContent[]` (text part + native `ImageInputContent` / `AudioInputContent`
 * parts) when the turn carries attachments. Mirrors ag_ui core's
 * `UserMessage.content` union — ag_ui_adk converts each part to an ADK
 * `Part(inline_data=…)`, so it lands in session history and is replayed natively:
 * images (1.1.7) and now **audio** (1.1.37 — the Gemini tutor hears the audio
 * directly; the parallel transcript is for the bubble + research log). The part
 * type is chosen from the attachment's MIME so audio turns and image turns share
 * one send path. */
export function buildUserMessageContent(
  text: string,
  attachments?: Array<{ mimeType: string; data: string; name?: string }>,
): string | Array<Record<string, unknown>> {
  if (!attachments || attachments.length === 0) return text;
  const parts: Array<Record<string, unknown>> = [];
  if (text) parts.push({ type: "text", text });
  for (const a of attachments) {
    const kind = a.mimeType.startsWith("audio/") ? "audio" : "image";
    parts.push({ type: kind, source: { type: "data", value: a.data, mimeType: a.mimeType } });
  }
  return parts;
}

export interface StreamError {
  kind: "http" | "run_error" | "network" | "budget_exceeded";
  status?: number;
  message: string;
  retryable: boolean;
  rawMessage: string;
  /**
   * Seconds until budget recovery (period rollover). Present only on
   * ``kind === "budget_exceeded"`` — backend pulls this off the
   * BudgetDecision and rides it as a passthrough field on the AG-UI
   * RUN_ERROR event. The BudgetBanner renders a live countdown.
   */
  retryAfterSeconds?: number;
}

/** A `HISTORY_COMPACTED` CUSTOM event: earlier turns were summarised away so
 * the conversation stays within the model's context limit. METADATA ONLY —
 * the backend never puts summary text on the wire, because a summary derives
 * from student conversation content. */
export interface CompactionNoticeItem {
  id: string;
  ts: number;
  eventsCompacted: number;
  summaryChars: number;
}

export interface ToolCallState {
  id: string;
  name: string;
  status: "running" | "success" | "error";
  parentMessageId?: string;
  resultContent?: string;
  /** Concatenated TOOL_CALL_ARGS deltas (the agent's tool input as a JSON
   * string). Set as soon as the first ARGS chunk arrives; appended on
   * subsequent chunks; stable by TOOL_CALL_END. Consumers (e.g. the MCP
   * App router for AppRenderer.toolInput) JSON.parse it themselves. */
  argsJson?: string;
}

export interface UseSkillAgentReturn {
  /** The HttpAgent's threadId — equal to the backend ChatSessionIndex id. */
  sessionId: string;
  messages: SkillMessage[];
  toolCalls: ToolCallState[];
  thinkingContent: string;
  isThinking: boolean;
  /**
   * Latest server-authored stage label ("Reading 2 documents…",
   * "Thinking…", "Calling search…") delivered via AG-UI STAGE_PROGRESS
   * Custom events from the backend LatencyTracker. Null between runs
   * and after the first model token has landed (the streaming bubble
   * takes over the UX). Decouples perceived TTFT from real TTFT —
   * see docs/design/v6.1.0/ttft-instrumentation.md.
   */
  stageLabel: string | null;
  sendMessage: (
    text: string,
    opts?: {
      documentIds?: string[];
      resumedSession?: boolean;
      attachments?: Array<{ mimeType: string; data: string; name?: string }>;
    },
  ) => Promise<void>;
  isLoading: boolean;
  /** COMPACTION-LATENCY M2 — a compaction is running AFTER the answer
   * finished. The turn's output is complete; only housekeeping remains, so
   * the composer is re-enabled and this drives a quiet notice instead of the
   * typing indicator. */
  tidyingUp: boolean;
  /** History compactions this conversation. Compaction silently rewrites what
   * the tutor can remember — the student keeps seeing the full transcript
   * while the model sees a summary — so it must be visible. */
  compactions: CompactionNoticeItem[];
  error: StreamError | null;
  clearError: () => void;
  stop: () => void;
}

function toSkillMessage(m: Message): SkillMessage | null {
  const role = (m as { role?: string }).role;
  if (!role || !["user", "assistant"].includes(role)) return null;
  const content = (m as { content?: unknown }).content;
  if (typeof content === "string") {
    // Sprint PROACTIVE-SIM-REACTIVE M8: drop synthetic proactive-trigger
    // sentinels from the rendered list. Without this, Path B's
    // sim-reactive trigger ([event_reactive:<kind>]) would render as a
    // student chat bubble because the FE addMessage() that kicks off
    // the AG-UI run puts the sentinel directly into agent.messages.
    // Phase A is server-driven so its [session_start] sentinel never
    // entered the FE message list — but covering both kinds here is
    // belt-and-braces for the eventual Phase A refactor onto Path B.
    if (role === "user" && isProactiveSentinel(content)) {
      return null;
    }
    return { id: m.id, role: role as SkillMessage["role"], content };
  }
  // 1.1.7 multimodal user turn — content is a native AG-UI InputContent[]
  // array (text parts + ImageInputContent parts). Flatten text for the
  // bubble body and surface image parts as thumbnails.
  if (Array.isArray(content)) {
    const texts: string[] = [];
    const images: { mimeType: string; data: string }[] = [];
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const p = part as { type?: string; text?: unknown; source?: Record<string, unknown> };
      if (p.type === "text" && typeof p.text === "string") {
        texts.push(p.text);
      } else if (p.type === "image" && p.source && p.source.type === "data") {
        const value = p.source.value;
        if (typeof value === "string") {
          const mime = (p.source.mimeType ?? p.source.mime_type) as string | undefined;
          images.push({ mimeType: mime || "image/jpeg", data: value });
        }
      }
    }
    const joined = texts.join("\n");
    if (role === "user" && isProactiveSentinel(joined)) return null;
    return {
      id: m.id,
      role: role as SkillMessage["role"],
      content: joined,
      images: images.length > 0 ? images : undefined,
    };
  }
  // Tool-only assistant turns (Gemini sometimes emits send_a2ui_json_to_client
  // with no text in chat). AG-UI sets content to undefined; without a
  // SkillMessage, the MessageBubble never renders and its tool-call
  // dispatchers never fire — so the workspace surface stays empty.
  // Render the bubble with empty text; tool calls render via their own slots.
  if (role === "assistant") {
    return { id: m.id, role: "assistant", content: "" };
  }
  return null;
}

function classifyError(err: unknown): StreamError {
  const msg = err instanceof Error ? err.message : String(err);
  const httpMatch = msg.match(/HTTP (\d+)/);
  if (httpMatch) {
    const status = parseInt(httpMatch[1]);
    if (status === 401)
      return { kind: "http", status, message: "Session expired — please refresh the page", retryable: false, rawMessage: msg };
    if (status === 404)
      return { kind: "http", status, message: "Skill not found", retryable: false, rawMessage: msg };
    if (status === 502)
      return { kind: "http", status, message: "Can't reach the server. Try again.", retryable: true, rawMessage: msg };
    if (status >= 500)
      return { kind: "http", status, message: "Something went wrong on our end. Try again.", retryable: true, rawMessage: msg };
    return { kind: "http", status, message: "Request failed. Try again.", retryable: true, rawMessage: msg };
  }
  return { kind: "network", message: "Connection lost. Try again.", retryable: true, rawMessage: msg };
}

function classifyRunError(event: unknown): StreamError {
  const msg =
    event && typeof event === "object" && "message" in event
      ? String((event as { message: unknown }).message)
      : "Agent run failed";
  // Sprint 2.12 — typed budget-exceeded branch. The backend's
  // skill_processor catches BudgetExceededError and emits a RUN_ERROR
  // with code="BUDGET_EXCEEDED" + the BudgetDecision's message +
  // retry_after_seconds as a passthrough field. The BudgetBanner
  // component renders the typed branch as a countdown banner instead
  // of the generic "Something went wrong" fallback.
  if (event && typeof event === "object" && "code" in event &&
      (event as { code: unknown }).code === "BUDGET_EXCEEDED") {
    const rawRetry = (event as { retry_after_seconds?: unknown }).retry_after_seconds;
    const retryAfterSeconds = typeof rawRetry === "number" ? rawRetry : undefined;
    return {
      kind: "budget_exceeded",
      message: msg,
      retryable: retryAfterSeconds !== undefined,
      rawMessage: msg,
      retryAfterSeconds,
    };
  }
  return { kind: "run_error", message: "The agent encountered an error. Try again.", retryable: true, rawMessage: msg };
}

/**
 * Subscribe to the AG-UI `HttpAgent` from `AGUIProvider` and expose a
 * chat-shaped API. Streaming text deltas land via `onTextMessageContentEvent`;
 * `onRunFinalized` flips `isLoading` off.
 *
 * We mirror `agent.messages` to React state on every change so consumers see
 * fresh renders. The agent keeps the canonical list; we just copy it.
 */
export function useSkillAgent(options?: { _hangTimeoutMs?: number; activityId?: string }): UseSkillAgentReturn {
  const hangTimeoutMs = options?._hangTimeoutMs ?? 30_000;
  // ALS-1 M0: the specific activity this chat runs (an act- id from the lesson
  // card). Rides every send on forwardedProps.activity_id so the backend injects
  // THIS activity's teacher-focus. Absent (teacher chats / direct skill links) →
  // the backend falls back to the skill id, so behaviour is unchanged.
  const activityId = options?.activityId;
  const agent = useAGUIAgent();
  // Sprint 2.10: read every active A2UI surface's snapshot at sendMessage
  // time and ride it back on `forwardedProps.a2ui_surface_state`. Optional
  // because useSkillAgent is also used in surface-registry-less contexts
  // (some tests, isolated embeds).
  const surfaceRegistry = useOptionalSurfaceRegistry();
  const [messages, setMessages] = useState<SkillMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallState[]>([]);
  const [thinkingContent, setThinkingContent] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [runStarted, setRunStarted] = useState(false);
  const [error, setError] = useState<StreamError | null>(null);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [tidyingUp, setTidyingUp] = useState(false);
  const [compactions, setCompactions] = useState<CompactionNoticeItem[]>([]);
  const compactionSeqRef = useRef(0);

  const clearError = useCallback(() => setError(null), []);

  // Set to true by onRunFailed so the sendMessage catch block doesn't overwrite
  // the real run_error with a spurious "protocol violation" network error.
  // The backend sometimes emits RUN_FINISHED after RUN_ERROR; AG-UI's state
  // machine throws on that sequence, but the error is already handled.
  const runFailedRef = useRef(false);

  // Snapshot of agent.messages.length taken at RUN_STARTED. Used by
  // onToolCallStartEvent to scope the assistant-text-message search to the
  // current run only — messages before this index belong to prior turns and
  // must not capture new tool calls (each turn's tools should land in that
  // turn's bubble via back-attribution at TEXT_MESSAGE_START).
  const runStartMessageCountRef = useRef<number>(0);

  // Track the agent instance so we re-subscribe when AGUIProvider rebuilds it
  // (e.g. after the Firebase ID token refreshes).
  const lastAgentRef = useRef(agent);

  useEffect(() => {
    // chat-history-deep-fixes v6.1.0: track whether `agent` is the same
    // reference as the previous render. F1's monotonic guard must yield
    // on agent-identity changes (AGUIProvider rebuild after URL writeback,
    // "+ New conversation", thread select) so the message list correctly
    // resets to the new agent's state. Without this, the OLD agent's
    // messages stay pinned in the UI and the user sees stale or empty
    // chats — exactly Bugs A, B, and C from chat-history-deep-fixes.md.
    const agentChanged = lastAgentRef.current !== agent;
    lastAgentRef.current = agent;

    // Compaction markers are per-conversation. Without this reset, a new chat
    // would show "History summarised" from the PREVIOUS thread — worse than no
    // marker: it implies context was lost when none was.
    if (agentChanged) {
      setCompactions([]);
      setTidyingUp(false);
    }

    const sync = (allowReset = false) => {
      const next = agent.messages
        .map(toSkillMessage)
        .filter((m): m is SkillMessage => m !== null);
      // F1 (chat-history-fixes v6.1.0): never shrink the rendered list
      // *while the agent is the same instance* — AG-UI's HttpAgent state
      // machine resets its internal `messages` array on certain
      // protocol-violation paths (e.g. RUN_FINISHED arriving after
      // RUN_ERROR), and we don't want those stutters to wipe the UI.
      // But when the agent itself was replaced, the shrink is legitimate
      // (new conversation, new session, token refresh) — yield then.
      setMessages((prev) => {
        if (!allowReset && next.length < prev.length) {
          console.warn(
            "useSkillAgent: agent.messages shrunk from",
            prev.length,
            "to",
            next.length,
            "— holding previous list (AG-UI protocol stutter, F1 guard).",
          );
          return prev;
        }
        return next;
      });
    };
    // First sync after agent change must allow a reset to the new
    // agent's (possibly empty) message list.
    sync(agentChanged);

    const sub = agent.subscribe({
      onMessagesChanged: () => sync(),
      onRunStartedEvent: () => {
        setIsLoading(true);
        setRunStarted(true);
        // Preserve completed tool calls from prior turns so their iframes
        // survive into the next turn. Only drop orphaned "running" entries
        // left over from an aborted previous run.
        setToolCalls((prev) => prev.filter((tc) => tc.status !== "running"));
        setThinkingContent("");
        setIsThinking(false);
        runStartMessageCountRef.current = agent.messages.length;
        recordFirstEvent(performance.now());
        // Don't reset stageLabel here — STAGE_PROGRESS for
        // before_agent_done/before_model_done can arrive *before*
        // RUN_STARTED on a slow loader, and we want the label to
        // survive the handshake so the user keeps seeing progress.
      },
      onCustomEvent: ({ event }: { event: { name?: unknown; value?: unknown } }) => {
        // Two server-authored Custom event types of interest:
        //   STAGE_PROGRESS  — per-stage label for the TypingIndicator
        //   LATENCY_REPORT  — final per-stage timings (only when ?probe=1)
        // Backend definitions in observability/timing.py.
        if (event.name === "STAGE_PROGRESS") {
          const value = event.value as { label?: unknown } | null | undefined;
          if (!value || typeof value.label !== "string") return;
          setStageLabel(value.label);
          recordFirstStageLabel(performance.now());
          return;
        }
        if (event.name === "LATENCY_REPORT" && event.value && typeof event.value === "object") {
          recordServerReport(event.value as Record<string, unknown>);
          return;
        }
        // COMPACTION_STARTED — the answer is COMPLETE and a history compaction
        // is now running. Upstream measured ~37s median (max 47s) during which
        // the answer was already fully rendered while the composer sat disabled
        // and the typing indicator spun. Release the student here: the run has
        // not finished, but their turn has.
        //
        // HISTORY_COMPACTED can't do this job — it fires when summarisation
        // RETURNS, i.e. tens of seconds later, at roughly the same moment as
        // RUN_FINISHED.
        if (event.name === "COMPACTION_STARTED") {
          setIsLoading(false);
          setStageLabel(null);
          setTidyingUp(true);
          return;
        }
        // HISTORY_COMPACTED — earlier turns were summarised away to stay
        // within the context limit. Surfaced because the student still sees
        // the FULL transcript while the tutor now sees a summary; without a
        // marker a degraded answer is indistinguishable from a good one.
        if (event.name === "HISTORY_COMPACTED") {
          const v = (event.value ?? {}) as { events_compacted?: unknown; summary_chars?: unknown };
          compactionSeqRef.current += 1;
          setCompactions((prev) => [
            ...prev,
            {
              id: `compaction-${compactionSeqRef.current}`,
              ts: Date.now(),
              eventsCompacted: typeof v.events_compacted === "number" ? v.events_compacted : 0,
              summaryChars: typeof v.summary_chars === "number" ? v.summary_chars : 0,
            },
          ]);
          setTidyingUp(false);
          return;
        }
      },
      onTextMessageStartEvent: ({ event }: { event: { messageId?: string } }) => {
        // First model token reached the wire — clear the stage label so
        // the UI handoff (TypingIndicator → StreamingBubble) is clean.
        setStageLabel(null);
        recordFirstTextChunk(performance.now());
        // F2a fix (part 2): back-attribute any tool calls whose parentMessageId
        // was deferred (tools-before-text ADK pattern). TOOL_CALL_START fires
        // before TEXT_MESSAGE_START, so the fallback snapshot in
        // onToolCallStartEvent can only find a text-content assistant message if
        // one already exists from a prior turn. For tool calls in the current
        // turn (where no prior text message existed at TOOL_CALL_START time),
        // parentMessageId is undefined — fix it now that we have the real id.
        const msgId = event.messageId;
        if (msgId) {
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.parentMessageId === undefined ? { ...tc, parentMessageId: msgId } : tc,
            ),
          );
        }
      },
      onReasoningStartEvent: () => {
        setThinkingContent("");
        setIsThinking(true);
      },
      onReasoningMessageContentEvent: ({ reasoningMessageBuffer }: { reasoningMessageBuffer: string }) => {
        setThinkingContent(reasoningMessageBuffer);
      },
      onReasoningEndEvent: () => {
        setIsThinking(false);
      },
      onRunFinalized: () => {
        setIsLoading(false);
        setRunStarted(false);
        setStageLabel(null);
        setTidyingUp(false);
        // Resolve any still-running tool calls as success on clean finish
        setToolCalls((prev) =>
          prev.map((tc) => tc.status === "running" ? { ...tc, status: "success" } : tc),
        );
      },
      onRunFailed: (event: unknown) => {
        runFailedRef.current = true;
        const streamErr = classifyRunError(event);
        console.warn("stream_run_failed", streamErr);
        setError(streamErr);
        setIsLoading(false);
        setRunStarted(false);
        setStageLabel(null);
        setTidyingUp(false);
        setToolCalls((prev) =>
          prev.map((tc) => tc.status === "running" ? { ...tc, status: "error" } : tc),
        );
      },
      onToolCallStartEvent: ({ event }: { event: { toolCallId: string; toolCallName: string; parentMessageId?: string } }) => {
        // F2a (2026-05-01): ADK doesn't emit parentMessageId on AG-UI
        // TOOL_CALL_START events. Without snapshotting at start time, every
        // unparented tool call inherits "latest assistant at render time" via
        // ChatMessageList's lastAssistantId fallback — so when turn 2 finalises,
        // turn 1's tool calls jump to turn 2's bubble and turn 1 loses its
        // iframe.
        // Scope to (a) string-content messages only — tool-call messages have
        // content:[] not a string — AND (b) messages added in the current run
        // (sliced at runStartMessageCountRef). Without the run-scope, prior
        // turns' text messages would capture this turn's tool calls.
        // When no current-run text message exists yet (ADK tools-before-text
        // pattern) the snapshot returns undefined; onTextMessageStartEvent
        // back-attributes all undefined-parent tool calls to the real id.
        const currentRunMessages = agent.messages.slice(runStartMessageCountRef.current);
        const fallbackParentId =
          event.parentMessageId ??
          [...currentRunMessages]
            .reverse()
            .find((m) => {
              const role = (m as { role?: string }).role;
              const content = (m as { content?: unknown }).content;
              return role === "assistant" && typeof content === "string";
            })?.id;
        setToolCalls((prev) => [
          ...prev,
          {
            id: event.toolCallId,
            name: event.toolCallName,
            status: "running",
            parentMessageId: fallbackParentId,
          },
        ]);
      },
      onToolCallArgsEvent: ({ event }: { event: { toolCallId: string; delta: string } }) => {
        // AG-UI emits ARGS as streaming deltas — concatenate into argsJson
        // so the final string is the complete JSON-encoded tool input by
        // the time TOOL_CALL_END fires. Consumers parse on read.
        setToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === event.toolCallId
              ? { ...tc, argsJson: (tc.argsJson ?? "") + event.delta }
              : tc,
          ),
        );
      },
      onToolCallEndEvent: ({ event }: { event: { toolCallId: string } }) => {
        setToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === event.toolCallId ? { ...tc, status: "success" } : tc,
          ),
        );
      },
      onToolCallResultEvent: ({ event }: { event: { toolCallId: string; content: string } }) => {
        setToolCalls((prev) =>
          prev.map((tc) =>
            tc.id === event.toolCallId ? { ...tc, resultContent: event.content } : tc,
          ),
        );
      },
    });
    return () => sub.unsubscribe();
  }, [agent]);

  // 30s watchdog: if loading starts but RUN_STARTED never fires, abort and surface error.
  useEffect(() => {
    if (!isLoading || runStarted) return;
    const timer = setTimeout(() => {
      agent.abortRun();
      setError({ kind: "network", message: "Connection lost. Try again.", retryable: true, rawMessage: "stream_hang_timeout_30s" });
      setIsLoading(false);
    }, hangTimeoutMs);
    return () => clearTimeout(timer);
  }, [isLoading, runStarted, agent, hangTimeoutMs]);

  const sendMessage = useCallback(
    async (
      text: string,
      opts?: {
        documentIds?: string[];
        resumedSession?: boolean;
        attachments?: Array<{ mimeType: string; data: string; name?: string }>;
      },
    ) => {
      clearError();
      setRunStarted(false);
      setStageLabel(null);
      setTidyingUp(false);
      runFailedRef.current = false;
      // 1.1.11 follow-up — when the student takes action (typing AND
      // sending), stop any in-flight auto-read. The previous assistant
      // turn's voice shouldn't keep playing into the new exchange.
      // ReadAloudButton instances listen for this event and cancel
      // their playback. Same channel the LangToggle uses.
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("aipla:voice.cancel"));
      }
      const userMessageId = crypto.randomUUID();
      // Latency mark t_send: anchored before agent.addMessage so
      // perceived TTFT (t_send → first DOM paint) measures the full
      // submit→render cycle, not just the network call. The HUD reads
      // these marks via the latencyStore.
      startMark(agent.threadId, userMessageId, performance.now());
      agent.addMessage({
        id: userMessageId,
        role: "user",
        // 1.1.7: when images are staged, content is a native AG-UI
        // multimodal InputContent[] (text + ImageInputContent parts) rather
        // than a string. ag_ui_adk converts the image parts to ADK Parts that
        // persist in session history — retained + replayed every turn, no
        // side-channel, no custom injector.
        content: buildUserMessageContent(text, opts?.attachments),
      } as Message);
      setIsLoading(true);
      try {
        const forwardedProps: Record<string, unknown> = {};
        if (opts?.documentIds && opts.documentIds.length > 0) {
          forwardedProps.document_ids = opts.documentIds;
        }
        if (opts?.resumedSession) {
          forwardedProps.resumed_session = true;
        }
        // ALS-1 M0: select THIS activity's teacher-focus on the backend. Only an
        // act- id is meaningful (a skill id == the legacy welding the backend
        // already falls back to), so omit it otherwise to keep the wire clean.
        if (activityId && activityId.startsWith("act-")) {
          forwardedProps.activity_id = activityId;
        }
        // 1.1.7 images do NOT ride forwardedProps — they're native AG-UI
        // ImageInputContent parts in the message content (see addMessage
        // above), so ADK persists + replays them. Nothing to add here.
        // Sprint 2.10: attach per-turn A2UI surface snapshot when any
        // surface is active. Omit the slot entirely when empty so the
        // wire stays clean and the backend extractor's `if isinstance
        // and raw` short-circuits without work.
        const surfaceSnapshot = surfaceRegistry?.readA2uiSurfaceState();
        if (surfaceSnapshot && Object.keys(surfaceSnapshot).length > 0) {
          forwardedProps.a2ui_surface_state = surfaceSnapshot;
        }
        const runInput = Object.keys(forwardedProps).length > 0
          ? { forwardedProps }
          : undefined;
        await agent.runAgent(runInput);
      } catch (err) {
        // If onRunFailed already fired, the real error is already set — don't
        // overwrite it with the AG-UI state-machine protocol exception that
        // the backend triggers by emitting RUN_FINISHED after RUN_ERROR.
        if (!runFailedRef.current) {
          const streamErr = classifyError(err);
          console.warn("stream_error", streamErr);
          setError(streamErr);
        }
      } finally {
        setIsLoading(false);
        setRunStarted(false);
      }
    },
    [agent, clearError, surfaceRegistry, activityId],
  );

  const stop = useCallback(() => {
    agent.abortRun();
  }, [agent]);

  return {
    sessionId: agent.threadId,
    messages,
    toolCalls,
    thinkingContent,
    isThinking,
    stageLabel,
    sendMessage,
    isLoading,
    tidyingUp,
    compactions,
    error,
    clearError,
    stop,
  };
}
