"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";

import type {
  LedPlanckEvent,
  LedPlanckReading,
} from "@/hooks/useLedPlanckSnapshot";

import {
  StaticArtefactFrame,
  type StaticArtefactFrameHandle,
} from "./StaticArtefactFrame";

export interface LedPlanckLabFrameHandle {
  sendChatFlush: () => void;
}

interface LedPlanckStructuredContent {
  kind: string;
  step?: number;
  stepName?: string;
  component?: string;
  correct?: boolean;
  changed?: string[];
  state?: { voltage?: number };
  triggeredBy?: string;
  led?: string;
  I?: number;
  U?: number;
  Vs?: number;
  points?: LedPlanckReading[];
  u0?: number;
  lambda?: number;
}

interface LedPlanckLabFrameProps {
  sandboxOrigin: string;
  onClose: () => void;
  /** Bench events (step-change, component-placed, polarity-error,
   *  state-change, reading, auto-run, fit, spectrum, calibrated) route
   *  here into the shared snapshot hook. The measurement event comes
   *  from the React Results surface, not the iframe. */
  reportEvent: (evt: LedPlanckEvent) => void;
}

/**
 * LedPlanckLabFrame — host wrapper around the bench-ONLY LED Planck
 * iframe. After the middle-path workbench split the iframe keeps the
 * live apparatus (bench + I-U graph + spectrum) and emits raw lab data;
 * the measurement table + h-results live in the React workbench. This
 * Frame no longer accumulates the snapshot (useLedPlanckSnapshot does) —
 * it only routes the iframe's events to reportEvent and flushes pending
 * slider changes on chat-submit. Mirrors KineBotFrame.
 */
export const LedPlanckLabFrame = forwardRef<
  LedPlanckLabFrameHandle,
  LedPlanckLabFrameProps
>(function LedPlanckLabFrame({ sandboxOrigin, onClose, reportEvent }, ref) {
  const staticFrameRef = useRef<StaticArtefactFrameHandle | null>(null);
  const reportEventRef = useRef(reportEvent);
  reportEventRef.current = reportEvent;

  const handleStructuredContent = useCallback(
    (structuredContent: Record<string, unknown>) => {
      const data = structuredContent as unknown as LedPlanckStructuredContent;
      const kind = data.kind;
      const report = reportEventRef.current;

      switch (kind) {
        case "led-planck.step-change":
          if (typeof data.step === "number" && typeof data.stepName === "string") {
            report({
              kind: "led-planck.step-change",
              step: data.step,
              stepName: data.stepName,
            });
          }
          break;
        case "led-planck.component-placed":
          if (typeof data.component === "string") {
            report({
              kind: "led-planck.component-placed",
              component: data.component,
              correct: data.correct === true,
            });
          }
          break;
        case "led-planck.led-polarity-error":
          report({ kind: "led-planck.led-polarity-error" });
          break;
        case "led-planck.state-change":
          report({
            kind: "led-planck.state-change",
            changed: data.changed,
            state: data.state,
            triggeredBy: data.triggeredBy,
          });
          break;
        case "led-planck.reading":
          if (
            typeof data.led === "string" &&
            typeof data.I === "number" &&
            typeof data.U === "number" &&
            typeof data.Vs === "number"
          ) {
            report({
              kind: "led-planck.reading",
              led: data.led,
              I: data.I,
              U: data.U,
              Vs: data.Vs,
            });
          }
          break;
        case "led-planck.auto-run":
          if (typeof data.led === "string" && Array.isArray(data.points)) {
            report({
              kind: "led-planck.auto-run",
              led: data.led,
              points: data.points,
            });
          }
          break;
        case "led-planck.fit":
          if (typeof data.led === "string" && typeof data.u0 === "number") {
            report({ kind: "led-planck.fit", led: data.led, u0: data.u0 });
          }
          break;
        case "led-planck.spectrum":
          if (typeof data.led === "string" && typeof data.lambda === "number") {
            report({
              kind: "led-planck.spectrum",
              led: data.led,
              lambda: data.lambda,
            });
          }
          break;
        case "led-planck.calibrated":
          report({ kind: "led-planck.calibrated" });
          break;
      }
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      sendChatFlush: () => {
        staticFrameRef.current?.sendNotification(
          "ui/notifications/chat-flush",
          {},
        );
      },
    }),
    [],
  );

  return (
    <div className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          LED og Plancks konstant — virtuelt laboratorium
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Luk laboratorium"
        >
          Luk
        </button>
      </header>
      <StaticArtefactFrame
        ref={staticFrameRef}
        sandboxOrigin={sandboxOrigin}
        artefactPath="led-planck/v1"
        onUpdateModelContext={handleStructuredContent}
        title="LED Planck virtual lab"
        className="w-full min-h-[1100px] border-0"
      />
    </div>
  );
});
