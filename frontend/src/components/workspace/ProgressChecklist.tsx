"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";
import { fetchWithAuth } from "@/lib/apiClient";
import type { ChecklistItem } from "@/lib/elementTypes";

// Canonical ChecklistItem (lib/elementTypes), re-exported for existing importers
// of this module.
export type { ChecklistItem };

/** Who marked a step. `ai` is the tutor's read (1.1.62 M3); `student` is the
 *  student's own, and always wins — overriding an AI tick flips it to this. */
export type ChecklistTickedBy = "student" | "ai";

export interface ChecklistItemState {
  done?: boolean;
  by?: ChecklistTickedBy;
  /** One sentence of why, on AI ticks only. */
  evidence?: string;
}

interface ProgressChecklistProps {
  /** Skill id — scopes the local fallback storage key. */
  skillId: string;
  /** Activity id — the key the per-group tick store is addressed by. */
  activityId?: string;
  /** Sub-parts of the problem, from the activity's `checklist` element. */
  items: ChecklistItem[];
  /** Active chat session id. When set, every toggle pushes the new snapshot to
   * /api/sessions/{id}/iframe-context so the agent's next turn sees which
   * sub-parts are marked done. When null the component still works locally. */
  sessionId?: string | null;
  /** Per-group tick state, fetched by the chat page and refetched at turn end
   * so a tick the TUTOR just made appears without a reload. Absent in the
   * builder preview (no group), where the local fallback takes over. */
  itemStates?: Record<string, ChecklistItemState>;
}

const KEY_PREFIX = "aipla.progress:";

/**
 * ProgressChecklist — the activity's checklist, which is also its **ILOs**
 * (intended learning outcomes; Aswin confirmed the mapping on 2026-08-06).
 *
 * **The AI helps auto-grade** (M, 2026-08-06, following Aswin's ask). This
 * component previously carried the opposite principle — "student-driven, not
 * auto-graded; the agent does NOT decide what's done" — and that is now
 * superseded. The tutor marks steps from evidence in the conversation via
 * `mark_checklist_item`, each mark carrying one sentence of why.
 *
 * What survives is the **student's override**: an AI tick is rendered as the
 * tutor's read, with its reason, and tapping it hands the step back to the
 * student (`by` flips to `student`). The tutor helps; it does not adjudicate.
 *
 * **State lives per GROUP, not per browser** (1.1.62 M3). It used to live in
 * `sessionStorage` keyed by skill, which meant three students in one group had
 * three private checklists that died with the tab — wrong ever since 1.1.53
 * established that the primary classroom shape is one group across separate
 * devices. Ticks now round-trip `checklist_progress/{group}:{activity}`.
 * `sessionStorage` remains ONLY as the builder-preview fallback, where there is
 * no group to record against.
 */
interface ProgressSnapshot {
  done: string[];
  items: { id: string; label: string }[];
  total: number;
}

