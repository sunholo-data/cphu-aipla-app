"use client";

import { useCallback, useRef } from "react";

/**
 * useArtefactReportEvent — denylist-shaped filter for per-artefact-frame
 * structuredContent → reportEvent routing.
 *
 * **Problem this solves.** Per-artefact frames (BoldkastSimFrame,
 * LedPlanckLabFrame, KineBotFrame) historically used an *allowlist*
 * filter: an explicit `if (kind === "...") report({...})` chain that
 * forwarded only the kinds the author thought of. The bug class:
 * when the artefact starts emitting a new kind, the host silently
 * drops it (no error, no warning) and any proactive-reactive wiring
 * that depends on that kind never fires. Three concrete instances
 * during sprint PROACTIVE-SIM-REACTIVE: Boldkast's `play`, KineBot's
 * `sim-run`, LED Planck's `auto-run` / `step-change` / `reading` /
 * `fit` / `spectrum` all needed the author to remember to add a route.
 *
 * **Inversion.** This helper flips the filter from allowlist to
 * **denylist**: the caller declares *which kinds to drop* (noise:
 * pause / reset / errors / debounced state syncs) and *which kinds
 * carry typed payloads* (via per-kind narrowers). Everything else
 * flows through as `{kind}` with no extra payload — the
 * default-through path. New event kinds the artefact starts emitting
 * later automatically reach the snapshot hook without a code edit on
 * the host.
 *
 * **Why this is safe.** Snapshot hooks already type their event
 * union to include every kind they care about; if the artefact emits
 * a kind the union doesn't include, the snapshot hook's switch
 * statement falls through (no-op) — same outcome as today's
 * allowlist drop. The cost of the new default-through path is one
 * extra (kind-only) event reaching the snapshot hook for the rare
 * unknown-kind case; that's far cheaper than silently breaking
 * proactive turns for kinds the author didn't think of.
 *
 * **Generic param `TEvent`.** Each caller types this to its own
 * snapshot hook's event union (`BoldkastEvent`, `LedPlanckEvent`,
 * `KineBotEvent`, …). The default-through path casts `{kind: string}`
 * to `TEvent` — safe because the snapshot hook tolerates unknown
 * kinds (see "Why this is safe" above).
 *
 * See `docs/design/aipla/v1.1.0-feedback/sim-onboarding-ergonomics.md`
 * for the design rationale and the new-sim author checklist.
 */
export interface UseArtefactReportEventArgs<TEvent extends { kind: string }> {
  /** Snapshot-hook callback — same signature as the per-frame
   *  `reportEvent` prop. Captured via internal ref so the returned
   *  forwarder identity stays stable even when this prop swaps. */
  report: (evt: TEvent) => void;
  /** Kinds to silently drop. Typical entries: `<sim>.pause`,
   *  `<sim>.reset`, `<sim>.*-error`, and any debounced state-sync
   *  kinds the host doesn't want pushed every frame. */
  drop?: ReadonlySet<string>;
  /** Per-kind shape narrowers. Each function receives the raw
   *  `structuredContent` cast to `Record<string, unknown>` and returns
   *  either a typed `TEvent` (forward it) or `null` (drop — failed
   *  shape validation, treat as if the artefact had emitted a noise
   *  kind). Kinds NOT present in `narrow` AND NOT present in `drop`
   *  flow through as `{kind}` with no extra payload. */
  narrow?: Record<string, (data: Record<string, unknown>) => TEvent | null>;
}

/**
 * Returns a memoized `handleStructuredContent` callback the caller
 * passes to `<StaticArtefactFrame onUpdateModelContext={...}>`. The
 * callback is stable across renders (memoized once); `report` prop
 * changes are handled via an internal ref so they don't invalidate
 * the StaticArtefactFrame's effect dep arrays.
 */
export function useArtefactReportEvent<TEvent extends { kind: string }>(
  args: UseArtefactReportEventArgs<TEvent>,
): (structuredContent: Record<string, unknown>) => void {
  const { report, drop, narrow } = args;

  const reportRef = useRef(report);
  reportRef.current = report;
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;

  return useCallback((structuredContent: Record<string, unknown>) => {
    const kindRaw = structuredContent.kind;
    if (typeof kindRaw !== "string" || kindRaw === "") {
      return;
    }
    const kind = kindRaw;

    if (dropRef.current?.has(kind)) {
      return;
    }

    const narrower = narrowRef.current?.[kind];
    if (narrower) {
      const narrowed = narrower(structuredContent);
      if (narrowed === null) {
        return;
      }
      reportRef.current(narrowed);
      return;
    }

    reportRef.current({ kind } as TEvent);
  }, []);
}
