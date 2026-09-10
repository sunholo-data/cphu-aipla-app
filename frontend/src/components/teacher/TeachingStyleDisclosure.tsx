"use client";

import { type InteractionStyleSpec } from "@/lib/teacherApi";
import { INTERACTION_STYLE_LABEL } from "@/lib/personaDisplay";

/**
 * "How teaching styles are enforced" (1.1.32 transparency). A persona's
 * teaching style isn't magic — it's a prompt. This disclosure shows the exact
 * instruction each style gives the tutor: the appended override (concise /
 * rigorous / warm) or the baked-in default (socratic). Read from the backend
 * (single source of truth), so it never drifts from what's actually injected.
 * It also previews what a teacher will author in the v1.2 custom persona.
 */
export function TeachingStyleDisclosure({ styles }: { styles: InteractionStyleSpec[] }) {
  return (
    <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-foreground">
        How teaching styles are enforced
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        A persona&rsquo;s teaching style is enforced as a prompt added to the
        tutor&rsquo;s instructions. &ldquo;Socratic&rdquo; is the built-in
        default (nothing extra is added); the others append the exact override
        below.
      </p>
      <dl className="mt-2 flex flex-col gap-3">
        {styles.map((s) => {
          // The preamble leads with a "## Interaction style: X" markdown
          // heading — the label already says that, so drop it for readability.
          const body = s.prompt.replace(/^#+\s.*(\n+|$)/, "").trim();
          return (
            <div key={s.id}>
              <dt className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground">
                {INTERACTION_STYLE_LABEL[s.id]}
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {s.injected ? "Added as an override" : "Built-in default"}
                </span>
              </dt>
              <dd className="mt-1 whitespace-pre-wrap rounded bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {body}
              </dd>
            </div>
          );
        })}
      </dl>
    </details>
  );
}
