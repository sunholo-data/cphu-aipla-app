"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, Sparkles, SquarePen, X } from "lucide-react";

/**
 * Shared floating chat shell — a fixed bottom-right panel so the teacher can
 * keep working on the page (class list, activity builder, insights) and watch
 * the co-pilot's proposals land in the surface behind it. Minimizes to a pill;
 * the chat stays MOUNTED while minimized (hidden, not unmounted) so the
 * conversation is never lost on collapse.
 *
 * Extracted from the activity co-pilot (`_AuthoringCopilot`) so every teacher
 * surface shares one panel — see teacher-coworking-copilot.md.
 */
export function FloatingCopilot({
  title,
  onNewChat,
  minimizeLabel = "Minimize",
  onClose,
  align = "right",
  children,
}: {
  title: string;
  /** When provided, a "New chat" control appears that resets the conversation. */
  onNewChat?: () => void;
  /** aria-label for the minimize control — locale-specific surfaces override it. */
  minimizeLabel?: string;
  /** On-demand panels (opened from elsewhere, e.g. a header button) pass this:
   *  the top-right control becomes a Close (X) that unmounts the panel, instead
   *  of the default minimize-to-pill. The conversation persists via the thread
   *  id, so reopening resumes it. */
  onClose?: () => void;
  /** Which corner the panel sits in. Default right (the work co-pilots); the
   *  help co-pilot uses "left" so it never collides with them. */
  align?: "left" | "right";
  children: ReactNode;
}) {
  const [minimized, setMinimized] = useState(false);
  const pos = align === "left" ? "bottom-4 left-4" : "bottom-4 right-4";
  const closable = Boolean(onClose);
  return (
    <>
      <section
        data-testid="copilot-panel"
        aria-label={title}
        className={`fixed ${pos} z-50 max-h-[70vh] w-[min(384px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ${
          minimized && !closable ? "hidden" : "flex"
        }`}
      >
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {title}
          </h2>
          <div className="flex items-center gap-1">
            {onNewChat ? (
              <button
                type="button"
                onClick={onNewChat}
                aria-label="New chat"
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            {closable ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMinimized(true)}
                aria-label={minimizeLabel}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {children}
      </section>
      {minimized && !closable ? (
        <button
          type="button"
          onClick={() => setMinimized(false)}
          data-testid="copilot-fab"
          className={`fixed ${pos} z-50 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90`}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" /> {title}
        </button>
      ) : null}
    </>
  );
}
