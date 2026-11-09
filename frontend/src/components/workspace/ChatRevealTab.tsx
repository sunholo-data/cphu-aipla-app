"use client";

import { useT } from "@/i18n";

interface ChatRevealTabProps {
  /** Click handler — restores the workspace to its default ratio so
   *  the chat panel becomes visible again. */
  onReveal: () => void;
  /** The workspace's side; the tab sits on the edge where the chat comes back. */
  side?: "left" | "right";
}

/**
 * ChatRevealTab — small left-edge tab visible only when the workspace
 * is at ratio=1.0 (chat hidden). Click reveals the chat by returning
 * the workspace to a sensible default (0.50).
 */
export function ChatRevealTab({ onReveal, side = "right" }: ChatRevealTabProps) {
  const t = useT("ChatRevealTab");
  return (
    <button
      type="button"
      onClick={onReveal}
      className={`absolute top-1/2 z-20 -translate-y-1/2 border border-border bg-card px-1.5 py-3 text-xs text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground ${
        side === "left" ? "right-0 rounded-l-md border-r-0" : "left-0 rounded-r-md border-l-0"
      }`}
      aria-label={t("showChat")}
      title={t("showChat")}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points={side === "left" ? "6 4 10 8 6 12" : "10 12 6 8 10 4"} />
      </svg>
    </button>
  );
}
