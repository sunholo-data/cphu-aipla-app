"use client";

import { useEffect, useState } from "react";
import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";

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
interface ProgressSnapshot {
  done: string[];
  items: { id: string; label: string }[];
  total: number;
}

export function ProgressChecklist({ skillId, items, sessionId }: ProgressChecklistProps) {
  const storageKey = KEY_PREFIX + skillId;
  const [done, setDone] = useState<Record<string, boolean>>({});
  // Sprint PROACTIVE-SIM-REACTIVE M8-fix #2: route through the shared
  // useSimSnapshotPush so checklist toggles ALSO fire the
  // proactive-event-check gate. Picks up the chat page's
  // ProactiveSimProvider wiring automatically.
  const pushChecklistSnapshot = useSimSnapshotPush<ProgressSnapshot>(
    sessionId ?? null,
    "progress",
  );
  const humanToolEvents = useHumanToolEvents();

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

  const buildSnapshot = (doneMap: Record<string, boolean>): ProgressSnapshot => ({
    done: items.filter((i) => doneMap[i.id]).map((i) => i.id),
    // Include both ids AND labels so the agent's prompt is self-describing
    // (no correlation to system-prompt text required). Items are the
    // activity's teacher-authored `checklist` element (USR-1: sourced from
    // activity config, no longer a hardcoded per-sim constant).
    items: items.map((i) => ({ id: i.id, label: i.label })),
    total: items.length,
  });

  const pushSnapshotRequest = (
    doneMap: Record<string, boolean>,
    kind: string,
  ): Promise<Response> | null => {
    return pushChecklistSnapshot(buildSnapshot(doneMap), kind);
  };

  // Fire the push silently — used by catch-up effect when sessionId
  // arrives. No card is dispatched because this is automatic state
  // sync, not a deliberate student action. Kind = "progress.sync" so
  // the suffix doesn't match step/next/advance — the mapper correctly
  // skips this push for the proactive gate-check (no tutor turn on
  // sessionStorage rehydration).
  const pushSnapshotSilent = (doneMap: Record<string, boolean>) => {
    const req = pushSnapshotRequest(doneMap, "progress.sync");
    if (!req) return;
    void req.catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[progress] iframe-context push failed:", err);
      }
    });
  };

  const toggle = (id: string) => {
    // Compute `next` from current `done` outside the setter so the
    // side-effects (sessionStorage write, network POST, card dispatch)
    // run during the click handler, NOT during a render-triggered
    // state-updater call. React strict-mode flags the latter because
    // dispatching to a sibling component (HumanToolEventsProvider)
    // mid-render of ProgressChecklist is illegal — caught live on
    // 2026-05-21 during M3 manual verification.
    const next = { ...done, [id]: !done[id] };
    const becomingDone = !!next[id];
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
    }
    // Kind: marking done → "progress.advance" (suffix matches *.advance
    // pattern → maps to step_advance → fires proactive gate-check, so
    // the tutor can react to the student claiming completion). Marking
    // undone → "progress.undo" (doesn't map to anything meaningful;
    // gate-check silently skipped because un-marking isn't progress).
    const kind = becomingDone ? "progress.advance" : "progress.undo";
    const req = pushSnapshotRequest(next, kind);
    if (req) {
      // The toggle is a deliberate student action — surface the push
      // status in the chat via a human-tool-use card so the student
      // sees their action was registered with the agent.
      const item = items.find((i) => i.id === id);
      const sublabel = item?.label ?? id;
      const label = becomingDone
        ? `Markerede '${sublabel}' som klar`
        : `Fjernede '${sublabel}' fra klare`;
      humanToolEvents.dispatch({ label, push: () => req });
    }
    setDone(next);
  };

  // Catch-up push when sessionId arrives. Students often interact with
  // the workspace BEFORE sending their first chat message — at that
  // point sessionId is null and the push short-circuits. The moment a
  // session is created (first chat turn), push the accumulated done-set
  // so the agent's next prompt sees the prior interactions.
  useEffect(() => {
    if (!sessionId) return;
    const hasAny = Object.values(done).some(Boolean);
    if (!hasAny) return;
    pushSnapshotSilent(done);
    // Intentionally NOT re-running when `done` changes — toggle() handles
    // those pushes directly. Only run on sessionId arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
