"use client";

import { forwardRef, useImperativeHandle, useRef } from "react";

import { useArtefactReportEvent } from "@/hooks/useArtefactReportEvent";
import type {
  LedPlanckEvent,
  LedPlanckReading,
} from "@/hooks/useLedPlanckSnapshot";

import { SimFrameHeader } from "./SimFrameHeader";
import {
  StaticArtefactFrame,
  type StaticArtefactFrameHandle,
} from "./StaticArtefactFrame";

export interface LedPlanckLabFrameHandle {
  sendChatFlush: () => void;
}

interface LedPlanckLabFrameProps {
  sandboxOrigin: string;
  onClose: () => void;
  /** Reports bench events (step-change, component-placed, polarity-error,
   *  state-change, reading, auto-run, fit, spectrum, calibrated) into the
   *  shared snapshot hook. Routing is denylist-shaped via
   *  useArtefactReportEvent. Today's LED Planck artefact emits no
   *  pause / reset noise kinds; the drop set is empty for now. New
   *  artefact kinds flow through the default-through path as `{kind}`. */
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
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const handleStructuredContent = useArtefactReportEvent<LedPlanckEvent>({
    report: reportEvent,
    // Today's artefact (index.html in led-planck/v1) emits no
    // pause / reset noise kinds — every emitted kind is a progress
    // signal or a typed lab-data event. led-polarity-error IS routed
    // (snapshot hook tracks it for the error pill display) — only
    // the proactive-event-check mapper treats it as null.
    drop: new Set([
      // measurement is dispatched from the React Results surface
      // (workbench), not the iframe. If the iframe ever emits it,
      // it's a duplicate / desync — drop it on the iframe side.
      "led-planck.measurement",
    ]),
    narrow: {
      "led-planck.step-change": (d) =>
        typeof d.step === "number" && typeof d.stepName === "string"
          ? {
              kind: "led-planck.step-change",
              step: d.step,
              stepName: d.stepName,
            }
          : null,
      "led-planck.component-placed": (d) =>
        typeof d.component === "string"
          ? {
              kind: "led-planck.component-placed",
              component: d.component,
              correct: d.correct === true,
            }
          : null,
      "led-planck.state-change": (d) => ({
        kind: "led-planck.state-change",
        changed: d.changed as string[] | undefined,
        state: d.state as { voltage?: number } | undefined,
        triggeredBy: d.triggeredBy as string | undefined,
      }),
      "led-planck.reading": (d) =>
        typeof d.led === "string" &&
        typeof d.I === "number" &&
        typeof d.U === "number" &&
        typeof d.Vs === "number"
          ? {
              kind: "led-planck.reading",
              led: d.led,
              I: d.I,
              U: d.U,
              Vs: d.Vs,
            }
          : null,
      "led-planck.auto-run": (d) =>
        typeof d.led === "string" && Array.isArray(d.points)
          ? {
              kind: "led-planck.auto-run",
              led: d.led,
              points: d.points as LedPlanckReading[],
            }
          : null,
      "led-planck.fit": (d) =>
        typeof d.led === "string" && typeof d.u0 === "number"
          ? { kind: "led-planck.fit", led: d.led, u0: d.u0 }
          : null,
      "led-planck.spectrum": (d) =>
        typeof d.led === "string" && typeof d.lambda === "number"
          ? {
              kind: "led-planck.spectrum",
              led: d.led,
              lambda: d.lambda,
            }
          : null,
    },
    // led-planck.led-polarity-error and led-planck.calibrated flow
    // through as {kind} via the default-through path (no payload).
  });

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
    <div ref={wrapperRef} className="flex min-h-0 flex-col bg-background">
      <SimFrameHeader
        title="LED og Plancks konstant — virtuelt laboratorium"
        closeLabel="Luk"
        closeAriaLabel="Luk laboratorium"
        fullscreenAriaLabel="Skift fuldskærm"
        onClose={onClose}
        fullscreenTarget={wrapperRef.current}
      />
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
