"use client";

import { useEffect, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";

interface PinnedWelcomeProps {
  /** Markdown body — typically the skill's `initialMessage` field
   * (starter prompts, tutorial). Empty disables the component. */
  content: string;
  /** Skill id used to scope the collapse-state key so toggling on
   * one skill doesn't affect another. */
  skillId: string;
}

const KEY_PREFIX = "aipla.welcome.collapsed:";

/**
 * PinnedWelcome — collapsible header that holds the skill's starter-
 * prompts / tutorial body and stays visible across all messages.
 *
 * Fixes the template-default behaviour where the welcome panel only
 * rendered on `messages.length === 0` and vanished the moment the
 * student sent their first turn. Anchoring the orientation prompts
 * across the whole session matters more for AIPLA's pedagogical
 * scaffolding than the inherited "welcome blurb just for the empty
 * state" framing.
 *
 * Collapse state is per-skill (so a teacher demo skill and a student
 * skill don't share preference) and persists in sessionStorage.
 */
export function PinnedWelcome({ content, skillId }: PinnedWelcomeProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Restore collapse state on mount; effect (not initial state) so SSR
  // doesn't read sessionStorage and React doesn't hydrate a mismatch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(KEY_PREFIX + skillId);
    if (stored === "1") setCollapsed(true);
  }, [skillId]);

  if (!content) return null;

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(KEY_PREFIX + skillId, next ? "1" : "0");
      }
      return next;
    });
  };

  return (
    <div className="border-b bg-muted/30">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted"
        aria-expanded={!collapsed}
        aria-controls="pinned-welcome-body"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={collapsed ? "" : "rotate-90"}
          aria-hidden="true"
        >
          <polyline points="4 2 8 6 4 10" />
        </svg>
        <span>👋 Sådan kommer du i gang</span>
      </button>
      {!collapsed && (
        <div
          id="pinned-welcome-body"
          className="px-4 pb-4 text-sm text-foreground"
        >
          <ChatMarkdown content={content} navigateToBlock={() => {}} />
        </div>
      )}
    </div>
  );
}
