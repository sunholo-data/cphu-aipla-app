"use client";

interface ChatRevealTabProps {
  /** Click handler — restores the workspace to its default ratio so
   *  the chat panel becomes visible again. */
  onReveal: () => void;
}

/**
 * ChatRevealTab — small left-edge tab visible only when the workspace
 * is at ratio=1.0 (chat hidden). Click reveals the chat by returning
 * the workspace to a sensible default (0.50).
 */
export function ChatRevealTab({ onReveal }: ChatRevealTabProps) {
  return (
    <button
      type="button"
      onClick={onReveal}
      className="absolute left-0 top-1/2 z-20 -translate-y-1/2 rounded-r-md border border-l-0 border-border bg-card px-1.5 py-3 text-xs text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
      aria-label="Vis chat"
      title="Vis chat"
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
        <polyline points="10 12 6 8 10 4" />
      </svg>
    </button>
  );
}
