import type { Point } from "@/components/shared/work/chartPlot";

/**
 * The one outlier hint the compare view offers (1.1.99 M1): a chart whose
 * fitted slope differs a lot from the class's.
 *
 * Deliberately narrow. It is a pointer for the teacher's eye — "look at these
 * two" — not a verdict and never a ranking: the median of the groups' own
 * slopes is the reference, not a right answer, so a class that all got it
 * wrong the same way flags nobody. Needs at least three fitted groups, or a
 * median means nothing.
 */

/** Least-squares slope, or null when it is undefined (<2 points, no x spread). */
export function fittedSlope(points: Point[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx === 0) return null;
  return sxy / sxx;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Groups whose slope differs from the median slope by more than `tolerance`
 *  (relative), or has the opposite sign. Empty when fewer than 3 groups fit. */
export function slopeOutliers(
  slopes: Record<string, number | null>,
  tolerance = 0.3,
): { median: number | null; outliers: Set<string> } {
  const fitted = Object.entries(slopes).filter((e): e is [string, number] => e[1] !== null && Number.isFinite(e[1]));
  if (fitted.length < 3) return { median: null, outliers: new Set() };
  const m = median(fitted.map(([, s]) => s));
  const outliers = new Set<string>();
  // A zero median has no relative scale to measure "a lot" against — do not guess.
  if (m === 0) return { median: m, outliers };
  for (const [code, s] of fitted) {
    if (Math.sign(s) !== Math.sign(m) || Math.abs(s - m) > tolerance * Math.abs(m)) outliers.add(code);
  }
  return { median: m, outliers };
}
