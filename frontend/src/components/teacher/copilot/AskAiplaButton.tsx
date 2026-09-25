"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle, Sparkles } from "lucide-react";

import { useCopilotEntry } from "./CopilotEntryContext";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */
const copy = {
  button: "Ask AIPLA",
  menu: "Ask AIPLA",
  help: "AIPLA Hjælp — how do I…",
  helpOnly: "Hjælp",
} as const;

/**
 * The one entry to every copilot (1.1.125 M3). On a page with a work copilot
 * (class list, class page, builder, approaches) it offers that copilot and the
 * help assistant; elsewhere it opens help directly. The pills the work
 * copilots used to float are gone inside the shell — this is where they went.
 *
 * `helpEnabled` false (flag off) and no page copilot → renders nothing, which
 * is what the header did before.
 */
export function AskAiplaButton({ helpEnabled, onOpenHelp }: { helpEnabled: boolean; onOpenHelp: () => void }) {
  const entry = useCopilotEntry();
  const page = entry?.registered ?? null;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!page && !helpEnabled) return null;

  const cls =
    "flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground";

  // Nothing to choose between: one click opens the one thing.
  if (!page) {
    return (
      <button type="button" onClick={onOpenHelp} className={cls} data-testid="ask-aipla">
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.helpOnly}</span>
      </button>
    );
  }
  if (!helpEnabled) {
    return (
      <button type="button" onClick={() => page.open()} className={cls} data-testid="ask-aipla">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{page.title}</span>
      </button>
    );
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cls}
        data-testid="ask-aipla"
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{copy.button}</span>
      </button>
      {open ? (
        <ul role="menu" aria-label={copy.menu} className="absolute right-0 z-20 mt-1 w-56 rounded border border-border bg-background py-1 text-sm shadow-lg">
          <li role="none">
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                page.open();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              {page.title}
            </button>
          </li>
          <li role="none">
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenHelp();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
            >
              <HelpCircle className="h-4 w-4" aria-hidden="true" />
              {copy.help}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
