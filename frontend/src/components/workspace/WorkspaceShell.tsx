"use client";

import { useEffect, useState, type ReactNode } from "react";

const COLLAPSE_KEY = "aipla.workspace.collapsed";

interface WorkspaceShellProps {
  /** Static workspace content — problem statement, sim, checklist. Always
   * rendered when expanded. M3 fills with ProblemStatementCard; the
   * Boldkast sim lands here later in the buffer week. */
  children: ReactNode;
  /** Optional title shown in the header bar. Defaults to Danish for the
   * Jutland demo; teacher-facing surfaces can override. */
  title?: string;
}

/**
 * WorkspaceShell — persistent right-hand pane for AIPLA's anon-group
 * + problem-set-hints flow. Mounted as a flex sibling of the chat
 * column so the two share the row proportionally (60/40 on lg+).
 *
 * Why not reuse `WorkspaceSurfaceRegion` (the A2UI surface mount from
 * MULTI-SURFACE-A2UI M3)? That component is a *passive* region — it
 * returns null until the agent publishes an A2UI tree to the surface.
 * AIPLA's problem-set-hints skill is now A2UI-disabled (see
 * upstream-feedback #22 resolution + M1 commit), so the agent will
 * never publish there. This shell renders authored, static content
 * the platform owns — not agent-generated content.
 *
 * Both can coexist on the same page in principle; for v0.1 only this
 * shell mounts on anon-group + problem-set-hints, and the surface
 * region stays null because A2UI is opt-out for that skill.
 *
 * Collapse state persists in sessionStorage (matches the codebase's
 * existing sessionStorage convention — student state resets on tab
 * close, which is fine for v0.1). Below `lg` the shell hides
 * entirely — Jutland demo runs on laptops + iPads in landscape, both
 * of which clear the lg breakpoint. Mobile/portrait support lands in
 * v1 alongside multi-class teacher dashboards.
 */
export function WorkspaceShell({ children, title = "Arbejdsområde" }: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore collapse state on mount. Done in effect (not initial state)
  // so SSR doesn't read sessionStorage and React doesn't hydrate a mismatch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(COLLAPSE_KEY);
    if (stored === "1") setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  // When collapsed (md+ only): a thin vertical strip with a chevron to
  // reopen. The chat column's flex-1 reclaims the freed width — no jump.
  if (collapsed) {
    return (
      <aside
        className="hidden md:flex w-8 shrink-0 flex-col items-center border-l bg-muted/30"
        aria-label="Workspace (collapsed)"
      >
        <button
          type="button"
          onClick={toggle}
          className="mt-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Expand workspace"
          title="Vis arbejdsområde"
        >
          {/* chevron-left */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="10 12 6 8 10 4" />
          </svg>
        </button>
      </aside>
    );
  }

  // Layout breakpoints:
  //   <md (640-ish px): stacked vertically. Workspace renders below the
  //     chat column as a min-height region (caller decides the layout
  //     wrapper; this aside just owns its own width=100%/height=auto).
  //   md+: side-by-side, 50/50. shrink-0 keeps the workspace honest
  //     under content pressure (sim/charts don't push chat narrower).
  // bg-muted/40 visually separates the workspace from the chat (which
  // is bg-background). Border on the LEFT for md+, on the TOP for <md.
  return (
    <aside
      className="flex w-full shrink-0 flex-col overflow-hidden border-t bg-muted/40 md:w-1/2 md:border-t-0 md:border-l"
      aria-label="Workspace"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 py-2 bg-muted/60">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <button
          type="button"
          onClick={toggle}
          className="hidden md:block rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Collapse workspace"
          title="Skjul arbejdsområde"
        >
          {/* chevron-right */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 4 10 8 6 12" />
          </svg>
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {children}
      </div>
    </aside>
  );
}
