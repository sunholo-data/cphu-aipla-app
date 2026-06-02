/**
 * EngagementBar — horizontal bar chart for per-group or per-activity
 * engagement breakdown inside `ClassInsightsPanel`.
 *
 * Recharts is imported via `_chartsBundle.ts` (M1) so this only
 * ships on teacher routes. A11y: chart has an `aria-label` summary
 * and a `<table>` fallback rendered under a "Show data" disclosure
 * (axiom 11 — USABLE BY DESIGN).
 */

"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "./_chartsBundle";

export interface EngagementBarRow {
  /** Display label on the Y-axis (group code or activity name). */
  label: string;
  /** Primary value (typically message_count). */
  value: number;
  /** Optional secondary value rendered as a second bar. */
  secondaryValue?: number;
}

interface EngagementBarProps {
  rows: EngagementBarRow[];
  title: string;
  /** Label for the primary bar (e.g. "Messages"). */
  primaryLabel: string;
  /** Label for the secondary bar (e.g. "Sim runs"). Omit for single-bar charts. */
  secondaryLabel?: string;
}

export function EngagementBar({ rows, title, primaryLabel, secondaryLabel }: EngagementBarProps) {
  if (rows.length === 0) {
    return (
      <div
        data-testid="engagement-bar-empty"
        className="rounded border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground"
      >
        No {title.toLowerCase()} data in this window.
      </div>
    );
  }

  const total = rows.reduce((acc, r) => acc + r.value, 0);
  const ariaSummary = `${title}: ${rows.length} ${rows.length === 1 ? "row" : "rows"}, total ${primaryLabel.toLowerCase()} ${total}`;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>

      <div role="img" aria-label={ariaSummary} className="h-[180px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
            <XAxis type="number" allowDecimals={false} fontSize={11} />
            <YAxis
              type="category"
              dataKey="label"
              width={110}
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
            <Bar dataKey="value" name={primaryLabel} fill="#6366f1" radius={[0, 4, 4, 0]} />
            {secondaryLabel ? (
              <Bar dataKey="secondaryValue" name={secondaryLabel} fill="#10b981" radius={[0, 4, 4, 0]} />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Show data</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1">Label</th>
              <th className="py-1 text-right">{primaryLabel}</th>
              {secondaryLabel ? <th className="py-1 text-right">{secondaryLabel}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="py-0.5">{r.label}</td>
                <td className="py-0.5 text-right tabular-nums">{r.value}</td>
                {secondaryLabel ? (
                  <td className="py-0.5 text-right tabular-nums">{r.secondaryValue ?? 0}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
