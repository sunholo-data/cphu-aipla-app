// Workshop W5b — AG-UI: text events → chat bubbles
// Each finalised TEXT_MESSAGE_END produces one immutable MessageBubble. The bubble
// is keyed by message.id (AG-UI messageId) so React never re-renders stable messages
// when a new streaming token arrives elsewhere.
// Bot path:  ChatMarkdown for text | TOOL_CALL_END routes to A2UIRenderer / MCPAppToolCallRouter / ToolCallChip
// User path: plain <p>
// A2UI arrives via TOOL_CALL_* events (send_a2ui_json_to_client tool) — not fenced blocks.
// MCP App UI surfaces are decided by the router from the tool DEFINITION's
// _meta.ui block (UI-by-reference), not the tool result text.
// See: docs/talks/workshop.md §W6c, docs/design/v6.1.0/a2ui-tool-delivery.md
// See: docs/design/v6.1.0/mcp-app-integrations.md

"use client";

import React, { useEffect } from "react";
import { A2UIRenderer } from "@/components/protocols/A2UIRenderer";
import { MCPAppToolCallRouter } from "@/components/protocols/MCPAppToolCallRouter";
import { BrandAvatar } from "@/components/chat/BrandAvatar";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { ZoomableImage } from "@/components/chat/media/ZoomableImage";
import { InlineCitation } from "@/components/chat/InlineCitation";
import { ReadAloudButton } from "@/components/chat/ReadAloudButton";
import { formatRelativeTime, formatAbsoluteTime } from "@/lib/relativeTime";
import { useAutoReadAloud } from "@/hooks/useAutoReadAloud";
import { useVoiceConfig } from "@/hooks/useVoiceConfig";
import { useVoiceLang } from "@/hooks/useVoiceLang";
import { ToolCallChip } from "@/components/chat/ToolCallChip";
import { CheckpointCard, parseCheckpointResult } from "@/components/chat/CheckpointCard";
import { useSurfaceRegistry } from "@/providers/SurfaceRegistry";
import type { SkillMessage, ToolCallState } from "@/hooks/useSkillAgent";

/** A persona resolved for the running activity (1.1.12). When present the bot
 *  bubble shows the persona's avatar + name instead of the skill byline. */
export interface PersonaSummary {
  id: string;
  name: string;
  title: string | null;
  avatar: string;
}

interface MessageBubbleProps {
  message: SkillMessage;
  skillId: string;
  /** Optional human-readable label shown as the bubble byline. Falls
   * back to `skillId` itself when omitted. See ChatMessageList docstring
   * for the rationale (1.1.11). */
  skillDisplayName?: string;
  /** Persona (1.1.12) for this activity — avatar + name override the byline. */
  persona?: PersonaSummary | null;
  userInitial: string;
  userDisplayName: string;
  toolCalls: ToolCallState[];
  navigateToBlock: (docId: string, blockId: string) => void;
  onAction: (event: { actionName: string; context: Record<string, unknown> }) => void;
  /** MCP server IDs configured for this skill — passed to the
   * MCPAppToolCallRouter so it can attribute tool calls to the right
   * server and decide whether they have a UI surface. Optional / empty
   * by default; until the chat page wires actual server IDs the router
   * is a no-op for everyone. */
  mcpServerIds?: readonly string[];
  /** Active iframe -> host bridge: chat strings produced by guest
   * notifications flow here. The chat page wires this to
   * useSkillAgent.sendMessage. */
  onChatMessage?: (text: string) => void;
  /** Current chat session id — threaded to MCPAppToolCallRouter so
   * iframe `ui/update-model-context` pushes can POST to
   * /api/proxy/api/sessions/{id}/iframe-context (sprint 1.25). */
  sessionId?: string | null;
  /** BCP-47 language for the tutor TTS button (sprint 1.H-TTS). The
   * skill's configured language flows in from the chat page; defaults
   * to `"da"` because the LOCAL_MODE demo skill (problem-set-hints)
   * is Danish stx. Has no effect on non-assistant turns. */
  ttsLang?: string;
  /** Auto-read (1.1.11): when auto-read is ON, ONLY the message the parent
   *  designates as the latest assistant turn self-speaks on mount — never the
   *  whole restored history at once. The parent (ChatMessageList) sets this
   *  true for exactly one bubble. Defaults false so a bubble never
   *  spontaneously speaks unless explicitly designated. */
  autoSpeakAllowed?: boolean;
}

