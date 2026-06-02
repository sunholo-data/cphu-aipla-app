"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";

interface SimFrameHeaderProps {
  /** Display title shown left-aligned. */
  title: string;
  /** ARIA label for the close button (locale-specific). */
  closeAriaLabel: string;
  /** Visible label for the close button (locale-specific). */
  closeLabel: string;
  /** ARIA label for the fullscreen toggle (locale-specific). */
  fullscreenAriaLabel: string;
  /** Called when the user dismisses the sim. */
  onClose: () => void;
  /** The DOM element to take fullscreen — usually the sim's outer wrapper. */
  fullscreenTarget: HTMLElement | null;
}

/** Shared header for sim frames (Boldkast, LED-Planck, KineBot).
 *
 *  Adds a fullscreen toggle alongside a bordered, icon-led close button so
 *  the close affordance is scannable instead of disappearing into the
 *  muted-foreground colour of the previous text-only link.
 */
export function SimFrameHeader({
  title,
  closeAriaLabel,
  closeLabel,
  fullscreenAriaLabel,
  onClose,
  fullscreenTarget,
}: SimFrameHeaderProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Sync local state with the browser's fullscreen element so pressing Esc
  // (which exits fullscreen without calling our toggle) flips the icon back
  // to the "enter fullscreen" affordance.
  useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === fullscreenTarget);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [fullscreenTarget]);

  function toggleFullscreen() {
    if (!fullscreenTarget) return;
    if (document.fullscreenElement === fullscreenTarget) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void fullscreenTarget.requestFullscreen().catch(() => {});
    }
  }

  return (
    <header className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
      <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={fullscreenAriaLabel}
          aria-pressed={isFullscreen}
        >
          {isFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:bg-destructive/10 hover:border-destructive hover:text-destructive"
          aria-label={closeAriaLabel}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {closeLabel}
        </button>
      </div>
    </header>
  );
}
