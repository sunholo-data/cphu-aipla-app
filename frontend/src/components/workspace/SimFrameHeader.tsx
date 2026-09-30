"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

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
  /** 1.1.140 M1 — focus mode: hide the chat column so the sim has the row.
   *  Omitted where there is no chat beside the sim (the builder preview).
   *  `chatShown` picks the icon; `label` names the ACTION the button will take
   *  ("Focus on the simulation" / "Show the chat again"), so no aria-pressed:
   *  a pressed state plus a changing label reads wrongly to a screen reader. */
  focus?: { chatShown: boolean; onToggle: () => void; label: string };
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
  focus,
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

  // Below ~900px the header goes compact (1.1.140 M1): tighter padding and an
  // icon-only close button, so the sim — not its chrome — gets the height. The
  // close button keeps its aria-label, so nothing is lost to a screen reader.
  return (
    <header
      data-sim-frame-header
      className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 max-[899px]:px-2 max-[899px]:py-1"
    >
      <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex shrink-0 items-center gap-1">
        {focus ? (
          // md+ only: below md the chat is already a separate tab.
          <button
            type="button"
            onClick={focus.onToggle}
            className="hidden items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground md:flex"
            aria-label={focus.label}
            title={focus.label}
            data-sim-focus-toggle
          >
            {focus.chatShown ? (
              <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <PanelLeftOpen className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
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
          <span className="max-[899px]:hidden">{closeLabel}</span>
        </button>
      </div>
    </header>
  );
}
