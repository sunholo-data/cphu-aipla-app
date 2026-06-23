"use client";

import { useEffect, useMemo, useState } from "react";

import { TABLE_CHANGE_EVENT, tableStorageKey, type TableElementDef } from "./WorkbenchTable";

/** Mirrors the backend `ChartElement` (1.1.38 M2). */
export interface ChartElementDef {
  id: string;
  title?: string;
  chartKind: "scatter" | "line" | "bar";
}

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

function readPlot(skillId: string, table: TableElementDef): Plotted | null {
  const numeric = table.columns.filter((c) => (c.kind ?? "number") === "number");
  if (numeric.length < 2) return null;
  const [xc, yc] = numeric;
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
  const label = (c: { label: string; unit?: string }) => (c.unit ? `${c.label} (${c.unit})` : c.label);
  return { xLabel: label(xc), yLabel: label(yc), points };
}

const W = 300;
const H = 200;
const PAD_L = 36;
const PAD_B = 28;
const PAD_T = 10;
const PAD_R = 12;

function scale(value: number, min: number, max: number, lo: number, hi: number): number {
  if (max === min) return (lo + hi) / 2;
  return lo + ((value - min) / (max - min)) * (hi - lo);
}

function ChartSvg({ kind, plot }: { kind: ChartElementDef["chartKind"]; plot: Plotted }) {
  const { points } = plot;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = kind === "bar" ? Math.min(0, ...ys) : Math.min(...ys);
  const yMax = Math.max(...ys);
  const px = (x: number) => scale(x, xMin, xMax, PAD_L, W - PAD_R);
  const py = (y: number) => scale(y, yMin, yMax, H - PAD_B, PAD_T);

  const ordered = kind === "line" ? [...points].sort((a, b) => a.x - b.x) : points;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${plot.xLabel} vs ${plot.yLabel}`}>
      {/* axes */}
      <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} className="stroke-border" strokeWidth={1} />
      <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} className="stroke-border" strokeWidth={1} />
      {/* axis labels */}
      <text x={(PAD_L + W - PAD_R) / 2} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        {plot.xLabel}
      </text>
      <text
        x={10}
        y={(PAD_T + H - PAD_B) / 2}
        textAnchor="middle"
        transform={`rotate(-90 10 ${(PAD_T + H - PAD_B) / 2})`}
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
          const barW = Math.max(3, (W - PAD_L - PAD_R) / ordered.length - 4);
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
  const table = tables[0] ?? null;

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ skillId?: string }>).detail;
      if (!detail || detail.skillId === skillId) setTick((t) => t + 1);
    };
    window.addEventListener(TABLE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(TABLE_CHANGE_EVENT, onChange);
  }, [skillId]);

  // Recomputed whenever the table edits tick over.
  const plot = useMemo(
    () => (table ? readPlot(skillId, table) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [skillId, table, tick],
  );

  return (
    <div className="space-y-4 p-4">
      {charts.map((chart) => (
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
          {plot && plot.points.length > 0 ? (
            <ChartSvg kind={chart.chartKind} plot={plot} />
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">
              {table
                ? "Udfyld datatabellen for at se grafen."
                : "Denne graf kræver en datatabel med to talkolonner."}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
