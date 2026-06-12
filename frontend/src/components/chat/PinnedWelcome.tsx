"use client";

import { useEffect, useState } from "react";
import type { PersonaSummary } from "@/components/chat/MessageBubble";
import { ChatMarkdown } from "./ChatMarkdown";

interface PinnedWelcomeProps {
  /** Markdown body — typically the skill's `initialMessage` field
   * (starter prompts, tutorial). Empty disables the component. */
  content: string;
  /** Skill id used to scope the collapse-state key so toggling on
   * one skill doesn't affect another. */
  skillId: string;
  /** 1.1.12 — the active persona. When set, it appears as a left-hand
   * column (large avatar + name + role) beside the welcome body, so the
   * avatar can be sizeable without pushing the orientation text down the
   * page. Stacks above the text on narrow viewports. The per-bubble avatar
   * still reinforces the persona each turn. */
  persona?: PersonaSummary | null;
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
export function PinnedWelcome({ content, skillId, persona }: PinnedWelcomeProps) {
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
          className="flex flex-col gap-4 px-4 pb-4 text-sm text-foreground sm:flex-row sm:items-start sm:gap-5"
        >
          {persona ? (
            <div className="flex shrink-0 flex-col items-center gap-1.5 text-center sm:w-36 sm:border-r sm:border-border/60 sm:pr-5">
              {persona.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={persona.avatar}
                  alt={persona.name}
                  className="h-28 w-28 rounded-full object-cover shadow-sm"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex h-28 w-28 items-center justify-center rounded-full bg-orange-100 text-4xl font-bold text-orange-700"
                >
                  {persona.name[0]?.toUpperCase() ?? "?"}
                </span>
              )}
              <span className="text-base font-semibold text-foreground">{persona.name}</span>
              {persona.title ? (
                <span className="text-xs leading-tight text-muted-foreground">{persona.title}</span>
              ) : null}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <ChatMarkdown content={content} navigateToBlock={() => {}} />
          </div>
        </div>
      )}
    </div>
  );
}
