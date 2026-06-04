/**
 * LED Planck integration test (sprint SIM-ERGONOMICS M5).
 *
 * Verifies the full event vocabulary of the LED Planck artefact flows
 * correctly through the dual-stage pipeline:
 *
 *   iframe postMessage(kind)
 *     → LedPlanckLabFrame.handleStructuredContent (denylist filter via
 *       useArtefactReportEvent)
 *     → reportEvent (snapshot hook input)
 *     → mapArtefactKindToMeaningful (proactive-event-check mapper)
 *
 * Pre-2026-06-04 the mapper compared the whole suffix against
 * single-word keywords, so multi-word kinds like `led-planck.auto-run`
 * and `led-planck.step-change` returned null and proactive turns
 * silently never fired for LED Planck. The mapper now tokenizes the
 * suffix; these test cases pin the fix so it can't regress.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { mapArtefactKindToMeaningful } from "@/lib/proactiveEventCheck";

import { LedPlanckLabFrame } from "../LedPlanckLabFrame";

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

interface LedPlanckCase {
  kind: string;
  extra?: Record<string, unknown>;
  forwarded: boolean;
  mapped: "sim_run" | "step_advance" | "measurement_commit" | null;
  why?: string;
}

const LED_PLANCK_CASES: LedPlanckCase[] = [
  // --- sim_run ---
  {
    kind: "led-planck.auto-run",
    extra: { led: "red", points: [] },
    forwarded: true,
    mapped: "sim_run",
    why: "auto-run is the canonical 'student kicked off automatic collection' = sim_run",
  },
  // --- step_advance ---
  {
    kind: "led-planck.step-change",
    extra: { step: 1, stepName: "part1" },
    forwarded: true,
    mapped: "step_advance",
    why: "step-change marks progression through the lab steps",
  },
  {
    kind: "led-planck.component-placed",
    extra: { component: "led", correct: true },
    forwarded: true,
    mapped: "step_advance",
    why: "component-placed via 'placed' token → step setup progress",
  },
  {
    kind: "led-planck.calibrated",
    forwarded: true,
    mapped: "step_advance",
    why: "calibrated via 'calibrated' token → setup step",
  },
  // --- measurement_commit ---
  {
    kind: "led-planck.reading",
    extra: { led: "red", I: 0.01, U: 1.8, Vs: 3.0 },
    forwarded: true,
    mapped: "measurement_commit",
    why: "reading captures a single I-U datapoint",
  },
  {
    kind: "led-planck.fit",
    extra: { led: "red", u0: 1.99 },
    forwarded: true,
    mapped: "measurement_commit",
    why: "fit commits the U0 estimate from the I-U fit",
  },
  {
    kind: "led-planck.spectrum",
    extra: { led: "red", lambda: 625 },
    forwarded: true,
    mapped: "measurement_commit",
    why: "spectrum captures peak wavelength",
  },
  // --- Forwarded but mapped null (lifecycle / noise) ---
  {
    kind: "led-planck.state-change",
    extra: { changed: ["voltage"], state: { voltage: 3.5 } },
    forwarded: true,
    mapped: null,
    why: "state-change is debounced slider noise",
  },
  {
    kind: "led-planck.led-polarity-error",
    forwarded: true,
    mapped: null,
    why: "polarity-error is an error pill display, not progress — host forwards (snapshot tracks it), mapper returns null",
  },
  // --- Dropped by host (don't reach the snapshot hook) ---
  {
    kind: "led-planck.measurement",
    extra: { data: { led: "red", u0: 1.99, lambda: 625, h_computed: 6.6e-34 } },
    forwarded: false,
    mapped: null,
    why: "measurement is dispatched from the React Results surface, not the iframe — drop on iframe side to prevent desync",
  },
];

describe("LedPlanckLabFrame integration — proactive-reactive routing matrix", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>art</body></html>", {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;
  });

  for (const c of LED_PLANCK_CASES) {
    it(`${c.kind} → forwarded=${c.forwarded}, mapped=${c.mapped ?? "null"}${c.why ? ` (${c.why})` : ""}`, () => {
      const reportEvent = vi.fn();
      render(
        <LedPlanckLabFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          onClose={() => {}}
          reportEvent={reportEvent}
        />,
      );
      expect(screen.getByTitle(/LED Planck/i)).toBeTruthy();

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
