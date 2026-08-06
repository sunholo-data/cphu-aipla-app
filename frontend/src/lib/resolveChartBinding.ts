import type { ChartElement, TableColumn, TableElement } from "@/lib/elementTypes";

/**
 * Resolve which table + columns a chart plots (1.1.64).
 *
 * A chart may bind explicitly (`tableId` / `xColumn` / `yColumn`, added so
 * several charts can plot DIFFERENT variable pairs) or be left unbound, in
 * which case it auto-binds to the first table's first two numeric columns —
 * the 1.1.38 behaviour every chart authored before this relies on.
 *
 * **The fallback ladder**, in order:
 *
 *   1. Bound, and every referenced id resolves → plot those columns.
 *   2. Bound, but a referenced id is missing (the teacher renamed or deleted
 *      the column after saving the chart) → fall back to auto-bind AND set
 *      `note`, which the renderer shows on the chart.
 *   3. No table with two numeric columns → `null` (the empty state).
 *
 * Step 2 is the whole design. The 1.1.38 comment declined per-column selection
 * to avoid "fragile column-id coupling between the chart and table at author
 * time" — a real risk, answered here rather than avoided. A dangling reference
 * degrades **loudly**: never a crash, and never the silent plotting of the
 * wrong variables, which is the only genuinely bad outcome available.
 */
export interface ResolvedChartBinding {
  table: TableElement;
  x: TableColumn;
  y: TableColumn;
  /** Set when the chart's own binding could not be honoured. Rendered on the
   *  chart so a teacher can see why it is not showing what they chose. */
  note?: string;
}

const isNumeric = (c: TableColumn): boolean => (c.kind ?? "number") === "number";

export function resolveChartBinding(
  chart: Pick<ChartElement, "tableId" | "xColumn" | "yColumn">,
  tables: TableElement[],
): ResolvedChartBinding | null {
  const autoTable = tables[0] ?? null;

  const autoBind = (note?: string): ResolvedChartBinding | null => {
    if (!autoTable) return null;
    const numeric = autoTable.columns.filter(isNumeric);
    if (numeric.length < 2) return null;
    return { table: autoTable, x: numeric[0], y: numeric[1], note };
  };

  // Unbound: the 1.1.38 path, and not a degradation — no note.
  if (!chart.tableId && !chart.xColumn && !chart.yColumn) return autoBind();

  const table = chart.tableId ? (tables.find((t) => t.id === chart.tableId) ?? null) : autoTable;
  if (!table) {
    return autoBind("Tabellen findes ikke længere — viser de to første talkolonner.");
  }

  const numeric = table.columns.filter(isNumeric);
  const x = chart.xColumn ? numeric.find((c) => c.id === chart.xColumn) : numeric[0];
  const y = chart.yColumn ? numeric.find((c) => c.id === chart.yColumn) : numeric[1];

  if (!x || !y) {
    return autoBind("En valgt kolonne findes ikke længere — viser de to første talkolonner.");
  }
  return { table, x, y };
}

/** Axis label with its unit — "tid (s)". Units matter in a physics activity. */
export function axisLabel(c: TableColumn): string {
  return c.unit ? `${c.label} (${c.unit})` : c.label;
}
