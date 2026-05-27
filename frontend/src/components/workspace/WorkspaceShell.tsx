"use client";

import { useEffect, useState, type ReactNode } from "react";

import { RATIO_DEFAULT } from "@/hooks/useResizableWorkspaceRatio";
import { ChatRevealTab } from "./ChatRevealTab";
import { WorkspaceDivider } from "./WorkspaceDivider";

const COLLAPSE_KEY = "aipla.workspace.collapsed";

interface WorkspaceShellProps {
  /** Static workspace content — problem statement, sim, checklist. Always
   * rendered when expanded. M3 fills with ProblemStatementCard; the
   * Boldkast sim lands here later in the buffer week. */
  children: ReactNode;
  /** Optional title shown in the header bar. Defaults to Danish for the
   * Jutland demo; teacher-facing surfaces can override. */
  title?: string;
  /** When true, the shell is hidden below the md breakpoint. md+ visibility
   * is unaffected. Use this on small-screen tab patterns where a parent
   * tab-bar gates which panel is visible. Default: always-visible. */
  hideOnMobile?: boolean;
  /** Resize ratio (workspace fraction of the row) in [0.30, 1.00].
   *  When omitted, the shell falls back to its legacy md:w-1/2 behaviour
   *  and no divider is rendered (back-compat for callers that don't
   *  pass the resize props). */
  ratio?: number;
  /** Commit a new ratio. Required if `ratio` is set. */
  onRatioChange?: (next: number) => void;
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
export function WorkspaceShell({
  children,
  title = "Arbejdsområde",
  hideOnMobile = false,
  ratio,
  onRatioChange,
}: WorkspaceShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const resizable = typeof ratio === "number" && typeof onRatioChange === "function";
  const effectiveRatio = resizable ? ratio : null;
  const fullscreen = effectiveRatio === 1;

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
  //   md+: side-by-side. When `ratio` prop is supplied, width is
  //     flex-basis driven from React state (resize handle live); else
  //     falls back to the legacy md:w-1/2 behaviour for backward-
  //     compat with callers that don't yet pass the resize props.
  //   shrink-0 keeps the workspace honest under content pressure
  //     (sim/charts don't push chat narrower).
  // bg-muted/40 visually separates the workspace from the chat (which
  // is bg-background). Border on the LEFT for md+, on the TOP for <md.
  //
  // The aside is `position: relative` so the divider + reveal-tab can
  // anchor to its left edge.
  const mdWidthClass = resizable ? "" : "md:w-1/2";
  const mdWidthStyle =
    resizable && effectiveRatio !== null
      ? { flexBasis: `${effectiveRatio * 100}%` }
      : undefined;
  return (
    <aside
      data-workspace-aside
      style={mdWidthStyle}
      // flex-1 below md so the aside claims the row's remaining height
      // when the chat sibling is hidden by the mobile tab pattern —
      // without it, the aside sizes to content and the internal
      // overflow-y-auto + flex-1 chain has no height context, so the
      // workspace pane clips to the natural content height of its
      // first few elements and the rest disappears off-screen.
      // md:flex-none + style.flexBasis controls the desktop width
      // (legacy md:w-1/2 OR the resize-hook ratio).
      className={`relative w-full flex-1 flex-col overflow-hidden border-t bg-muted/40 md:flex md:flex-none md:border-t-0 md:border-l ${mdWidthClass} ${
        hideOnMobile ? "hidden" : "flex"
      }`}
      aria-label="Workspace"
    >
      {resizable && !fullscreen ? (
        <WorkspaceDivider ratio={ratio} onChange={onRatioChange} />
      ) : null}
      {resizable && fullscreen ? (
        <ChatRevealTab onReveal={() => onRatioChange(RATIO_DEFAULT)} />
      ) : null}
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
