"use client";

import type { ChartElement, TableElement } from "@/lib/elementTypes";
import { resolveChartBinding } from "@/lib/resolveChartBinding";

import { ChartSvg } from "./ChartSvg";
import { cellKey, plotFromCells } from "./chartPlot";

/**
 * Read-only miniatures of a group's workbench work (1.1.136 M2).
 *
 * Built ONCE, here, and shared: the transcript's expanded work cards (state at
 * a moment), the teacher's "What they ended with" panel (final state), and
 * 1.1.99's live view (the same, with a transport) all render the same element
 * the same way. Pure components — no fetching, no storage — so each caller owns
 * where the data came from and none of them can drift into its own idea of what
 * a table looks like.
 *
 * Titles arrive already resolved: the caller holds the translator and the
 * fallback ("Data table") that suits its surface.
 */

export interface WorkColumn {
  id: string;
  label: string;
  unit?: string;
}

/** A table as rows of `{colId: value}` — the shape the tutor snapshot carries. */
export function WorkTableGrid({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: WorkColumn[];
  rows: Record<string, string>[];
}) {
  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{title}</p>
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} className="border border-border bg-muted/40 px-2 py-0.5 text-left font-medium">
                {c.label}
                {c.unit ? <span className="ml-1 text-muted-foreground">({c.unit})</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {columns.map((c) => (
                <td key={c.id} className="border border-border px-2 py-0.5 tabular-nums">
                  {row?.[c.id] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A stored cell map → the table's rows, up to the LAST row with any value.
 *  Trailing empty rows are the teacher's spare capacity, not the group's work;
 *  an empty row in the MIDDLE is kept, because a skipped trial is data. */
export function tableRowsFromCells(table: TableElement, cells: Record<string, string>): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  let last = -1;
  for (let r = 0; r < table.rows; r++) {
    const row: Record<string, string> = {};
    for (const c of table.columns) {
      const v = cells[cellKey(table.id, r, c.id)];
      if (v !== undefined && v !== "") {
        row[c.id] = v;
        last = r;
      }
    }
    rows.push(row);
  }
  return rows.slice(0, last + 1);
}

/** A chart re-rendered from table cells with the activity's own chart
 *  definition — the same binding and the same SVG the student's chart uses.
 *  Renders nothing when there is nothing to plot. */
export function WorkChart({
  title,
  chart,
  tables,
  cells,
}: {
  title: string;
  chart: ChartElement;
  tables: TableElement[];
  cells: Record<string, string>;
}) {
  const binding = resolveChartBinding(chart, tables);
  if (!binding) return null;
  const plot = plotFromCells(binding, cells);
  if (plot.points.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{title}</p>
      <div className="max-w-md">
        <ChartSvg kind={chart.chartKind} plot={plot} />
      </div>
    </div>
  );
}

/** Whether a chart would draw anything — so a caller can omit it, and its
 *  heading, rather than render an empty frame. */
export function chartHasPoints(chart: ChartElement, tables: TableElement[], cells: Record<string, string>): boolean {
  const binding = resolveChartBinding(chart, tables);
  return binding !== null && plotFromCells(binding, cells).points.length > 0;
}

/** The writing, in full, line breaks kept. */
export function WorkWriting({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium text-muted-foreground">{title}</p>
      <p className="whitespace-pre-wrap text-xs text-foreground">{text}</p>
    </div>
  );
}

/** A checklist with each item's ticked state. */
export function WorkChecklist({
  items,
  isDone,
}: {
  items: { id: string; label: string }[];
  isDone: (id: string) => boolean;
}) {
  return (
    <ul className="flex flex-col gap-0.5 text-xs">
      {items.map((i) => {
        const done = isDone(i.id);
        return (
          <li key={i.id} data-done={done ? "true" : "false"}>
            <span aria-hidden="true">{done ? "☑" : "☐"}</span> {i.label}
          </li>
        );
      })}
    </ul>
  );
}
