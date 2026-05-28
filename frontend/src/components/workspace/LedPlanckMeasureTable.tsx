"use client";

import {
  ledDanish,
  type LedPlanckReading,
} from "@/hooks/useLedPlanckSnapshot";

interface LedPlanckMeasureTableProps {
  /** Per-LED I-U readings accumulated from the bench (Take reading +
   *  automatic run). Empty before the student records anything. */
  readings: Record<string, LedPlanckReading[]>;
}

function ledsWithData(
  readings: Record<string, LedPlanckReading[]>,
): string[] {
  return Object.keys(readings).filter((led) => readings[led]?.length);
}

export function LedPlanckMeasureTable({ readings }: LedPlanckMeasureTableProps) {
  const leds = ledsWithData(readings);

  return (
    <section className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-2 text-sm font-semibold">Målinger (I-U)</h3>
      {leds.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Ingen målinger endnu — åbn laboratoriet og tryk Take reading
          (eller Collect automatic run).
        </p>
      ) : (
        <div className="space-y-3">
          {leds.map((led) => {
            const points = readings[led];
            return (
              <div key={led}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-medium capitalize">
                    {ledDanish(led)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {points.length}{" "}
                    {points.length === 1 ? "punkt" : "punkter"}
                  </span>
                </div>
                <div className="max-h-48 overflow-auto rounded border border-border">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-right font-medium">
                          I (mA)
                        </th>
                        <th className="px-2 py-1 text-right font-medium">
                          U (V)
                        </th>
                        <th className="px-2 py-1 text-right font-medium">
                          Vs (V)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {points.map((p, i) => (
                        <tr
                          key={i}
                          className="border-t border-border"
                        >
                          <td className="px-2 py-1 text-right font-mono">
                            {(p.I * 1000).toFixed(2)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {p.U.toFixed(3)}
                          </td>
                          <td className="px-2 py-1 text-right font-mono">
                            {p.Vs.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
