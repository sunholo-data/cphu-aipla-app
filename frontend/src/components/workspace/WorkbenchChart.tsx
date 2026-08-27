"use client";

import { useEffect, useMemo, useState } from "react";

import { TABLE_CHANGE_EVENT, tableStorageKey, type TableElementDef } from "./WorkbenchTable";
import type { ChartElement } from "@/lib/elementTypes";

import {
  axisLabel,
  buildAxis,
  formatTick,
  resolveChartBinding,
  type ResolvedChartBinding,
} from "@/lib/resolveChartBinding";

/** Canonical ChartElement re-exported under the render-side name. */
export type ChartElementDef = ChartElement;

interface WorkbenchChartProps {
  skillId: string;
  charts: ChartElementDef[];
  /** The activity's data tables — the chart auto-binds to the first one and
   *  plots its first two numeric columns. */
  tables: TableElementDef[];
}

interface Point {
  x: number;
  y: number;
}

interface Plotted {
  xLabel: string;
  yLabel: string;
  points: Point[];
}

function readPlot(skillId: string, binding: ResolvedChartBinding): Plotted {
  const { table, x: xc, y: yc } = binding;
  let values: Record<string, string> = {};
  if (typeof window !== "undefined") {
    try {
      values = JSON.parse(window.sessionStorage.getItem(tableStorageKey(skillId)) || "{}");
    } catch {
      values = {};
    }
  }
  const points: Point[] = [];
  for (let r = 0; r < table.rows; r++) {
    const x = parseFloat(values[`${table.id}::${r}::${xc.id}`] ?? "");
    const y = parseFloat(values[`${table.id}::${r}::${yc.id}`] ?? "");
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return { xLabel: axisLabel(xc), yLabel: axisLabel(yc), points };
}

const W = 300;
const H = 200;
const PAD_B = 34;
const PAD_T = 10;
const PAD_R = 12;

/** Approximate width of one tick digit at the 8px tick font, in viewBox units.
 *  Measuring text properly needs a laid-out DOM, which server rendering and
 *  jsdom both lack; a per-character estimate is stable in every environment and
 *  only has to be generous enough not to clip. */
const TICK_CHAR_W = 4.6;

/** Left padding: the rotated axis label's own column, plus room for the widest
 *  y tick. `PAD_L` was a fixed 36, which fits about six characters — enough for
 *  "9000" but not for a signed small decimal like "-0,0008". Adding ticks
 *  against a fixed padding would have introduced a new defect (a number the
 *  student can see part of) while fixing item 4. */
function leftPadding(yTickLabels: string[]): number {
  const widest = yTickLabels.reduce((n, t) => Math.max(n, t.length), 1);
  return Math.min(72, 20 + widest * TICK_CHAR_W);
}

function scale(value: number, min: number, max: number, lo: number, hi: number): number {
  if (max === min) return (lo + hi) / 2;
  return lo + ((value - min) / (max - min)) * (hi - lo);
}

function ChartSvg({ kind, plot }: { kind: ChartElementDef["chartKind"]; plot: Plotted }) {
  const { points } = plot;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  // 1.1.84 M1 — the domain is the NICE interval, not [min(data), max(data)].
  // A bar chart still anchors y at zero (a bar measured from an arbitrary
  // baseline misstates its own length); the others include zero only when the
  // data is already near it, which is the Physics-C proportionality case.
  const xAxis = buildAxis(Math.min(...xs), Math.max(...xs));
  const yAxis = buildAxis(Math.min(...ys), Math.max(...ys), 5, { includeZero: kind === "bar" });
  const xStep = xAxis.ticks.length > 1 ? xAxis.ticks[1] - xAxis.ticks[0] : 1;
  const yStep = yAxis.ticks.length > 1 ? yAxis.ticks[1] - yAxis.ticks[0] : 1;
  const xTickLabels = xAxis.ticks.map((t) => formatTick(t, xStep));
  const yTickLabels = yAxis.ticks.map((t) => formatTick(t, yStep));

  const padL = leftPadding(yTickLabels);
  const px = (x: number) => scale(x, xAxis.min, xAxis.max, padL, W - PAD_R);
  const py = (y: number) => scale(y, yAxis.min, yAxis.max, H - PAD_B, PAD_T);
  const yMin = yAxis.min;

  const ordered = kind === "line" ? [...points].sort((a, b) => a.x - b.x) : points;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${plot.xLabel} vs ${plot.yLabel}`}>
      {/* gridlines, behind everything — faint enough to read past, present
          enough to carry the eye from a point to its value */}
      {yAxis.ticks.map((t, i) => (
        <line
          key={`gy${i}`}
          x1={padL}
          y1={py(t)}
          x2={W - PAD_R}
          y2={py(t)}
          className="stroke-border/40"
          strokeWidth={0.5}
        />
      ))}
      {xAxis.ticks.map((t, i) => (
        <line
          key={`gx${i}`}
          x1={px(t)}
          y1={PAD_T}
          x2={px(t)}
          y2={H - PAD_B}
          className="stroke-border/40"
          strokeWidth={0.5}
        />
      ))}
      {/* axes */}
      <line x1={padL} y1={PAD_T} x2={padL} y2={H - PAD_B} className="stroke-border" strokeWidth={1} />
      <line x1={padL} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="stroke-border" strokeWidth={1} />
      {/* tick marks + numbers — the point of 1.1.84. A physics student reads a
          gradient off these; without them the plot shows a shape and nothing
          more. */}
      {yAxis.ticks.map((t, i) => (
        <g key={`ty${i}`}>
          <line x1={padL - 3} y1={py(t)} x2={padL} y2={py(t)} className="stroke-border" strokeWidth={1} />
          <text
            x={padL - 5}
            y={py(t) + 2.5}
            textAnchor="end"
            className="fill-muted-foreground text-[8px]"
            data-testid="y-tick"
          >
            {yTickLabels[i]}
          </text>
        </g>
      ))}
      {xAxis.ticks.map((t, i) => (
        <g key={`tx${i}`}>
          <line
            x1={px(t)}
            y1={H - PAD_B}
            x2={px(t)}
            y2={H - PAD_B + 3}
            className="stroke-border"
            strokeWidth={1}
          />
          <text
            x={px(t)}
            y={H - PAD_B + 11}
            textAnchor="middle"
            className="fill-muted-foreground text-[8px]"
            data-testid="x-tick"
          >
            {xTickLabels[i]}
          </text>
        </g>
      ))}
      {/* axis labels */}
      <text x={(padL + W - PAD_R) / 2} y={H - 3} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {plot.xLabel}
      </text>
      <text
        x={8}
        y={(PAD_T + H - PAD_B) / 2}
        textAnchor="middle"
        transform={`rotate(-90 8 ${(PAD_T + H - PAD_B) / 2})`}
        className="fill-muted-foreground text-[9px]"
      >
        {plot.yLabel}
      </text>
      {kind === "line" && (
        <polyline
          fill="none"
          className="stroke-primary"
          strokeWidth={1.5}
          points={ordered.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}
        />
      )}
      {kind === "bar" &&
        ordered.map((p, i) => {
          const barW = Math.max(3, (W - padL - PAD_R) / ordered.length - 4);
          return (
            <rect
              key={i}
              x={px(p.x) - barW / 2}
              y={py(p.y)}
              width={barW}
              height={Math.max(0, py(yMin) - py(p.y))}
              className="fill-primary/70"
            />
          );
        })}
      {(kind === "scatter" || kind === "line") &&
        ordered.map((p, i) => <circle key={i} cx={px(p.x)} cy={py(p.y)} r={2.5} className="fill-primary" />)}
    </svg>
  );
}

/**
 * WorkbenchChart — deterministic SVG chart of the student's data table (1.1.38
 * M2). Auto-binds to the activity's table and plots its first two numeric
 * columns (x, y). Re-reads on the `aipla:table-change` event the table fires on
 * each commit, so the plot grows as the student enters readings. Zero LLM.
 */
export function WorkbenchChart({ skillId, charts, tables }: WorkbenchChartProps) {
  const [tick, setTick] = useState(0);
  const hasTable = tables.length > 0;

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ skillId?: string }>).detail;
      if (!detail || detail.skillId === skillId) setTick((t) => t + 1);
    };
    window.addEventListener(TABLE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(TABLE_CHANGE_EVENT, onChange);
  }, [skillId]);

  // 1.1.64 — resolved PER CHART, so several charts can plot different variable
  // pairs off the same table. Previously one shared plot was computed from
  // tables[0] and handed to every chart, which made "more than one chart" the
  // same graph drawn several ways.
  const resolved = useMemo(
    () => charts.map((chart) => ({ chart, binding: resolveChartBinding(chart, tables) })),
    [charts, tables],
  );
  const plots = useMemo(
    () => resolved.map(({ binding }) => (binding ? readPlot(skillId, binding) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolved, skillId, tick],
  );

  return (
    <div className="space-y-4 p-4">
      {resolved.map(({ chart, binding }, i) => (
        <section
          key={chart.id}
          className="rounded-lg border border-border bg-card p-4 text-sm"
          aria-label={chart.title || "Graf"}
        >
          {chart.title && (
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {chart.title}
            </h3>
          )}
          {binding?.note && (
            <p className="mb-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1 text-[10px] text-amber-900">
              {binding.note}
            </p>
          )}
          {plots[i] && plots[i]!.points.length > 0 ? (
            <ChartSvg kind={chart.chartKind} plot={plots[i]!} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {hasTable
                ? "Udfyld datatabellen for at se grafen."
                : "Denne graf kræver en datatabel med to talkolonner."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
