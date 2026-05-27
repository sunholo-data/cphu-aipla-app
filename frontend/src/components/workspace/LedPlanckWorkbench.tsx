"use client";

import type { LedPlanckSnapshot } from "./LedPlanckLabFrame";

interface LedPlanckWorkbenchProps {
  /** Snapshot from the lab frame. `null` before the lab has been opened
   *  at least once — render sensible empty states. */
  snapshot: LedPlanckSnapshot | null;
  /** Reserved for future per-session bookmarks / hint cards. Not used
   *  yet; accepted so the chat-page mount signature mirrors the
   *  Boldkast workspace block. */
  sessionId?: string | null;
}

const STEPS: ReadonlyArray<{ stepName: string; danish: string }> = [
  { stepName: "circuit", danish: "Kredsløb" },
  { stepName: "part1", danish: "I-U-måling" },
  { stepName: "part2", danish: "Spektroskopi" },
  { stepName: "report", danish: "Rapport" },
];

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

const H_ACCEPTED = 6.62607015e-34;

function formatH(h: number): string {
  return (h / 1e-34).toFixed(3);
}

function errorPercent(h: number): string {
  const pct = ((h - H_ACCEPTED) / H_ACCEPTED) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function LedPlanckWorkbench({ snapshot }: LedPlanckWorkbenchProps) {
  const currentStepName = snapshot?.currentStepName ?? "circuit";
  const currentStepIdx = STEPS.findIndex((s) => s.stepName === currentStepName);
  const measurements = snapshot?.measurements ?? [];
  const componentsPlaced = snapshot?.componentsPlaced ?? [];

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Om dette eksperiment</h3>
        <p className="text-xs text-muted-foreground">
          En LED begynder først at lyse, når spændingen overstiger en
          tærskelværdi <span className="font-mono">U₀</span>. Den
          tærskelværdi afhænger af LED'ens farve. Ved at måle
          <span className="font-mono"> U₀</span> og bølgelængden
          <span className="font-mono"> λ</span> for flere farver kan
          Plancks konstant bestemmes:
        </p>
        <p className="mt-2 text-center font-mono text-xs">
          h = U₀ · e · λ / c
        </p>
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

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Målinger</h3>
        {measurements.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ingen målinger endnu. Åbn laboratoriet og gem et resultat.
          </p>
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">LED</th>
                  <th className="px-2 py-1 text-right font-medium">U₀ (V)</th>
                  <th className="px-2 py-1 text-right font-medium">λ (nm)</th>
                  <th className="px-2 py-1 text-right font-medium">
                    h ×10⁻³⁴
                  </th>
                  <th className="px-2 py-1 text-right font-medium">Fejl</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((m) => (
                  <tr key={m.led} className="border-t border-border">
                    <td className="px-2 py-1">{LED_DA[m.led] ?? m.led}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {m.u0.toFixed(3)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {m.lambda.toFixed(1)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {formatH(m.h_computed)}
                    </td>
                    <td className="px-2 py-1 text-right font-mono">
                      {errorPercent(m.h_computed)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-1.5 text-sm font-semibold">Placerede komponenter</h3>
        {componentsPlaced.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Ingen komponenter placeret endnu.
          </p>
        ) : (
          <p className="text-xs">
            {componentsPlaced
              .map((c) => COMPONENT_DA[c] ?? c)
              .join(", ")}
          </p>
        )}
      </section>
    </div>
  );
}