/**
 * Parse the `send_a2ui_json_to_client` tool result envelope produced by
 * `backend/adk/a2ui.py::SurfaceAwareA2uiToolset`. The envelope shape is:
 *
 *   {
 *     "validated_a2ui_json": A2uiMessage[],  // v0.9 message array (createSurface | updateComponents | updateDataModel | deleteSurface)
 *     "surface_id":  "chat" | "workspace" | "sidebar" | "modal" | <custom>,  // optional
 *     "update_mode": "replace" | "patch",                                     // optional, surface routing hint (advisory)
 *   }
 *
 * `validated_a2ui_json` is whatever the SDK validator accepted. We don't
 * inspect message contents here — the SDK has already done structural
 * validation; downstream consumers feed the array to a v0.9 MessageProcessor.
 *
 * Returns `null` when the result is missing/malformed.
 */
export interface ParsedA2UIResult {
  messages: Record<string, unknown>[];
  surfaceId: string | undefined;
  updateMode: "replace" | "patch" | undefined;
}

export function parseA2UIResult(
  resultContent: string | undefined,
): ParsedA2UIResult | null {
  if (!resultContent) return null;
  try {
    const parsed = JSON.parse(resultContent) as Record<string, unknown>;
    const raw = parsed.validated_a2ui_json;
    if (raw === undefined || raw === null) return null;
    // SDK's parse_and_fix wraps a single message in a list before validation,
    // so we expect an array here. Accept a bare object defensively (treat as
    // a one-message array) so older envelopes don't crash the chat.
    const messages = Array.isArray(raw)
      ? (raw as Record<string, unknown>[])
      : [raw as Record<string, unknown>];
    if (messages.length === 0) return null;
    const surfaceId =
      typeof parsed.surface_id === "string" ? parsed.surface_id : undefined;
    const updateMode =
      parsed.update_mode === "patch" || parsed.update_mode === "replace"
        ? parsed.update_mode
        : undefined;
    return { messages, surfaceId, updateMode };
  } catch {
    return null;
  }
}


