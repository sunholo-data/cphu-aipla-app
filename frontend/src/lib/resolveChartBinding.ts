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

/** A plot axis: the domain actually drawn, and the values to label on it.
 *
 *  `min`/`max` are the NICE domain, which is wider than the data — a dataset
 *  running 2.1–9.8 gets an axis 0–10, so the origin is on the plot. Teachers,
 *  21 Aug: *"We wish the starting point was visible in the window from the
 *  beginning"*. */
export interface Axis {
  min: number;
  max: number;
  ticks: number[];
}

/** Steps a person would choose, per decade. 2.5 earns its place: without it a
 *  0–1 range steps 0.2 (six ticks) or 0.5 (three), and neither reads as well as
 *  0.25 on a quarter-scale quantity. */
const _NICE_STEPS = [1, 2, 2.5, 5, 10];

/** A "nice" step at or above `rough` — 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const decade = Math.pow(10, Math.floor(Math.log10(rough)));
  const scaled = rough / decade;
  const step = _NICE_STEPS.find((s) => scaled <= s + 1e-9) ?? 10;
  return step * decade;
}

/**
 * Build an axis over `[dataMin, dataMax]` with roughly `target` labelled ticks.
 *
 * Every degenerate case a student's half-filled table produces has to yield a
 * drawable axis, because the alternative is an axis that renders as a single
 * line with one label on it and no indication anything is wrong:
 *
 *  - **One point**, or every value identical — there is no range to divide, so
 *    centre a unit-wide window on the value.
 *  - **Non-finite input** (an empty cell parsed to NaN reaching us anyway) —
 *    fall back to 0–1 rather than propagating NaN into the SVG path, where it
 *    silently drops the whole series.
 *
 * `includeZero` extends the domain to the origin when the data comes close to
 * it. Physics-C plots are overwhelmingly proportionality checks, where a
 * gradient read against a hidden origin is the wrong reading.
 */
export function buildAxis(
  dataMin: number,
  dataMax: number,
  target = 5,
  { includeZero = false }: { includeZero?: boolean } = {},
): Axis {
  let lo = dataMin;
  let hi = dataMax;

  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = 0;
    hi = 1;
  }
  if (lo > hi) [lo, hi] = [hi, lo];
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    // A single reading still deserves a readable axis around itself.
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.5 : 0.5;
    lo -= pad;
    hi += pad;
  }

  const step = niceStep((hi - lo) / Math.max(1, target));
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  // Accumulate by multiplication, not by repeated addition: 0.1 added ten times
  // is 0.9999999999999999, which formats as "1" but breaks an equality check.
  const count = Math.round((max - min) / step);
  for (let i = 0; i <= count; i++) ticks.push(min + i * step);

  return { min, max, ticks };
}

/**
 * Format a tick for a Danish classroom: comma decimal separator, and no more
 * precision than the step carries.
 *
 * The tutors are instructed to write `0,25` rather than `0.25`; an axis
 * disagreeing with the tutor about what a number looks like is the same
 * inconsistency the 21 Aug feedback objected to in item 18.
 */
export function formatTick(value: number, step: number): string {
  // -0 renders as "-0", which is never what a student should read.
  const v = Object.is(value, -0) ? 0 : value;
  return v.toFixed(decimalsFor(step)).replace(".", ",");
}

/** Decimal places needed to write `step` exactly.
 *
 *  Derived from the step itself rather than its magnitude. `-log10(0.25)` is
 *  0.602, so a magnitude rule rounds to one decimal and renders a 0.25 step as
 *  "0,3" — a tick labelled with a value it is not drawn at, which is worse than
 *  no label. The 2.5-per-decade step exists precisely to be used, so the
 *  formatter has to be able to write it. */
function decimalsFor(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  for (let d = 0; d <= 6; d++) {
    if (Math.abs(Number(step.toFixed(d)) - step) < step * 1e-9) return d;
  }
  return 6;
}
