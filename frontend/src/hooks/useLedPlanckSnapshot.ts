"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { useSimSnapshotPush } from "@/hooks/useSimSnapshotPush";

export interface LedPlanckReading {
  I: number;
  U: number;
  Vs: number;
}

export interface LedPlanckMeasurement {
  led: string;
  u0: number;
  lambda: number;
  h_computed: number;
}

export interface LedPlanckSnapshot {
  lastEvent: string;
  currentStep: number | null;
  currentStepName: string | null;
  readings: Record<string, LedPlanckReading[]>;
  fits: Record<string, number>; // led -> U0
  spectra: Record<string, number>; // led -> lambda (nm)
  measurements: LedPlanckMeasurement[]; // saved h results
  componentsPlaced: string[];
  lastPolarityError: number | null;
  calibrated: boolean;
  voltage: number | null;
}

export type LedPlanckEvent =
  | { kind: "led-planck.step-change"; step: number; stepName: string }
  | { kind: "led-planck.component-placed"; component: string; correct: boolean }
  | { kind: "led-planck.led-polarity-error" }
  | {
      kind: "led-planck.state-change";
      changed?: string[];
      state?: { voltage?: number };
      triggeredBy?: string;
    }
  | { kind: "led-planck.reading"; led: string; I: number; U: number; Vs: number }
  | { kind: "led-planck.auto-run"; led: string; points: LedPlanckReading[] }
  | { kind: "led-planck.fit"; led: string; u0: number }
  | { kind: "led-planck.spectrum"; led: string; lambda: number }
  | { kind: "led-planck.calibrated" }
  | { kind: "led-planck.measurement"; data: LedPlanckMeasurement };

const LED_DA: Record<string, string> = {
  red: "rød",
  orange: "orange",
  yellow: "gul",
  green: "grøn",
  blue: "blå",
  infrared: "infrarød",
};

const COMPONENT_DA: Record<string, string> = {
  voltmeter: "voltmeter",
  ammeter: "amperemeter",
  led: "LED",
  resistor: "modstand",
  "power-supply": "strømforsyning",
  "current-probe": "strømprobe",
  "voltage-probe": "spændingsprobe",
};

const STEP_DA: Record<string, string> = {
  part1: "Begyndte I-U-måling",
  part2: "Begyndte spektroskopi",
  report: "Åbnede rapport",
};

export function ledDanish(led: string): string {
  return LED_DA[led] ?? led;
}

const INITIAL: LedPlanckSnapshot = {
  lastEvent: "",
  currentStep: null,
  currentStepName: null,
  readings: {},
  fits: {},
  spectra: {},
  measurements: [],
  componentsPlaced: [],
  lastPolarityError: null,
  calibrated: false,
  voltage: null,
};

export interface UseLedPlanckSnapshot {
  snapshot: LedPlanckSnapshot;
  reportEvent: (evt: LedPlanckEvent) => void;
}

/**
 * useLedPlanckSnapshot — shared source of truth for the LED Planck
 * workbench. The bench iframe reports sim events (step-change,
 * component-placed, polarity-error, state-change) AND raw lab data
 * (reading, auto-run, fit, spectrum, calibrated); the React Results
 * surface reports `measurement` when the student saves a computed h.
 * One reportEvent path → one snapshot → one iframe-context POST + card
 * dispatch. Mirrors useKineBotSnapshot.
 */
export function useLedPlanckSnapshot(
  sessionId: string | null,
): UseLedPlanckSnapshot {
  const humanToolEvents = useHumanToolEvents();
  const [snapshot, setSnapshot] = useState<LedPlanckSnapshot>(INITIAL);
  const snapshotRef = useRef<LedPlanckSnapshot>(snapshot);
  snapshotRef.current = snapshot;
  const pushSnapshotRequest = useSimSnapshotPush<LedPlanckSnapshot>(
    sessionId,
    "led-planck",
  );

  const reportEvent = useCallback(
    (evt: LedPlanckEvent) => {
      const prev = snapshotRef.current;
      const next: LedPlanckSnapshot = { ...prev, lastEvent: evt.kind };
      let pushedLabel: string | null = null;

      switch (evt.kind) {
        case "led-planck.step-change": {
          next.currentStep = evt.step;
          next.currentStepName = evt.stepName;
          pushedLabel = STEP_DA[evt.stepName] ?? null;
          break;
        }
        case "led-planck.component-placed": {
          if (evt.correct) {
            if (!prev.componentsPlaced.includes(evt.component)) {
              next.componentsPlaced = [...prev.componentsPlaced, evt.component];
            }
            pushedLabel = `Placerede ${COMPONENT_DA[evt.component] ?? evt.component}`;
          }
          // incorrect placement: silent push so the tutor sees the fumble
          break;
        }
        case "led-planck.led-polarity-error": {
          next.lastPolarityError = Date.now();
          pushedLabel = "Forsøgte LED med omvendt polaritet";
          break;
        }
        case "led-planck.state-change": {
          if (typeof evt.state?.voltage === "number") next.voltage = evt.state.voltage;
          break; // silent
        }
        case "led-planck.reading": {
          const arr = prev.readings[evt.led] ?? [];
          next.readings = {
            ...prev.readings,
            [evt.led]: [...arr, { I: evt.I, U: evt.U, Vs: evt.Vs }],
          };
          break; // silent (frequent)
        }
        case "led-planck.auto-run": {
          next.readings = { ...prev.readings, [evt.led]: evt.points };
          break; // silent
        }
        case "led-planck.fit": {
          next.fits = { ...prev.fits, [evt.led]: evt.u0 };
          break; // silent intermediate
        }
        case "led-planck.spectrum": {
          next.spectra = { ...prev.spectra, [evt.led]: evt.lambda };
          break; // silent intermediate
        }
        case "led-planck.calibrated": {
          next.calibrated = true;
          break; // silent
        }
        case "led-planck.measurement": {
          const m = evt.data;
          const existing = prev.measurements.findIndex((x) => x.led === m.led);
          if (existing >= 0) {
            next.measurements = prev.measurements.map((x, i) =>
              i === existing ? m : x,
            );
          } else {
            next.measurements = [...prev.measurements, m];
          }
          pushedLabel = `Målte U₀ for ${ledDanish(m.led)} LED`;
          break;
        }
      }

      setSnapshot(next);
      snapshotRef.current = next;

      const req = pushSnapshotRequest(next, evt.kind, pushedLabel);
      if (req) {
        if (pushedLabel) {
          humanToolEvents.dispatch({ label: pushedLabel, push: () => req });
        } else {
          void req.catch(() => {});
        }
      }
    },
    [pushSnapshotRequest, humanToolEvents],
  );

  useEffect(() => {
    if (!sessionId) return;
    const snap = snapshotRef.current;
    if (snap.lastEvent) {
      const req = pushSnapshotRequest(snap, snap.lastEvent);
      if (req) void req.catch(() => {});
    }
  }, [sessionId, pushSnapshotRequest]);

  return { snapshot, reportEvent };
}
