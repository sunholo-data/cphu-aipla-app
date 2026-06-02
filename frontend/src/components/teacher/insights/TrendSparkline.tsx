/**
 * TrendSparkline — small messages-per-day line for the panel header.
 *
 * Receives the dense `{day, count}[]` series from
 * `/api/insights/classes/{id}/trend` (M9 backend addition). The
 * accompanying `<table>` fallback under "Show data" keeps the chart
 * accessible to screen readers (axiom 11).
 */

"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "./_chartsBundle";

export interface TrendPoint {
  day: string;
  count: number;
}

interface TrendSparklineProps {
  points: TrendPoint[];
  title?: string;
}

export function TrendSparkline({ points, title = "Messages per day" }: TrendSparklineProps) {
  if (points.length === 0) {
    return (
      <div
        data-testid="trend-empty"
        className="rounded border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground"
      >
        No trend data in this window.
      </div>
    );
  }

  const total = points.reduce((acc, p) => acc + p.count, 0);
  const peak = Math.max(...points.map((p) => p.count));
  const ariaSummary = `${title}: ${points.length} days, total ${total}, peak ${peak}`;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>

      <div role="img" aria-label={ariaSummary} className="h-[120px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <XAxis dataKey="day" fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis allowDecimals={false} fontSize={10} width={28} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="count"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ r: 2 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none">Show data</summary>
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-1">Day</th>
              <th className="py-1 text-right">Messages</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.day}>
                <td className="py-0.5 font-mono">{p.day}</td>
                <td className="py-0.5 text-right tabular-nums">{p.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
