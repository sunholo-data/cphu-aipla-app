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

/** Space characters a thousands group may be separated by: space, no-break
 *  space, narrow no-break space (what a Danish locale formatter emits). */
const GROUP_SPACE = "[ \\u00a0\\u202f]";

/** "1 234" / "-12 345,5" — digits grouped in threes by a SPACE. Unambiguous:
 *  a space is never a decimal separator. */
const SPACE_GROUPED = new RegExp(`^([-+]?)(\\d{1,3}(?:${GROUP_SPACE}\\d{3})+)([.,]\\d+)?((?:[eE][-+]?\\d+)?)$`);

/** A plain number with ONE optional decimal separator, either "." or ",". */
const PLAIN = /^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][-+]?\d+)?$/;

/**
 * A table cell → a number, or `NaN` when the cell is not one.
 *
 * Danish writes a decimal COMMA. `parseFloat("3,42")` is 3 — not NaN — so the
 * chart used to plot a silently WRONG point rather than no point (29 Sep:
 * "different decimal conventions were an issue"). Rules:
 *
 * - "3,42" and "3.42" are both 3.42; "-0,5" is -0.5; surrounding whitespace and
 *   a typographic minus (U+2212) are tolerated.
 * - A thousands separator is accepted only where it cannot be misread: digits
 *   grouped in threes by a space ("1 234,5" → 1234.5).
 * - "1,234" is read as 1.234 — the comma is a decimal separator, as in every
 *   other Danish number. We do not guess that it might be a thousands group.
 * - Mixed separators ("1.234,5", "1,234.5") are ambiguous → NaN, as is anything
 *   with trailing text ("12abc", "3 m"), which `parseFloat` used to read as a
 *   number. A cell that is not a number is not a point.
 */
export function parseCellNumber(raw: string | null | undefined): number {
  if (raw == null) return NaN;
  let s = raw.trim().replace(/^−/, "-");
  if (s === "") return NaN;
  const grouped = SPACE_GROUPED.exec(s);
  if (grouped) {
    s = grouped[1] + grouped[2].replace(new RegExp(GROUP_SPACE, "g"), "") + (grouped[3] ?? "") + grouped[4];
  }
  if (!PLAIN.test(s)) return NaN;
  return Number(s.replace(",", "."));
}

/** Plot a resolved binding from a cell map. Rows where either value is not a
 *  finite number are skipped — a half-filled row is not a point. One parser
 *  (`parseCellNumber`) for the student's chart and the teacher's panel, so the
 *  panel can never show a different graph from the one the group saw. */
export function plotFromCells(binding: ResolvedChartBinding, cells: Record<string, string>): Plotted {
  const { table, x: xc, y: yc } = binding;
  const points: Point[] = [];
  for (let r = 0; r < table.rows; r++) {
    const x = parseCellNumber(cells[cellKey(table.id, r, xc.id)]);
    const y = parseCellNumber(cells[cellKey(table.id, r, yc.id)]);
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
  }
  return { xLabel: axisLabel(xc), yLabel: axisLabel(yc), points };
}
