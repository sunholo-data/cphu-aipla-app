import { axisLabel, type ResolvedChartBinding } from "@/lib/resolveChartBinding";

/**
 * The pure half of the workbench chart (1.1.136 M2): table cells in, points out.
 *
 * Extracted from `WorkbenchChart` so the student's live chart and the teacher's
 * "What they ended with" panel plot the SAME numbers the same way — the panel
 * re-renders the chart from the stored table, and a second plotting routine
 * would be a second opinion about what the group's graph looked like. 1.1.99's
 * live view is meant to reuse these renderers too ("build them once").
 *
 * Cells are keyed `${tableId}::${row}::${colId}` — the `table_progress` store's
 * key and the grid's own local key, which are the same thing on purpose.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Plotted {
  xLabel: string;
  yLabel: string;
  points: Point[];
}

export function cellKey(tableId: string, row: number, colId: string): string {
  return `${tableId}::${row}::${colId}`;
}

/** Plot a resolved binding from a cell map. Rows where either value is not a
 *  finite number are skipped — a half-filled row is not a point. Parsing is
 *  `parseFloat`, exactly as the student's chart always did, so the panel can
 *  never show a different graph from the one the group saw. (Known: a Danish
 *  decimal comma "3,42" parses as 3 on BOTH — a fix belongs here, once.) */
export function plotFromCells(binding: ResolvedChartBinding, cells: Record<string, string>): Plotted {
  const { table, x: xc, y: yc } = binding;
  const num = (v: string | undefined) => parseFloat(v ?? "");
  const points: Point[] = [];
  for (let r = 0; r < table.rows; r++) {
    const x = num(cells[cellKey(table.id, r, xc.id)]);
    const y = num(cells[cellKey(table.id, r, yc.id)]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return { xLabel: axisLabel(xc), yLabel: axisLabel(yc), points };
}
