import type { PersonaSummary } from "@/components/chat/MessageBubble";

/**
 * Main-chat persona header (1.1.12) — a single prominent "you're working with
 * <name>" banner at the top of the chat column. Reinforces the character the
 * student is talking to, beyond the small per-bubble avatar. Renders nothing
 * when no persona is set, so the default skill chat is unchanged.
 */
export function PersonaHeader({ persona }: { persona: PersonaSummary | null }) {
  if (!persona) return null;
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
      {persona.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={persona.avatar}
          alt={persona.name}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-sm font-bold text-orange-700"
        >
          {persona.name[0]?.toUpperCase() ?? "?"}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">{persona.name}</span>
        {persona.title ? (
          <span className="truncate text-xs text-muted-foreground">{persona.title}</span>
        ) : null}
      </div>
    </div>
  );
}
