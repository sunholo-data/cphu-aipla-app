"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  LedPlanckEvent,
  LedPlanckSnapshot,
} from "@/hooks/useLedPlanckSnapshot";

import { LedPlanckMeasureTable } from "./LedPlanckMeasureTable";
import { LedPlanckResults } from "./LedPlanckResults";

const NOTES_PREFIX = "ledplanck:notes:";
const NOTES_TAG_PREFIX = "ledplanck:noteTag:";

interface LedPlanckWorkbenchProps {
  /** Shared snapshot from useLedPlanckSnapshot — fed by both the bench
   *  iframe and the React Results surface. */
  snapshot: LedPlanckSnapshot;
  /** Save-result events from the Results surface route through here into
   *  the shared snapshot hook. */
  reportEvent: (evt: LedPlanckEvent) => void;
  /** Reserved for future per-session bookmarks / hint cards. Accepted so
   *  the chat-page mount signature mirrors the other workspaces. */
  sessionId?: string | null;
}

const STEPS: ReadonlyArray<{ stepName: string; danish: string }> = [
  { stepName: "circuit", danish: "Kredsløb" },
  { stepName: "part1", danish: "I-U-måling" },
  { stepName: "part2", danish: "Spektroskopi" },
  { stepName: "report", danish: "Rapport" },
];

const COMPONENT_DA: Record<string, string> = {
  voltmeter: "voltmeter",
  ammeter: "amperemeter",
  led: "LED",
  resistor: "modstand",
  "power-supply": "strømforsyning",
  "current-probe": "strømprobe",
  "voltage-probe": "spændingsprobe",
};

export function LedPlanckWorkbench({
  snapshot,
  reportEvent,
  sessionId,
}: LedPlanckWorkbenchProps) {
  const currentStepName = snapshot.currentStepName ?? "circuit";
  const currentStepIdx = STEPS.findIndex((s) => s.stepName === currentStepName);
  const componentsPlaced = snapshot.componentsPlaced;

  const [noteBody, setNoteBody] = useState("");
  const [noteTag, setNoteTag] = useState("");

  useEffect(() => {
    if (typeof window === "undefined" || !sessionId) return;
    try {
      setNoteBody(window.sessionStorage.getItem(NOTES_PREFIX + sessionId) ?? "");
      setNoteTag(
        window.sessionStorage.getItem(NOTES_TAG_PREFIX + sessionId) ?? "",
      );
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  const saveNotes = useCallback(() => {
    if (typeof window === "undefined" || !sessionId) return;
    try {
      window.sessionStorage.setItem(NOTES_PREFIX + sessionId, noteBody);
      window.sessionStorage.setItem(NOTES_TAG_PREFIX + sessionId, noteTag);
    } catch {
      /* ignore */
    }
  }, [sessionId, noteBody, noteTag]);

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Om dette eksperiment</h3>
        <p className="text-xs text-muted-foreground">
          En LED begynder først at lyse, når spændingen overstiger en
          tærskelværdi <span className="font-mono">U₀</span>. Den
          tærskelværdi afhænger af LED&apos;ens farve. Ved at måle
          <span className="font-mono"> U₀</span> og bølgelængden
          <span className="font-mono"> λ</span> for flere farver kan
          Plancks konstant bestemmes:
        </p>
        <p className="mt-2 text-center font-mono text-xs">h = U₀ · e · λ / c</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Fremgang</h3>
        <ol className="space-y-1.5">
          {STEPS.map((step, idx) => {
            const reached = currentStepIdx >= idx;
            const active = currentStepIdx === idx;
            return (
              <li
                key={step.stepName}
                className={`flex items-center gap-2 text-xs ${
                  active
                    ? "font-medium text-foreground"
                    : reached
                      ? "text-foreground/80"
                      : "text-muted-foreground"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                    reached
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border bg-muted text-muted-foreground"
                  }`}
                  aria-hidden="true"
                >
                  {idx + 1}
                </span>
                <span>
                  {idx + 1}. {step.danish}
                </span>
                {active ? (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-primary">
                    nu
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <LedPlanckMeasureTable readings={snapshot.readings} />

      <LedPlanckResults snapshot={snapshot} reportEvent={reportEvent} />

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Placerede komponenter</h3>
        {componentsPlaced.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ingen komponenter placeret endnu.
          </p>
        ) : (
          <p className="text-xs">
            {componentsPlaced.map((c) => COMPONENT_DA[c] ?? c).join(", ")}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Noter</h3>
        <input
          type="text"
          value={noteTag}
          onChange={(e) => setNoteTag(e.target.value)}
          placeholder="Mærke (fx U₀)"
          className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-xs"
        />
        <textarea
          value={noteBody}
          onChange={(e) => setNoteBody(e.target.value)}
          placeholder="Skriv dine noter her. Gemmes pr. session i denne fane."
          rows={4}
          className="w-full rounded border border-border bg-background p-2 text-xs"
        />
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={saveNotes}
            disabled={!sessionId}
            className="rounded border border-border bg-background px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
          >
            Gem
          </button>
        </div>
      </section>
    </div>
  );
}
