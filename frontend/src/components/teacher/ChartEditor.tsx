"use client";

import { LineChart, Plus } from "lucide-react";

export type ChartKind = "scatter" | "line" | "bar";

export interface ChartEditorValue {
  title: string;
  chartKind: ChartKind;
}

interface ChartEditorProps {
  value: ChartEditorValue | null;
  onChange: (value: ChartEditorValue | null) => void;
  /** Whether the activity has a data table — the chart plots it, so without one
   *  the chart has nothing to show (surfaced as a hint, not a hard block). */
  hasTable: boolean;
}

const CHART_KINDS: { value: ChartKind; label: string }[] = [
  { value: "scatter", label: "Punktdiagram (scatter)" },
  { value: "line", label: "Kurve (line)" },
  { value: "bar", label: "Søjlediagram (bar)" },
];

/**
 * ChartEditor — the teacher-builder editor for a chart element (1.1.38 M2). A
 * chart auto-plots the activity's data table (its first two numeric columns),
 * so authoring is just a title + a chart type. Single chart for v1.1; `null`
 * means no chart.
 */
export function ChartEditor({ value, onChange, hasTable }: ChartEditorProps) {
  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">Chart (optional)</span>
          <button
            type="button"
            onClick={() => onChange({ title: "", chartKind: "scatter" })}
            className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add chart
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Plots the data table&apos;s first two number columns as the student fills it in (e.g. velocity vs
          time). Add a data table above for the chart to have something to show.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <LineChart className="h-4 w-4 text-slate-500" /> Chart
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          Remove chart
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Title (optional)</span>
        <input
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          placeholder="e.g. Fart mod tid"
          maxLength={120}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">Chart type</span>
        <select
          aria-label="Chart type"
          value={value.chartKind}
          onChange={(e) => onChange({ ...value, chartKind: e.target.value as ChartKind })}
          className="w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        >
          {CHART_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      {!hasTable && (
        <p className="rounded border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          This chart plots a data table — add one above, with at least two number columns, or the student
          sees an empty chart.
        </p>
      )}
    </div>
  );
}
