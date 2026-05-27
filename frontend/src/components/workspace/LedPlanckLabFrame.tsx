"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";
import { fetchWithAuth } from "@/lib/apiClient";

import {
  StaticArtefactFrame,
  type StaticArtefactFrameHandle,
} from "./StaticArtefactFrame";

export interface LedPlanckLabFrameHandle {
  sendChatFlush: () => void;
}

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

function labelForStep(stepName: string | undefined): string | null {
  if (!stepName) return null;
  return STEP_DA[stepName] ?? null;
}

function labelForMeasurement(led: string): string {
  const da = LED_DA[led] ?? led;
  return `Målte U₀ for ${da} LED`;
}

function labelForComponent(component: string): string {
  const da = COMPONENT_DA[component] ?? component;
  return `Placerede ${da}`;
}

function labelForPolarityError(): string {
  return "Forsøgte LED med omvendt polaritet";
}

interface LedPlanckStructuredContent {
  kind: string;
  step?: number;
  stepName?: string;
  data?: {
    led?: string;
    u0?: number;
    lambda?: number;
    h_computed?: number;
  };
  component?: string;
  correct?: boolean;
  changed?: string[];
  state?: { voltage?: number };
  triggeredBy?: string;
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
  measurements: LedPlanckMeasurement[];
  componentsPlaced: string[];
  lastPolarityError: number | null;
  voltage: number | null;
}

interface LedPlanckLabFrameProps {
  sandboxOrigin: string;
  sessionId: string | null;
  onClose: () => void;
  /** Fired after every snapshot mutation so a parent can mirror the
   *  state into a sibling workbench surface. The same snapshot the
   *  iframe-context POST sends to the agent. */
  onSnapshotChange?: (snapshot: LedPlanckSnapshot) => void;
}

export const LedPlanckLabFrame = forwardRef<
  LedPlanckLabFrameHandle,
  LedPlanckLabFrameProps
>(function LedPlanckLabFrame(
  { sandboxOrigin, sessionId, onClose, onSnapshotChange },
  ref,
) {
  const onSnapshotChangeRef = useRef(onSnapshotChange);
  onSnapshotChangeRef.current = onSnapshotChange;
  const humanToolEvents = useHumanToolEvents();
  const staticFrameRef = useRef<StaticArtefactFrameHandle | null>(null);
  const snapshotRef = useRef<LedPlanckSnapshot>({
    lastEvent: "",
    currentStep: null,
    currentStepName: null,
    measurements: [],
    componentsPlaced: [],
    lastPolarityError: null,
    voltage: null,
  });

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const pushSnapshotRequest = useCallback(
    (latestKind: string): Promise<Response> | null => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      const body = {
        serverId: "led-planck",
        toolName: "state",
        structuredContent: { ...snapshotRef.current, lastEvent: latestKind },
      };
      return fetchWithAuth(`/api/proxy/api/sessions/${sid}/iframe-context`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    [],
  );

  const pushSnapshotSilent = useCallback(
    (latestKind: string) => {
      const req = pushSnapshotRequest(latestKind);
      if (!req) return;
      void req.catch((err) => {
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[led-planck] iframe-context push failed:", err);
        }
      });
    },
    [pushSnapshotRequest],
  );

  const handleStructuredContent = useCallback(
    (structuredContent: Record<string, unknown>) => {
      const data = structuredContent as unknown as LedPlanckStructuredContent;
      const kind = data.kind;
      if (typeof kind !== "string") return;

      const snap = snapshotRef.current;
      snap.lastEvent = kind;

      let shouldPush = false;
      let pushedLabel: string | null = null;

      if (kind === "led-planck.step-change") {
        if (typeof data.step === "number") snap.currentStep = data.step;
        if (typeof data.stepName === "string") {
          snap.currentStepName = data.stepName;
        }
        shouldPush = true;
        pushedLabel = labelForStep(data.stepName);
      } else if (kind === "led-planck.measurement" && data.data) {
        const m = data.data;
        if (
          typeof m.led === "string" &&
          typeof m.u0 === "number" &&
          typeof m.lambda === "number" &&
          typeof m.h_computed === "number"
        ) {
          // Dedupe by LED color — newest measurement wins.
          const existing = snap.measurements.findIndex((x) => x.led === m.led);
          const entry: LedPlanckMeasurement = {
            led: m.led,
            u0: m.u0,
            lambda: m.lambda,
            h_computed: m.h_computed,
          };
          if (existing >= 0) {
            snap.measurements = snap.measurements.map((x, i) =>
              i === existing ? entry : x,
            );
          } else {
            snap.measurements = [...snap.measurements, entry];
          }
          shouldPush = true;
          pushedLabel = labelForMeasurement(m.led);
        }
      } else if (
        kind === "led-planck.component-placed" &&
        typeof data.component === "string"
      ) {
        const correct = data.correct === true;
        if (correct) {
          if (!snap.componentsPlaced.includes(data.component)) {
            snap.componentsPlaced = [
              ...snap.componentsPlaced,
              data.component,
            ];
          }
          shouldPush = true;
          pushedLabel = labelForComponent(data.component);
        } else {
          // Incorrect placement: silent push so the tutor sees the
          // student is fumbling, but no UI card.
          shouldPush = true;
          pushedLabel = null;
        }
      } else if (kind === "led-planck.led-polarity-error") {
        snap.lastPolarityError = Date.now();
        shouldPush = true;
        pushedLabel = labelForPolarityError();
      } else if (kind === "led-planck.state-change" && data.state) {
        if (typeof data.state.voltage === "number") {
          snap.voltage = data.state.voltage;
        }
        shouldPush = true;
        pushedLabel = null;
      }

      if (shouldPush) {
        const req = pushSnapshotRequest(kind);
        if (req) {
          if (pushedLabel) {
            humanToolEvents.dispatch({ label: pushedLabel, push: () => req });
          } else {
            void req.catch(() => {});
          }
        }
        // Push a fresh shallow copy so React detects the change and the
        // parent workbench surface re-renders. measurements/
        // componentsPlaced are already replaced as new arrays inside
        // the branches above; primitive fields don't need cloning.
        onSnapshotChangeRef.current?.({ ...snap });
      }
    },
    [pushSnapshotRequest, humanToolEvents],
  );

  useEffect(() => {
    if (!sessionId) return;
    const snap = snapshotRef.current;
    if (
      snap.lastEvent ||
      snap.measurements.length > 0 ||
      snap.componentsPlaced.length > 0 ||
      snap.lastPolarityError !== null
    ) {
      pushSnapshotSilent(snap.lastEvent || "catch-up");
    }
  }, [sessionId, pushSnapshotSilent]);

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
