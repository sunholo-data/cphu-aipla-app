/**
 * KineBot integration test (sprint SIM-ERGONOMICS M5).
 *
 * Verifies the full event vocabulary of the KineBot artefact flows
 * correctly through the dual-stage pipeline:
 *
 *   iframe postMessage(kind)
 *     → KineBotFrame.handleStructuredContent (denylist filter via
 *       useArtefactReportEvent)
 *     → reportEvent (snapshot hook input)
 *     → mapArtefactKindToMeaningful (proactive-event-check mapper)
 *
 * Pre-2026-06-04 the kinebot.sim-run kind returned null from the mapper
 * because the suffix `sim-run` didn't match the single-keyword token
 * comparison. The mapper now tokenizes on `-` and `_`; this test pins
 * the fix.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { mapArtefactKindToMeaningful } from "@/lib/proactiveEventCheck";

import { KineBotFrame } from "../KineBotFrame";

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

interface KineBotCase {
  kind: string;
  extra?: Record<string, unknown>;
  forwarded: boolean;
  mapped: "sim_run" | "step_advance" | "measurement_commit" | null;
  why?: string;
}

const KINEBOT_CASES: KineBotCase[] = [
  // --- sim_run ---
  {
    kind: "kinebot.sim-run",
    extra: { simType: "1d", params: { v0: 5, a: 2 } },
    forwarded: true,
    mapped: "sim_run",
    why: "sim-run via tokenized 'run' keyword — the user-reported gap that triggered the mapper-tokenization fix",
  },
  // --- Forwarded but not meaningful ---
  {
    kind: "kinebot.state-change",
    extra: {
      changed: ["v0"],
      state: { v0: 5 },
      triggeredBy: "slider",
    },
    forwarded: true,
    mapped: null,
    why: "state-change is debounced slider noise",
  },
  // --- Dropped by host (those events come from the React workbench) ---
  {
    kind: "kinebot.graph-change",
    extra: { graphType: "vt" },
    forwarded: false,
    mapped: null,
    why: "graph-change comes from React workbench, not the iframe — drop on iframe side",
  },
  {
    kind: "kinebot.quiz-attempt",
    extra: { questionId: "q1", correct: true },
    forwarded: false,
    mapped: null,
    why: "quiz-attempt comes from React workbench, not the iframe — drop on iframe side",
  },
  // --- Forward-compat: hypothetical future kinds light up via token vocab ---
  {
    kind: "kinebot.next",
    forwarded: true,
    mapped: "step_advance",
    why: "future kind: default-through forwards; 'next' matches STEP_ADVANCE_TOKENS",
  },
  {
    kind: "kinebot.measure",
    forwarded: true,
    mapped: "measurement_commit",
    why: "future kind: default-through forwards; 'measure' matches MEASUREMENT_COMMIT_TOKENS",
  },
];

describe("KineBotFrame integration — proactive-reactive routing matrix", () => {
  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response("<!doctype html><html><body>art</body></html>", {
          status: 200,
        }),
      ),
    ) as unknown as typeof fetch;
  });

  for (const c of KINEBOT_CASES) {
    it(`${c.kind} → forwarded=${c.forwarded}, mapped=${c.mapped ?? "null"}${c.why ? ` (${c.why})` : ""}`, () => {
      const reportEvent = vi.fn();
      render(
        <KineBotFrame
          sandboxOrigin={SANDBOX_ORIGIN}
          topic="linear"
          reportEvent={reportEvent}
          onClose={() => {}}
        />,
      );
      expect(screen.getByTitle(/KineBot/i)).toBeTruthy();

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
