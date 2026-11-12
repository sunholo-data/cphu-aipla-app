"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Sparkles, X } from "lucide-react";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The work co-pilot's launcher: a pill in the corner that says what the helper
 * is, plus — the first time a teacher meets this kind of helper — one line
 * beside it saying what it can do (approved by M, 2026-11-12: "as users browse
 * around the site, the helper could flash to side/bottom as a copilot to say it
 * can help").
 *
 * 1.1.125 M3 had made the header's Hjælp menu the only way in to a work
 * co-pilot inside the teacher shell. Teachers did not find it there. The menu
 * item stays; this puts the helper where it can be seen.
 */

/** Wait before the nudge appears, so it does not arrive with the page. */
export const NUDGE_DELAY_MS = 1500;
/** How long the nudge stays before folding back into the pill. */
export const NUDGE_VISIBLE_MS = 8000;

/** Bump the version to show every teacher a rewritten nudge once more. */
export function nudgeStorageKey(kind: string): string {
  return `copilot-nudge:v1:${kind}`;
}

/** True when this viewer has not had the nudge for `kind` yet — and records
 *  that they now have. Storage is a per-viewer convenience: if it cannot be
 *  read or written, say false, so a nudge that could not be remembered is never
 *  shown on every page load. */
function claimNudge(kind: string): boolean {
  try {
    const key = nudgeStorageKey(kind);
    if (window.localStorage.getItem(key)) return false;
    window.localStorage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

/** The teacher found the helper on their own: no need to point at it later. */
function markNudgeSeen(kind: string): void {
  try {
    window.localStorage.setItem(nudgeStorageKey(kind), "1");
  } catch {
    /* no storage — nothing to remember */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

type Phase = "waiting" | "shown" | "done";

/**
 * At most one nudge per mount, and per `kind` once ever (in this browser). It
 * appears after `NUDGE_DELAY_MS`, folds away after `NUDGE_VISIBLE_MS` or at the
 * first pointer press or key press anywhere, and is cancelled if the panel is
 * opened first.
 */
function useNudge(kind: string | undefined, enabled: boolean, panelOpen: boolean) {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [announced, setAnnounced] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (!enabled || !kind || phase !== "waiting") return;
    if (panelOpen) {
      markNudgeSeen(kind);
      setPhase("done");
      return;
    }
    const timer = window.setTimeout(() => {
      if (claimNudge(kind)) {
        setReduceMotion(prefersReducedMotion());
        setAnnounced(true);
        setPhase("shown");
      } else {
        setPhase("done");
      }
    }, NUDGE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, kind, phase, panelOpen]);

  useEffect(() => {
    if (phase !== "shown") return;
    const done = () => setPhase("done");
    const timer = window.setTimeout(done, NUDGE_VISIBLE_MS);
    document.addEventListener("pointerdown", done, true);
    document.addEventListener("keydown", done, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", done, true);
      document.removeEventListener("keydown", done, true);
    };
  }, [phase]);

  useEffect(() => {
    if (panelOpen && phase === "shown") setPhase("done");
  }, [panelOpen, phase]);

  return {
    visible: phase === "shown" && !panelOpen,
    announced,
    reduceMotion,
    dismiss: () => setPhase("done"),
  };
}

export function CopilotLauncher({
  title,
  open,
  onOpen,
  align,
  bottomInset,
  nudge,
  nudgeKind,
}: {
  title: string;
  /** The panel is open: the pill hides (the panel is where the pill was). */
  open: boolean;
  onOpen: () => void;
  align: "left" | "right";
  /** px to stay clear of at the bottom edge (a sticky footer, the phone nav). */
  bottomInset: number;
  /** One line on what THIS helper can do; no nudge without it. */
  nudge?: string;
  /** Which helper this is, for "once per kind" (the skill slug). */
  nudgeKind?: string;
}) {
  const t = useT("FloatingCopilot");
  const { visible, announced, reduceMotion, dismiss } = useNudge(nudgeKind, Boolean(nudge), open);
  const side = align === "left" ? "left-4 items-start" : "right-4 items-end";
  return (
    <>
      {nudge ? (
        // Said once, politely, when the nudge appears — and never again: the
        // text stays put, so nothing re-announces it. The visible bubble is
        // hidden from assistive tech so it is not read twice.
        <p className="sr-only" aria-live="polite" data-testid="copilot-nudge-announcer">
          {announced ? nudge : ""}
        </p>
      ) : null}
      {open ? null : (
        <div
          data-testid="copilot-launcher"
          style={{ "--copilot-bottom-offset": `${bottomInset}px` } as CSSProperties}
          className={cn("fixed z-50 flex flex-col gap-2 bottom-[calc(1rem+var(--copilot-bottom-offset,0px))]", side)}
        >
          {visible ? (
            <div
              data-testid="copilot-nudge"
              data-motion={reduceMotion ? "none" : "slide"}
              className={cn(
                "flex max-w-[min(18rem,calc(100vw-2rem))] items-start gap-2 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg",
                !reduceMotion && "duration-300 animate-in fade-in slide-in-from-bottom-2 motion-reduce:animate-none",
              )}
            >
              <p aria-hidden="true" className="flex-1">
                {nudge}
              </p>
              <button
                type="button"
                onClick={dismiss}
                aria-label={t("nudgeDismiss")}
                className="-m-1.5 shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={onOpen}
            data-testid="copilot-fab"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" /> {title}
          </button>
        </div>
      )}
    </>
  );
}
