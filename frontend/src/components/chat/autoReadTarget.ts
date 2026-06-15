import type { SkillMessage } from "@/hooks/useSkillAgent";

/**
 * The id of the single message auto-read should speak: the LAST assistant turn
 * across the rendered history + finalised live messages.
 *
 * Auto-read plays ONLY this one. Without this, a resumed session that renders N
 * restored assistant bubbles had every bubble self-speak on mount → all the
 * audio played at once on load (the regression chat-history restore exposed).
 *
 * Returns null when there's no assistant turn yet (fresh chat, or only the
 * student has spoken).
 */
export function latestAssistantMessageId(
  messages: Pick<SkillMessage, "id" | "role">[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].id;
  }
  return null;
}
