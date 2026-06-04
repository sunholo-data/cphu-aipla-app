/**
 * Boldkast integration test (sprint SIM-ERGONOMICS M5).
 *
 * Verifies the full event vocabulary of the Boldkast artefact flows
 * correctly through the dual-stage pipeline:
 *
 *   iframe postMessage(kind)
 *     → BoldkastSimFrame.handleStructuredContent (denylist filter via
 *       useArtefactReportEvent)
 *     → reportEvent (snapshot hook input)
 *     → mapArtefactKindToMeaningful (proactive-event-check mapper)
 *
 * For each emitted kind, asserts the routing decision (forward vs drop)
 * AND the mapper output (sim_run / step_advance / measurement_commit /
 * null). This is the regression bar: if a future PR breaks any sim's
 * proactive-reactive wiring, this test fails before merge — today's
 * "only Boldkast works" issue would have been caught at PR time.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { mapArtefactKindToMeaningful } from "@/lib/proactiveEventCheck";

import { BoldkastSimFrame } from "../BoldkastSimFrame";

const SANDBOX_ORIGIN = "https://aipla-v01-sandbox-test.run.app";

function dispatchUpdateModelContext(structuredContent: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        jsonrpc: "2.0",
        method: "ui/update-model-context",
        params: { structuredContent },
      },
      origin: SANDBOX_ORIGIN,
    }),
  );
}

interface BoldkastCase {
  /** Kind emitted by the artefact (or hypothetically emitted — covers
   *  bug-class regressions for kinds the host doesn't currently see). */
  kind: string;
  /** Extra fields the artefact sends alongside the kind. */
  extra?: Record<string, unknown>;
  /** Expect the host to forward this kind through to reportEvent? */
  forwarded: boolean;
  /** mapArtefactKindToMeaningful's expected output for this kind. */
  mapped: "sim_run" | "step_advance" | "measurement_commit" | null;
  /** Optional doc for what this case proves. */
  why?: string;
}

const BOLDKAST_CASES: BoldkastCase[] = [
  // --- Forwarded by host, mapped to meaningful kinds ---
  {
    kind: "boldkast.play",
    forwarded: true,
    mapped: "sim_run",
    why: "play is the canonical sim_run signal — was silently dropped before sprint PROACTIVE-SIM-REACTIVE M8",
  },
  {
    kind: "boldkast.show_value",
    extra: { marker: "range", revealed: true },
    forwarded: true,
    mapped: "measurement_commit",
    why: "show_value carries the marker reveal; show_value token in MEASUREMENT_COMMIT_TOKENS",
  },
  // --- Forwarded by host, NOT meaningful for proactive turns ---
  {
    kind: "boldkast.open",
    forwarded: true,
    mapped: null,
    why: "open is lifecycle, not progress — snapshot hook tracks it, proactive doesn't fire",
  },
  {
    kind: "boldkast.state-change",
    extra: { changed: ["v0"], state: { v0: 10, theta: 45, g: 9.81 } },
    forwarded: true,
    mapped: null,
    why: "state-change is debounced noise, not progress",
  },
  // --- Dropped by host (don't reach the snapshot hook) ---
  {
    kind: "boldkast.pause",
    forwarded: false,
    mapped: null,
    why: "pause is undo / hesitation — dropped by host denylist",
  },
  {
    kind: "boldkast.reset",
    forwarded: false,
    mapped: null,
    why: "reset is undo — dropped by host denylist",
  },
  // --- Forward-compat: a hypothetical new kind flows through the
  // default-through path AND maps correctly if it matches a token ---
  {
    kind: "boldkast.measure",
    extra: { value: 12.3 },
    forwarded: true,
    mapped: "measurement_commit",
    why: "future kind: default-through path forwards it; 'measure' matches MEASUREMENT_COMMIT_TOKENS",
  },
];

describe("BoldkastSimFrame integration — proactive-reactive routing matrix", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>art</body></html>", {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;
  });

  for (const c of BOLDKAST_CASES) {
    it(`${c.kind} → forwarded=${c.forwarded}, mapped=${c.mapped ?? "null"}${c.why ? ` (${c.why})` : ""}`, () => {
      const reportEvent = vi.fn();
      render(
        <BoldkastSimFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      // Sanity: the frame mounts. (forces lazy renders to commit before
      // the postMessage event arrives.)
      expect(screen.getByTitle(/Boldkast/i)).toBeTruthy();

      dispatchUpdateModelContext({ kind: c.kind, ...(c.extra ?? {}) });

      if (c.forwarded) {
        expect(reportEvent).toHaveBeenCalledTimes(1);
      } else {
        expect(reportEvent).not.toHaveBeenCalled();
      }

      expect(mapArtefactKindToMeaningful(c.kind)).toBe(c.mapped);
    });
  }
});
