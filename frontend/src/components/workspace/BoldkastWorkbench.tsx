"use client";

import type { BoldkastSnapshot } from "@/hooks/useBoldkastSnapshot";

import { BoldkastSimButton } from "./BoldkastSimButton";
import { ProblemStatementCard } from "./ProblemStatementCard";
import { ProgressChecklist, type ChecklistItem } from "./ProgressChecklist";

interface BoldkastWorkbenchProps {
  /** Shared snapshot from useBoldkastSnapshot — fed by the bench iframe. */
  snapshot: BoldkastSnapshot;
  /** Open the sim iframe (replaces the workbench view in the pane). */
  onOpenSim: () => void;
  /** Sandbox unavailable -> disable the launcher. */
  simDisabled?: boolean;
  /** Skill id — scopes the progress-checklist storage key. */
  skillId: string;
  /** Problem sub-parts for the checklist. */
  subParts: ChecklistItem[];
  /** Markdown problem statement (optional). */
  problemStatement?: string;
  sessionId?: string | null;
}

const DEG = Math.PI / 180;

function rangeM(v0: number, theta: number, g: number): number {
  return (v0 * v0 * Math.sin(2 * theta * DEG)) / g;
}
function tofS(v0: number, theta: number, g: number): number {
  return (2 * v0 * Math.sin(theta * DEG)) / g;
}
function ymaxM(v0: number, theta: number, g: number): number {
  const s = Math.sin(theta * DEG);
  return (v0 * v0 * s * s) / (2 * g);
}

export function BoldkastWorkbench({
  snapshot,
  onOpenSim,
  simDisabled,
  skillId,
  subParts,
  problemStatement,
  sessionId,
}: BoldkastWorkbenchProps) {
  const { v0, theta, g, revealedMarkers } = snapshot;
  const hasThrow = v0 !== null && theta !== null && g !== null;

  const results = hasThrow
    ? [
        {
          marker: "range" as const,
          label: "Rækkevidde",
          value: `${rangeM(v0, theta, g).toFixed(1)} m`,
        },
        {
          marker: "tof" as const,
          label: "Flyvetid",
          value: `${tofS(v0, theta, g).toFixed(2)} s`,
        },
        {
          marker: "ymax" as const,
          label: "Maks. højde",
          value: `${ymaxM(v0, theta, g).toFixed(1)} m`,
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-primary/30 bg-primary/5 p-3">
        <h3 className="mb-1 text-sm font-semibold">Sådan virker det</h3>
        <ol className="ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
          <li>Åbn simulatoren nedenfor.</li>
          <li>Indstil v₀ og θ, og tryk Afspil for at se banen.</li>
          <li>
            Forudsig rækkevidde, flyvetid og højde — afslør dem så i
            simulatoren.
          </li>
          <li>Marker delopgaver som klar i Fremgang.</li>
          <li>Spørg tutoren — den kan se din opsætning og dine resultater.</li>
        </ol>
      </section>

      <BoldkastSimButton onOpen={onOpenSim} disabled={simDisabled} />

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Din opsætning</h3>
        {hasThrow ? (
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">v₀</dt>
              <dd className="font-mono">{v0} m/s</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">θ</dt>
              <dd className="font-mono">{theta}°</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">g</dt>
              <dd className="font-mono">{g} m/s²</dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">
            Åbn simulatoren og kast en bold for at se din opsætning her.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Resultater</h3>
        {results.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Forudsig først — afslør så rækkevidde, flyvetid og højde i
            simulatoren.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {results.map((r) => {
              const revealed = revealedMarkers.includes(r.marker);
              return (
                <li
                  key={r.marker}
                  className="flex items-center justify-between text-xs"
                >
                  <span>{r.label}</span>
                  {revealed ? (
                    <span className="font-mono font-medium">{r.value}</span>
                  ) : (
                    <span className="text-muted-foreground">
                      Skjult — tryk Vis i simulatoren
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ProgressChecklist
        skillId={skillId}
        items={subParts}
        sessionId={sessionId}
      />

      {problemStatement ? (
        <ProblemStatementCard content={problemStatement} />
      ) : null}
    </div>
  );
}
