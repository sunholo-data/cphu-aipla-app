"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/apiClient";

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
  /** Active chat session id. When set, every toggle pushes the new
   * snapshot to /api/sessions/{id}/iframe-context so the agent's next
   * turn sees which sub-parts the student has marked done (and the
   * sub-part labels, so the agent doesn't have to correlate IDs back
   * to system-prompt text). When null, the component still works
   * locally but the agent sees nothing. */
  sessionId?: string | null;
}

const KEY_PREFIX = "aipla.progress:";

/**
 * ProgressChecklist — student-driven sub-part tracker for the AIPLA
 * Workshop. Each item has a "Marker som klar" button; toggling it
 * stores done-state in sessionStorage so the student sees their
 * progress visually across the session.
 *
 * Pedagogical principle: student-driven, not auto-graded. The agent
 * does NOT decide what's done; the student does. With `sessionId`
 * set, the agent ALSO sees what the student claims to have finished
 * so it can scaffold ("great, you finished a — want to start b?")
 * without having to infer from conversation. The reveal is still
 * student-initiated.
 */
export function ProgressChecklist({ skillId, items, sessionId }: ProgressChecklistProps) {
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

  const pushSnapshot = (doneMap: Record<string, boolean>) => {
    if (!sessionId) return;
    const doneIds = items.filter((i) => doneMap[i.id]).map((i) => i.id);
    const body = {
      serverId: "progress",
      toolName: "state",
      // Include both ids AND labels so the agent's prompt is self-describing
      // (no correlation to system-prompt text required). v1 sources items
      // from SkillConfig.problemDefinition.subparts; for v0.1 we lift the
      // hardcoded BOLDKAST_SUBPARTS into the push payload.
      structuredContent: {
        done: doneIds,
        items: items.map((i) => ({ id: i.id, label: i.label })),
        total: items.length,
      },
    };
    void fetchWithAuth(`/api/proxy/api/sessions/${sessionId}/iframe-context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[progress] iframe-context push failed:", err);
      }
    });
  };

  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      }
      pushSnapshot(next);
      return next;
    });
  };

  // Catch-up push when sessionId arrives. Students often interact with
  // the workspace BEFORE sending their first chat message — at that
  // point sessionId is null and the push short-circuits. The moment a
  // session is created (first chat turn), push the accumulated done-set
  // so the agent's next prompt sees the prior interactions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sessionId) return;
    const hasAny = Object.values(done).some(Boolean);
    if (!hasAny) return;
    pushSnapshot(done);
    // Intentionally NOT re-running when `done` changes — toggle() handles
    // those pushes directly. Only run on sessionId arrival.
  }, [sessionId]);

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
