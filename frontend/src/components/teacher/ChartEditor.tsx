"use client";

import { LineChart, Plus, X } from "lucide-react";

import type { TableEditorValue } from "@/components/teacher/TableEditor";

export type ChartKind = "scatter" | "line" | "bar";

/** One authored chart. `tableId`/`xColumn`/`yColumn` are optional: unset keeps
 *  the 1.1.38 auto-bind (first table, first two numeric columns), so charts
 *  authored before 1.1.64 are unchanged. */
export interface ChartEditorValue {
  id?: string;
  title: string;
  chartKind: ChartKind;
  tableId?: string | null;
  xColumn?: string | null;
  yColumn?: string | null;
}

interface ChartEditorProps {
  value: ChartEditorValue[];
  onChange: (value: ChartEditorValue[]) => void;
  /** The activity's data table — charts plot it, and its numeric columns are
   *  what the axis pickers offer. Null when the activity has no table yet. */
  table: TableEditorValue | null;
}

const CHART_KINDS: { value: ChartKind; label: string }[] = [
  { value: "scatter", label: "Punktdiagram (scatter)" },
  { value: "line", label: "Kurve (line)" },
  { value: "bar", label: "Søjlediagram (bar)" },
];

/** ELEMENT_REGISTRY["chart"].max_items — the backend cap, mirrored so the UI can
 *  explain itself rather than silently refusing an Add. */
const MAX_CHARTS = 5;

/** The builder authors ONE table, minted as `table-1` by `tableDefs`. */
const TABLE_ID = "table-1";

/**
 * ChartEditor — the teacher-builder editor for an activity's charts
 * (1.1.38 M2, made a list editor in 1.1.64).
 *
 * Aswin, 2026-08-06: *"I think option to add more than one chart would be
 * great. Because in the experiment dataset, students can draw multiple graphs
 * with different variables."*
 *
 * The backend already allowed five charts and the renderer already took an
 * array; this editor was the singleton. But multiplicity alone would not have
 * answered the ask — a chart auto-plotted the table's first two numeric
 * columns, so five charts were the same graph drawn five ways. Hence the axis
 * pickers, which are the actual feature.
 *
 * Only NUMERIC columns are offered on either axis: a text column on an axis is
 * not a plot.
 */
export function ChartEditor({ value, onChange, table }: ChartEditorProps) {
  const charts = value ?? [];
  // Column ids are minted POSITIONALLY at conversion (`col-{n}` over the
  // label-bearing columns — see `tableDefs` in lib/activityPreview). The axis
  // pickers must therefore speak the same minted ids, and deleting a column
  // SHIFTS every later id. That would silently re-point a chart at a different
  // variable, which the render-side fallback cannot detect (the id still
  // resolves). ActivityBuilderBody guards it: deleting a referenced column asks
  // first and clears the affected bindings, so the chart falls back to
  // auto-bind with a visible note instead of quietly plotting the wrong thing.
  const numericColumns = (table?.columns ?? [])
    .filter((c) => c.label.trim())
    .map((c, idx) => ({ ...c, mintedId: `col-${idx + 1}` }))
    .filter((c) => (c.kind ?? "number") === "number");
  const canPlot = numericColumns.length >= 2;
  const atCap = charts.length >= MAX_CHARTS;

  const update = (idx: number, patch: Partial<ChartEditorValue>) =>
    onChange(charts.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const add = () =>
    onChange([
      ...charts,
      {
        id: `chart-${charts.length + 1}`,
        title: "",
        chartKind: "scatter",
        tableId: table ? TABLE_ID : null,
        // Default to the first two numeric columns — the same pair auto-bind
        // would have chosen, so adding a chart and changing nothing behaves
        // exactly as it did before this editor grew axis pickers.
        xColumn: numericColumns[0]?.mintedId ?? null,
        yColumn: numericColumns[1]?.mintedId ?? null,
      },
    ]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <LineChart className="h-4 w-4 text-slate-500" />
          Grafer {charts.length > 0 && <span className="text-xs text-slate-500">({charts.length}/{MAX_CHARTS})</span>}
        </span>
        <button
          type="button"
          onClick={add}
          disabled={atCap}
          title={atCap ? `Højst ${MAX_CHARTS} grafer pr. aktivitet` : undefined}
          className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Tilføj graf
        </button>
      </div>

      {atCap && (
        <p className="text-xs text-slate-500">Højst {MAX_CHARTS} grafer pr. aktivitet.</p>
      )}

      {charts.length === 0 && (
        <p className="text-xs text-slate-500">
          Plotter kolonner fra datatabellen, mens eleven udfylder den (fx hastighed mod tid). Tilføj en
          datatabel med mindst to talkolonner ovenfor, så grafen har noget at vise.
        </p>
      )}

      {charts.map((chart, idx) => (
        <div key={chart.id ?? idx} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={chart.title}
              onChange={(e) => update(idx, { title: e.target.value })}
              placeholder="Grafens titel"
              aria-label={`Titel på graf ${idx + 1}`}
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
            />
            <select
              value={chart.chartKind}
              onChange={(e) => update(idx, { chartKind: e.target.value as ChartKind })}
              aria-label={`Graftype for graf ${idx + 1}`}
              className="rounded border border-slate-300 px-2 py-1 text-xs"
            >
              {CHART_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => onChange(charts.filter((_, i) => i !== idx))}
              aria-label={`Fjern graf ${idx + 1}`}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {canPlot ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-1">
                <span className="text-slate-500">X</span>
                <select
                  value={chart.xColumn ?? ""}
                  onChange={(e) => update(idx, { xColumn: e.target.value || null, tableId: TABLE_ID })}
                  aria-label={`X-akse for graf ${idx + 1}`}
                  className="rounded border border-slate-300 px-2 py-1"
                >
                  {numericColumns.map((c) => (
                    <option key={c.mintedId} value={c.mintedId}>
                      {c.unit ? `${c.label} (${c.unit})` : c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-slate-500">Y</span>
                <select
                  value={chart.yColumn ?? ""}
                  onChange={(e) => update(idx, { yColumn: e.target.value || null, tableId: TABLE_ID })}
                  aria-label={`Y-akse for graf ${idx + 1}`}
                  className="rounded border border-slate-300 px-2 py-1"
                >
                  {numericColumns.map((c) => (
                    <option key={c.mintedId} value={c.mintedId}>
                      {c.unit ? `${c.label} (${c.unit})` : c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Tilføj en datatabel med mindst to talkolonner for at vælge akser.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
