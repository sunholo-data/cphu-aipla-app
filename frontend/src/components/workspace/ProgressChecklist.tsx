"use client";

import { useEffect, useState } from "react";

/**
 * One sub-part of a problem the student can mark as worked-through.
 * `id` is the slug used in storage (must be stable across reloads);
 * `label` is the Danish display text.
 */
export interface ChecklistItem {
  id: string;
  label: string;
}

interface ProgressChecklistProps {
  /** Skill id — scopes the storage key so different skills don't
   * share progress state. */
  skillId: string;
  /** Sub-parts of the problem. v0.1 hardcodes Boldkast a/b/c/d in the
   * caller; v1 will source this from skillMetadata.subParts. */
  items: ChecklistItem[];
}

const KEY_PREFIX = "aipla.progress:";

/**
 * ProgressChecklist — student-driven sub-part tracker for the AIPLA
 * Workshop. Each item has a "Marker som klar" button; toggling it
 * stores done-state in sessionStorage so the student sees their
 * progress visually across the session.
 *
 * Pedagogical principle: student-driven, not auto-graded. The agent
 * does NOT decide what's done; the student does. v1 will plumb this
 * state into the agent's context (via forwardedProps.problem_progress
 * → InstructionProvider) so the tutor can say "great, you finished a —
 * want to start b?". v0.1 keeps the state local to the browser so the
 * demo doesn't depend on the full ADK state-delta pipeline.
 */
export function ProgressChecklist({ skillId, items }: ProgressChecklistProps) {
  const storageKey = KEY_PREFIX + skillId;
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setDone(parsed as Record<string, boolean>);
      }
    } catch {
      // Stale/garbage data — ignore. New writes will overwrite.
    }
  }, [storageKey]);

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      }
      return next;
    });
  };

  const completed = items.filter((i) => done[i.id]).length;

  return (
    <section
      className="rounded-lg border border-border bg-card p-4 text-sm"
      aria-label="Progress checklist"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Fremgang
        </h3>
        <span className="text-xs text-muted-foreground">
          {completed}/{items.length}
        </span>
      </header>
      <ul className="space-y-1">
        {items.map((item) => {
          const isDone = !!done[item.id];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-muted"
                aria-pressed={isDone}
              >
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isDone
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40"
                  }`}
                  aria-hidden="true"
                >
                  {isDone && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  )}
                </span>
                <span className={isDone ? "text-muted-foreground line-through" : ""}>
                  {item.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        Du bestemmer selv hvornår en delopgave er klar — markeringen er kun til
        din egen oversigt.
      </p>
    </section>
  );
}
