"use client";

import { BrandAvatar } from "@/components/chat/BrandAvatar";

/** A persona resolved for the running activity (1.1.12). When present the bot
 *  bubble shows the persona's avatar + name instead of the skill byline. */
export interface PersonaSummary {
  id: string;
  name: string;
  title: string | null;
  avatar: string;
}

export interface BotIdentityProps {
  skillId: string;
  /** Human-readable skill label (1.1.11); falls back to `skillId`. */
  skillDisplayName?: string;
  persona?: PersonaSummary | null;
}

/**
 * The name a tutor turn is signed with — ONE source of truth for the streaming
 * and the finished bubble (1.1.147 open question 6).
 *
 * They used to decide separately: the finished bubble read persona → display
 * name → skillId, the streaming bubble printed the raw skillId. So every turn
 * opened under `concept-dialogue` and flipped to "Sofie" when it finished — a
 * technical id flickering on every reply.
 */
export function botBylineName({ skillId, skillDisplayName, persona }: BotIdentityProps): string {
  return persona ? persona.name : (skillDisplayName ?? skillId);
}

function PersonaBubbleAvatar({ persona }: { persona: PersonaSummary }) {
  if (persona.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={persona.avatar}
        alt={persona.name}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-bold text-orange-700"
    >
      {persona.name[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** The avatar beside a tutor turn — the persona's, else the brand mark. Shared
 *  for the same reason as {@link botBylineName}: the face must not swap when
 *  the turn finishes streaming. */
export function BotAvatar({ persona }: { persona?: PersonaSummary | null }) {
  return persona ? <PersonaBubbleAvatar persona={persona} /> : <BrandAvatar />;
}
