"use client";

import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { PersonaSummary } from "@/components/chat/MessageBubble";
import { useLocaleMode, useT, type MessageKey } from "@/i18n";
import type { ActivityOpening } from "@/lib/activityOpening";

import { ChatMarkdown } from "./ChatMarkdown";

interface PinnedWelcomeProps {
  /** Skill Markdown, used when there is no resolved activity opening. */
  content: string;
  /** Skill id used to scope the collapse-state key so toggling on
   * one skill doesn't affect another. */
  skillId: string;
  /** Activity facts take precedence over the skill's generic welcome. */
  opening?: ActivityOpening | null;
  activityTitle?: string;
  activityId?: string | null;
  onStarterPrompt?: (text: string) => void;
  promptsDisabled?: boolean;
  /** 1.1.12 — the active persona. When set, it appears as a left-hand
   * column (large avatar + name + role) beside the welcome body, so the
   * avatar can be sizeable without pushing the orientation text down the
   * page. Stacks above the text on narrow viewports. The per-bubble avatar
   * still reinforces the persona each turn. */
  persona?: PersonaSummary | null;
}

const KEY_PREFIX = "aipla.welcome.collapsed:";

/**
 * PinnedWelcome — activity orientation (or the skill's welcome for standalone
 * chats), kept above the transcript across all messages.
 *
 * Fixes the template-default behaviour where the welcome panel only
 * rendered on `messages.length === 0` and vanished the moment the
 * student sent their first turn. Anchoring the orientation prompts
 * across the whole session matters more for AIPLA's pedagogical
 * scaffolding than the inherited "welcome blurb just for the empty
 * state" framing.
 *
 * Collapse state is per-activity, falling back to the skill for standalone
 * chats, and persists in sessionStorage.
 */
export function PinnedWelcome({ content, skillId, persona, opening, activityTitle, activityId, onStarterPrompt, promptsDisabled }: PinnedWelcomeProps) {
  const t = useT("PinnedWelcome");
  const locale = useLocaleMode();
  const [collapsed, setCollapsed] = useState(false);
  const scope = activityId || skillId;
  const prompts = opening?.starterPrompts.length
    ? opening.starterPrompts
    : [t("promptStart"), t("promptStuck"), t("promptExample")];

  // Restore collapse state on mount; effect (not initial state) so SSR
  // doesn't read sessionStorage and React doesn't hydrate a mismatch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(KEY_PREFIX + scope);
    setCollapsed(stored === "1");
  }, [scope]);

  // The privacy notice is the reason this box always renders now: KU legal
  // (2026-10-05) asked that students be told, explicitly and on screen, not to
  // share names, CPR numbers or pictures of themselves. It stays visible when
  // the box is collapsed and when the teacher wrote no welcome text.

  const toggle = () => {
    setCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(KEY_PREFIX + scope, next ? "1" : "0");
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
        <span>👋 {t("heading")}</span>
      </button>
      <PrivacyNotice title={t("privacyTitle")} body={t("privacyBody")} />
      {!collapsed && (opening || content) && (
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
            {opening ? (
              <div className="space-y-3">
                {opening.source === "teacher" ? (
                  <ChatMarkdown content={opening.text} navigateToBlock={() => {}} />
                ) : <>
                {activityTitle ? <p className="font-semibold">{activityTitle}</p> : null}
                <p>
                  {opening.firstItem
                    ? t("startWith", {
                        item: opening.firstItem.title || t(ITEM_LABELS[opening.firstItem.kind] ?? "kindItem"),
                      })
                    : t("startInChat")}
                </p>
                {opening.steps.length > 0 ? (
                  <div>
                    <p className="font-medium">{t("steps")}</p>
                    <ol className="list-decimal space-y-1 pl-5">
                      {opening.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <p>{persona?.name ? t("askTutor", { name: persona.name }) : t("askTutorDefault")}</p>
                </>}
                {onStarterPrompt ? (
                  <div className="flex flex-wrap gap-2">
                    {prompts.map((prompt, index) => (
                      <button type="button" key={index} disabled={promptsDisabled}
                        onClick={() => onStarterPrompt(prompt)}
                        className="rounded-full border border-border bg-background px-3 py-1 text-left text-xs hover:bg-muted disabled:opacity-50">
                        {prompt}
                      </button>
                    ))}
                  </div>
                ) : null}
                <a
                  href={`/guides/s1-join-and-use-your-tutor${locale === "da" ? ".da" : ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {t("studentGuide")}
                </a>
              </div>
            ) : (
              <ChatMarkdown content={content} navigateToBlock={() => {}} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ITEM_LABELS: Record<string, MessageKey<"PinnedWelcome">> = {
  simulation: "kindSimulation",
  checklist: "kindChecklist",
  table: "kindTable",
  chart: "kindChart",
  calculator: "kindCalculator",
  note: "kindNote",
  writing: "kindWriting",
  solution: "kindSolution",
  document: "kindDocument",
  conceptMap: "kindConceptMap",
};

function PrivacyNotice({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="note"
      aria-label={title}
      className="mx-4 mb-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p>
        <strong className="font-semibold">{title}.</strong> {body}
      </p>
    </div>
  );
}