function PersonaBubbleAvatar({ persona }: { persona: PersonaSummary }) {
  if (persona.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={persona.avatar}
        alt={persona.name}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700"
    >
      {persona.name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export const MessageBubble = React.memo(function MessageBubble({
  message,
  skillId,
  skillDisplayName,
  persona,
  userInitial,
  userDisplayName,
  toolCalls,
  navigateToBlock,
  onAction,
  mcpServerIds,
  onChatMessage,
  sessionId,
  ttsLang = "da",
  autoSpeakAllowed = false,
}: MessageBubbleProps) {
  // 1.1.11 — pick up the voice provider config for this skill so the
  // read-aloud button can route through Cloud TTS when configured (vs
  // the browser-native default). Cached per-skill across the page
  // session in useVoiceConfig.
  const voiceConfig = useVoiceConfig(skillId);
  // 1.1.11 auto-read: when ON, every assistant message auto-speaks.
  // We only trigger for assistant role; user/system bubbles never
  // self-speak. Gated on `!voiceConfig.loading` so the first message
  // (typically the proactive-greet) doesn't fire before the voice
  // config has resolved — otherwise that first read used the
  // "browser" default and only later messages got Cloud TTS.
  const { enabled: autoReadEnabled } = useAutoReadAloud();
  // Only the parent-designated latest assistant turn auto-speaks — otherwise a
  // resumed session with N restored assistant bubbles would play them all at
  // once on load (the regression chat-history restore exposed).
  const autoSpeak = autoSpeakAllowed && autoReadEnabled && !voiceConfig.loading;
  // 1.1.11 follow-up — resolution order changed 2026-06-04:
  //   skill/class committed lang > student preference > ttsLang prop
  // When the skill (or class) has declared a language (e.g. KineBot
  // says English, Boldkast says Danish), that wins over student
  // preference because the tutor's *text* is in that language and
  // synthesising it with the other language's phonemes sounds wrong.
  // The LangToggle reflects this by rendering locked when the
  // committed lang is set, so the student doesn't get confused.
  const { lang: studentLang } = useVoiceLang();
  const effectiveLang = voiceConfig.tts.language ?? studentLang ?? ttsLang;
  const isBot = message.role === "assistant";
  // Restored history carries the turn's recorded epoch-seconds timestamp; live
  // messages omit it and render at "now". Show a human-friendly relative time
  // ("3 days ago") so days are never ambiguous, with the full timestamp on
  // hover.
  const tsValue = message.timestamp ?? Date.now(); // seconds (history) or ms (live) — util normalises
  const time = formatRelativeTime(tsValue);
  const timeFull = formatAbsoluteTime(tsValue);

  const A2UI_TOOL_NAME = "send_a2ui_json_to_client";

  if (isBot) {
    const a2uiCalls = toolCalls.filter((tc) => tc.name === A2UI_TOOL_NAME);
    const nonA2uiCalls = toolCalls.filter((tc) => tc.name !== A2UI_TOOL_NAME);
    // The router is a no-op for tool calls that don't match a UI binding,
    // so passing the full non-A2UI list is safe — anything without
    // _meta.ui simply renders nothing. ToolCallChip still shows for the
    // rest below.
    const mcpAppCandidates = nonA2uiCalls.filter((tc) => tc.resultContent);

    // Suppress the bubble entirely when the assistant turn has nothing to
    // show INLINE: no text, no inline A2UI (only surface-routed calls),
    // no MCP app candidates, no chip-rendered tool calls. The
    // A2UISurfaceDispatcher inside still ran when the SkillMessage existed
    // (its useEffect fired during render commit), so the workspace surface
    // is already populated by the time we return null. Without this, every
    // tool-only assistant turn renders an empty avatar+name+timestamp row.
    const inlineA2uiCalls = a2uiCalls.filter((tc) => {
      const parsed = parseA2UIResult(tc.resultContent);
      // Inline = no surface_id, or surface_id === "chat".
      return !parsed || !parsed.surfaceId || parsed.surfaceId === "chat";
    });
    const hasInlineContent =
      !!message.content ||
      inlineA2uiCalls.length > 0 ||
      mcpAppCandidates.length > 0 ||
      nonA2uiCalls.length > 0;
    if (!hasInlineContent) {
      // Still render the dispatcher so it fires the registry effect.
      return (
        <>
          {a2uiCalls.map((tc) => {
            const parsed = parseA2UIResult(tc.resultContent);
            if (!parsed || !parsed.surfaceId || parsed.surfaceId === "chat") return null;
            return (
              <A2UISurfaceDispatcher
                key={tc.id}
                surfaceId={parsed.surfaceId}
                messages={parsed.messages}
                sourceToolCallId={tc.id}
              />
            );
          })}
        </>
      );
    }

    return (
      <div className="flex items-start gap-3">
        {persona ? <PersonaBubbleAvatar persona={persona} /> : <BrandAvatar />}
        <div className="flex max-w-[80%] flex-col gap-1">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-orange-600">
              {persona ? persona.name : (skillDisplayName ?? skillId)}
            </span>
            <span className="text-xs text-muted-foreground" title={timeFull}>
              {time}
            </span>
            {/* Sprint 1.H-TTS — only render when this bubble has text
             *  for the engine to speak. Tool-call-only bubbles (no
             *  message.content) skip the button so we don't leave an
             *  empty-text icon dangling next to an A2UI render. */}
            {message.content ? (
              <ReadAloudButton
                text={message.content}
                lang={effectiveLang}
                provider={voiceConfig.tts.provider}
                voice={voiceConfig.tts.voice}
                skillId={skillId}
                autoSpeakOnMount={autoSpeak}
              />
            ) : null}
          </div>
          <div className="space-y-2 rounded-[2px_8px_8px_8px] border-l-[3px] border-orange-400 bg-[hsl(0,0%,98%)] px-3 py-2 text-sm">
            {message.content && (
              <ChatMarkdown content={message.content} navigateToBlock={navigateToBlock} />
            )}
            {a2uiCalls.map((tc) => {
              const parsed = parseA2UIResult(tc.resultContent);
              if (!parsed) return null;
              // Routed-surface path: skills with surface_id != 'chat' push
              // their v0.9 messages into SurfaceRegistry; an
              // <A2UISurfaceMount> elsewhere in the layout owns the render.
              // The dispatcher is effect-only — the chat bubble shows
              // nothing for routed surfaces.
              if (parsed.surfaceId && parsed.surfaceId !== "chat") {
                return (
                  <A2UISurfaceDispatcher
                    key={tc.id}
                    surfaceId={parsed.surfaceId}
                    messages={parsed.messages}
                    sourceToolCallId={tc.id}
                  />
                );
              }
              // Inline-in-chat path — the renderer owns its own per-bubble
              // MessageProcessor + SurfaceModel; messages flow straight in.
              return (
                <A2UIRenderer
                  key={tc.id}
                  messages={parsed.messages}
                  fallbackSurfaceId={`inline-${tc.id}`}
                  onAction={(a) =>
                    onAction({ actionName: a.name, context: a.context })
                  }
                />
              );
            })}
            {mcpAppCandidates.length > 0 && (
              <MCPAppToolCallRouter
                toolCalls={mcpAppCandidates}
                mcpServerIds={mcpServerIds ?? []}
                onChatMessage={onChatMessage}
                sessionId={sessionId}
                skillId={skillId}
              />
            )}
            {/* CONCEPT-1 M3 — a successful record_checkpoint renders as a
                visible card (concept + forstået/på vej + the evidence) instead
                of an opaque tool chip; everything else keeps the chip. */}
            {nonA2uiCalls
              .filter((tc) => tc.name === "record_checkpoint")
              .map((tc) => {
                const result = parseCheckpointResult(tc.resultContent);
                return result ? <CheckpointCard key={tc.id} result={result} /> : null;
              })}
            {nonA2uiCalls.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {nonA2uiCalls
                  .filter((tc) => !(tc.name === "record_checkpoint" && parseCheckpointResult(tc.resultContent)))
                  .map((tc) => (
                    <ToolCallChip key={tc.id} toolCall={tc} />
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // User bubble
  return (
    <div className="flex items-start justify-end gap-3">
      <div className="flex max-w-[80%] flex-col items-end gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">{time}</span>
          <span className="text-xs font-medium text-teal-700">{userDisplayName}</span>
        </div>
        <div className="rounded-[2px_8px_8px_8px] border-l-[3px] border-teal-500 bg-[hsl(200,20%,97%)] px-3 py-2 text-sm">
          {message.images && message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {message.images.map((img, i) => (
                <ZoomableImage
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt="attachment"
                  triggerClassName="h-24 w-24 rounded-md border object-cover"
                />
              ))}
            </div>
          )}
          {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
        </div>
      </div>
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-600 text-xs font-semibold text-white">
        {userInitial}
      </div>
    </div>
  );
});


// ─── A2UI Surface Dispatcher ────────────────────────────────────────────────
// Effect-only React component — pushes a surface-targeted A2UI v0.9 message
// array into the SurfaceRegistry so the matching <A2UISurfaceMount> renders
// it. Returns null because the surface mount owns the rendering.
//
// Why a component rather than a hook inline in the .map()? React's Rules of
// Hooks forbid calling hooks inside .map() callbacks conditionally. Wrapping
// the dispatch in its own component keeps hook usage strictly at the top of
// the dispatcher's body.
//
// `update_mode` is no longer interpreted here — the v0.9 message stream
// encodes the mode itself (`updateComponents` replaces, `updateDataModel`
// patches the data model). The `update_mode` envelope key remains an
// advisory hint for surface authors / forks but does not change dispatch.

interface A2UISurfaceDispatcherProps {
  surfaceId: string;
  messages: Record<string, unknown>[];
  sourceToolCallId: string;
}

function A2UISurfaceDispatcher({
  surfaceId,
  messages,
  sourceToolCallId,
}: A2UISurfaceDispatcherProps) {
  const registry = useSurfaceRegistry();

  useEffect(() => {
    registry.appendMessages(surfaceId, messages, sourceToolCallId);
  }, [registry, surfaceId, messages, sourceToolCallId]);

  return null;
}
