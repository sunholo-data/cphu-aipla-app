"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Sparkles, SquarePen, X } from "lucide-react";

import { useCopilotEntry } from "./CopilotEntryContext";
import { CopilotLauncher } from "./CopilotLauncher";
import { useT } from "@/i18n";

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
  minimizeLabel,
  onClose,
  align = "right",
  onAsk,
  nudge,
  nudgeKind,
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
  /** CONCEPT-2 M3 — a surface button asked this copilot something (via
   *  `useCopilotEntry().ask`). The panel opens and hands the text on; the
   *  chat sends it as a turn. */
  onAsk?: (text: string) => void;
  /** One line on what this helper can do, shown once per `nudgeKind` beside
   *  the pill the first time a teacher meets it (inside the teacher shell). */
  nudge?: string;
  /** Which helper this is, for "once per kind" — the skill slug. */
  nudgeKind?: string;
  children: ReactNode;
}) {
  // START MINIMISED (2026-09-11, M's standing request for every co-pilot).
  //
  // These panels are fixed bottom-right over the surface the teacher is working
  // on — a class list, the activity builder, the approaches editor. Opening
  // expanded puts a 384px panel over that work before anyone asked for help,
  // on every page load. The pill is the invitation; the panel is the answer.
  //
  // ⚠️ This only affects the always-mounted work co-pilots. An ON-DEMAND panel
  // (`closable`, opened from a header button) ignores `minimized` entirely in
  // the class below — the teacher just clicked to open it, so collapsing it to
  // a pill would swallow the click.
  const t = useT("FloatingCopilot");
  const [minimized, setMinimized] = useState(true);
  // On a phone the open panel is the whole screen (a sheet over the page and
  // its bottom bar): a 384px box in a corner left the chat a few lines tall,
  // under the bottom bar, and pushed off screen by the keyboard. From `sm` up
  // it is the corner panel — lifted clear of anything the page keeps at its
  // bottom edge (the wizard's sticky footer), via `--copilot-bottom-offset`.
  const panelPos =
    align === "left"
      ? "inset-0 sm:inset-auto sm:bottom-[calc(1rem+var(--copilot-bottom-offset,0px))] sm:left-4"
      : "inset-0 sm:inset-auto sm:bottom-[calc(1rem+var(--copilot-bottom-offset,0px))] sm:right-4";
  const closable = Boolean(onClose);
  // 1.1.125 M3 — inside the teacher shell a work copilot registers itself with
  // the header's Hjælp menu. Since 2026-11-12 it ALSO shows its pill there
  // (teachers did not find the menu item), plus a one-time nudge saying what
  // it can do. Outside a provider it is the plain pill, as it always was.
  const entry = useCopilotEntry();
  const registerWithShell = Boolean(entry) && !closable;
  const bottomInset = entry?.bottomInset ?? 0;
  // Depend on the STABLE `register` callback, not the context value: the value
  // changes on every registration, and depending on it would re-register in a
  // loop (register → value changes → cleanup → register → …).
  const register = entry?.register;
  // `onAsk` rides in a ref so a new callback identity does not re-register the
  // copilot on every parent render — the same reason `register` is the stable
  // dependency here rather than the context value.
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  useEffect(() => {
    if (!register || closable) return;
    return register({
      title,
      open: (prefill?: string) => {
        setMinimized(false);
        if (prefill) askRef.current?.(prefill);
      },
    });
  }, [register, closable, title]);
  return (
    <>
      <section
        data-testid="copilot-panel"
        aria-label={title}
        style={{ "--copilot-bottom-offset": `${bottomInset}px` } as CSSProperties}
        className={`fixed ${panelPos} z-50 h-dvh w-full flex-col overflow-hidden border-border bg-background sm:h-auto sm:max-h-[70vh] sm:w-[min(384px,calc(100vw-2rem))] sm:rounded-xl sm:border sm:shadow-2xl ${
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
                aria-label={t("newChat")}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            {closable ? (
              <button
                type="button"
                onClick={onClose}
                aria-label={t("close")}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMinimized(true)}
                aria-label={minimizeLabel ?? t("minimize")}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {children}
      </section>
      {closable ? null : (
        <CopilotLauncher
          title={title}
          open={!minimized}
          onOpen={() => setMinimized(false)}
          align={align}
          bottomInset={bottomInset}
          nudge={registerWithShell ? nudge : undefined}
          nudgeKind={nudgeKind}
        />
      )}
    </>
  );
}