export function ProgressChecklist({
  skillId,
  activityId,
  items,
  sessionId,
  itemStates,
}: ProgressChecklistProps) {
  const storageKey = KEY_PREFIX + skillId;
  // Server-backed when we have a group (itemStates supplied); local otherwise.
  const serverBacked = !!activityId && !!itemStates;
  const [localDone, setLocalDone] = useState<Record<string, boolean>>({});
  // Optimistic overlay so a tap feels instant while the POST is in flight —
  // the next fetch from the page reconciles it.
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const pushChecklistSnapshot = useSimSnapshotPush<ProgressSnapshot>(sessionId ?? null, "progress");
  const humanToolEvents = useHumanToolEvents();

  const doneFor = (id: string): boolean => {
    if (id in pending) return pending[id];
    if (serverBacked) return !!itemStates?.[id]?.done;
    return !!localDone[id];
  };
  const tickedByFor = (id: string): ChecklistTickedBy | undefined =>
    id in pending ? "student" : itemStates?.[id]?.by;

  useEffect(() => {
    if (serverBacked || typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") setLocalDone(parsed as Record<string, boolean>);
    } catch {
      // Stale/garbage data — ignore. New writes will overwrite.
    }
  }, [storageKey, serverBacked]);

  // Drop the optimistic overlay once the server state agrees with it.
  useEffect(() => {
    if (!serverBacked) return;
    setPending((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, want] of Object.entries(prev)) {
        if (!!itemStates?.[id]?.done === want) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [itemStates, serverBacked]);

  const buildSnapshot = (doneIds: string[]): ProgressSnapshot => ({
    done: doneIds,
    // ids AND labels so the agent's prompt is self-describing.
    items: items.map((i) => ({ id: i.id, label: i.label })),
    total: items.length,
  });

  const currentDoneIds = (override?: { id: string; done: boolean }): string[] =>
    items
      .filter((i) => (override && i.id === override.id ? override.done : doneFor(i.id)))
      .map((i) => i.id);

  const pushSnapshotSilent = () => {
    const req = pushChecklistSnapshot(buildSnapshot(currentDoneIds()), "progress.sync");
    if (!req) return;
    void req.catch((err) => {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[progress] iframe-context push failed:", err);
      }
    });
  };

  const toggle = (id: string) => {
    const becomingDone = !doneFor(id);

    if (serverBacked && activityId) {
      setPending((p) => ({ ...p, [id]: becomingDone }));
      void fetchWithAuth(
        `/api/proxy/api/activities/${encodeURIComponent(activityId)}/checklist-progress`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId: id, done: becomingDone }),
        },
      ).catch((err) => {
        // Roll the optimistic tick back — a tick that silently didn't save is
        // worse than one that visibly failed.
        setPending((p) => {
          const next = { ...p };
          delete next[id];
          return next;
        });
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[progress] tick save failed:", err);
        }
      });
    } else if (typeof window !== "undefined") {
      const next = { ...localDone, [id]: becomingDone };
      window.sessionStorage.setItem(storageKey, JSON.stringify(next));
      setLocalDone(next);
    }

    // Kind: marking done → "progress.advance" (maps to step_advance → fires the
    // proactive gate-check). Un-marking → "progress.undo" (not progress).
    const kind = becomingDone ? "progress.advance" : "progress.undo";
    const req = pushChecklistSnapshot(buildSnapshot(currentDoneIds({ id, done: becomingDone })), kind);
    if (req) {
      // A deliberate student action — card it so the student sees their action
      // reached the agent (workbench-element-builder: push AND card).
      const label = becomingDone
        ? `Markerede '${items.find((i) => i.id === id)?.label ?? id}' som klar`
        : `Fjernede '${items.find((i) => i.id === id)?.label ?? id}' fra klare`;
      humanToolEvents.dispatch({ label, push: () => req });
    }
  };

  // Catch-up push when sessionId arrives: students often work the workspace
  // BEFORE their first chat message, when sessionId is null and pushes
  // short-circuit.
  useEffect(() => {
    if (!sessionId) return;
    if (!items.some((i) => doneFor(i.id))) return;
    pushSnapshotSilent();
    // Only on sessionId arrival — toggle() handles its own pushes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const completed = items.filter((i) => doneFor(i.id)).length;

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
          const isDone = doneFor(item.id);
          const byAi = isDone && tickedByFor(item.id) === "ai";
          const evidence = byAi ? itemStates?.[item.id]?.evidence : undefined;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-muted"
                aria-pressed={isDone}
                title={evidence ? `AI: ${evidence}` : undefined}
              >
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isDone
                      ? byAi
                        ? "border-primary/60 bg-primary/50 text-primary-foreground"
                        : "border-primary bg-primary text-primary-foreground"
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
                <span className="min-w-0">
                  <span className={isDone ? "text-muted-foreground line-through" : ""}>
                    {item.label}
                  </span>
                  {byAi && (
                    <span
                      className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[10px] text-muted-foreground"
                      data-testid={`ai-marked-${item.id}`}
                    >
                      <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                      markeret af AI
                    </span>
                  )}
                  {evidence && (
                    <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                      {evidence}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
        {serverBacked
          ? "AI'en kan markere trin ud fra jeres samtale — tryk for at ændre en markering. Fremgangen deles med din gruppe."
          : "Du bestemmer selv hvornår en delopgave er klar — markeringen er kun til din egen oversigt."}
      </p>
    </section>
  );
}
