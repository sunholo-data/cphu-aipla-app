"use client";

import {
  ledDanish,
  type LedPlanckEvent,
  type LedPlanckSnapshot,
} from "@/hooks/useLedPlanckSnapshot";

interface LedPlanckResultsProps {
  snapshot: LedPlanckSnapshot;
  /** Save a computed h into the shared snapshot (and notify the tutor)
   *  via the same reportEvent path the bench uses. */
  reportEvent: (evt: LedPlanckEvent) => void;
}

const E_CHARGE = 1.602176634e-19; // C
const C_LIGHT = 2.99792458e8; // m/s
const H_ACCEPTED = 6.62607015e-34; // J·s

/** h = U₀ · e · λ / c, with λ given in nm. */
function computeH(u0: number, lambdaNm: number): number {
  return (u0 * E_CHARGE * (lambdaNm * 1e-9)) / C_LIGHT;
}

function formatH(h: number): string {
  return (h / 1e-34).toFixed(3);
}

function errorPercent(h: number): string {
  const pct = ((h - H_ACCEPTED) / H_ACCEPTED) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function LedPlanckResults({
  snapshot,
  reportEvent,
}: LedPlanckResultsProps) {
  const { fits, spectra, measurements } = snapshot;

  // An LED is ready to save once it has both a fitted U₀ and a λ.
  const ready = Object.keys(fits)
    .filter((led) => typeof spectra[led] === "number")
    .map((led) => {
      const u0 = fits[led];
      const lambda = spectra[led];
      return { led, u0, lambda, h: computeH(u0, lambda) };
    });

  const savedLeds = new Set(measurements.map((m) => m.led));

  const avgH =
    measurements.length > 0
      ? measurements.reduce((s, m) => s + m.h_computed, 0) /
        measurements.length
      : null;

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-1.5 text-sm font-semibold">
        Resultater — Plancks konstant
      </h3>
      <p className="mb-3 text-center font-mono text-xs text-muted-foreground">
        h = U₀ · e · λ / c
      </p>

      {ready.length === 0 ? (
        <p className="mb-3 text-xs text-muted-foreground">
          Mål <span className="font-mono">U₀</span> (fit grafen) og{" "}
          <span className="font-mono">λ</span> (saml spektrum) i
          laboratoriet for at beregne <span className="font-mono">h</span>.
        </p>
      ) : (
        <div className="mb-3 space-y-2">
          {ready.map((r) => {
            const saved = savedLeds.has(r.led);
            return (
              <div
                key={r.led}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-primary/30 bg-primary/5 px-2 py-1.5 text-xs"
              >
                <span className="font-medium capitalize">
                  {ledDanish(r.led)}
                </span>
                <span className="font-mono text-muted-foreground">
                  U₀ {r.u0.toFixed(3)} V
                </span>
                <span className="font-mono text-muted-foreground">
                  λ {r.lambda.toFixed(1)} nm
                </span>
                <span className="font-mono">h {formatH(r.h)}×10⁻³⁴</span>
                <button
                  type="button"
                  onClick={() =>
                    reportEvent({
                      kind: "led-planck.measurement",
                      data: {
                        led: r.led,
                        u0: r.u0,
                        lambda: r.lambda,
                        h_computed: r.h,
                      },
                    })
                  }
                  className="ml-auto rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {saved ? "Opdatér" : "Gem"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <h4 className="mb-1.5 text-xs font-semibold">Gemte resultater</h4>
      {measurements.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Gem et resultat for at se gennemsnit.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[20rem] text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">LED</th>
                  <th className="px-2 py-1 text-right font-medium">U₀ (V)</th>
                  <th className="px-2 py-1 text-right font-medium">λ (nm)</th>
                  <th className="px-2 py-1 text-right font-medium">h ×10⁻³⁴</th>
                  <th className="px-2 py-1 text-right font-medium">Fejl</th>
                </tr>
              </thead>
              <tbody>
                {measurements.map((m) => (
                  <tr key={m.led} className="border-t border-border">
                    <td className="px-2 py-1 capitalize">
                      {ledDanish(m.led)}
                    </td>
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
          {avgH !== null ? (
            <p className="mt-2 text-xs">
              Gennemsnit:{" "}
              <span className="font-mono font-medium">
                {formatH(avgH)}×10⁻³⁴ J·s
              </span>{" "}
              <span className="text-muted-foreground">
                ({errorPercent(avgH)} vs. accepteret 6.626×10⁻³⁴)
              </span>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
