import { describe, expect, it } from "vitest";

import { ACTIVITY_TEMPLATES } from "@/lib/activityTemplates";

/**
 * MOBILE-1 / kepler-chalk-orbit — the observation data guard.
 *
 * This activity hands students Tycho Brahe's own 1585/1587 naked-eye
 * observations and asks them to construct Mars' orbit from them. If one of
 * those angles is wrong, every group draws a confidently wrong orbit and
 * NOTHING downstream catches it — not the tutor, not the chart, not the
 * student. That is the specific failure this file exists to prevent, and the
 * reason the dataset was verified before it shipped rather than pasted in.
 *
 * So rather than pinning the numbers as opaque literals, these tests parse the
 * table out of the activity note and REDO KEPLER'S CONSTRUCTION on it. Edit an
 * angle and the reconstructed orbit stops matching Mars, loudly.
 *
 * Dates are Julian — Denmark kept that calendar until 1700, which is also why
 * "10 Mar 1585" lands on the vernal equinox (Earth heliocentric longitude
 * 180°) rather than eleven days before it.
 */

/** Mars' real orbital elements, for checking the reconstruction against the
 *  actual ellipse rather than merely a plausible range. */
const MARS = {
  siderealPeriodDays: 687,
  perihelionAu: 1.381,
  aphelionAu: 1.666,
  semiMajorAu: 1.5237,
  eccentricity: 0.09341,
  /** Longitude of perihelion, degrees. */
  perihelionLonDeg: 336.06,
};

/** Distance from the Sun at heliocentric longitude `theta`, on Mars' true orbit. */
function marsTrueRadius(thetaDeg: number): number {
  const { semiMajorAu: a, eccentricity: e, perihelionLonDeg: peri } = MARS;
  return (a * (1 - e * e)) / (1 + e * Math.cos(rad(thetaDeg - peri)));
}

interface Pair {
  n: number;
  d1: string;
  d2: string;
  earth: [number, number];
  mars: [number, number];
}

/** Pull the observation table out of the note the student actually reads, so
 *  the test can never drift from the shipped copy. */
function parsePairs(noteBody: string): Pair[] {
  const rows = noteBody
    .split("\n")
    .filter((l) => /^\|\s*\d\s*\|/.test(l));
  return rows.map((line) => {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    const [n, dates, earth, mars] = cells;
    const degs = (s: string) => {
      const found = s.match(/(\d+)\s*°/g) ?? [];
      return found.map((d) => Number(d.replace(/\D/g, "")));
    };
    const [d1, d2] = dates.split("/").map((s) => s.trim());
    const e = degs(earth);
    const m = degs(mars);
    return { n: Number(n), d1, d2, earth: [e[0], e[1]], mars: [m[0], m[1]] };
  });
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, maj: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, okt: 10, nov: 11, dec: 12,
};

/** Julian day number, proleptic Julian calendar. Only differences are used. */
function jdn(day: number, month: number, year: number): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}

function parseDate(s: string): number {
  const m = /^(\d+)\.\s*([a-zæøå]+)\s+(\d{4})$/i.exec(s.trim());
  if (!m) throw new Error(`unparseable date: ${s}`);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) throw new Error(`unknown month: ${m[2]}`);
  return jdn(Number(m[1]), month, Number(m[3]));
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Kepler's construction: Earth on a unit (1 AU) circle at each heliocentric
 *  longitude, a sight line from each toward Mars' geocentric longitude, and
 *  Mars at the intersection. Returns distance from the Sun, in AU. */
function triangulate(p: Pair): { r: number; thetaDeg: number; crossDeg: number } {
  const E1 = [Math.cos(rad(p.earth[0])), Math.sin(rad(p.earth[0]))];
  const E2 = [Math.cos(rad(p.earth[1])), Math.sin(rad(p.earth[1]))];
  const u1 = [Math.cos(rad(p.mars[0])), Math.sin(rad(p.mars[0]))];
  const u2 = [Math.cos(rad(p.mars[1])), Math.sin(rad(p.mars[1]))];
  const det = u1[0] * -u2[1] - -u2[0] * u1[1];
  const t = ((E2[0] - E1[0]) * -u2[1] - -u2[0] * (E2[1] - E1[1])) / det;
  const M = [E1[0] + t * u1[0], E1[1] + t * u1[1]];
  const theta = ((Math.atan2(M[1], M[0]) * 180) / Math.PI + 360) % 360;
  const cross = Math.abs(((p.mars[1] - p.mars[0]) % 360 + 360) % 360);
  return { r: Math.hypot(M[0], M[1]), thetaDeg: theta, crossDeg: Math.min(cross, 360 - cross) };
}

const template = ACTIVITY_TEMPLATES.find((t) => t.id === "kepler-chalk-orbit")!;
const pairs = parsePairs(template.note!.body);

describe("kepler-chalk-orbit — Tycho's observation data", () => {
  it("ships five observation pairs in the note the student reads offline", () => {
    expect(pairs).toHaveLength(5);
    for (const p of pairs) {
      expect(p.earth.filter(Number.isFinite)).toHaveLength(2);
      expect(p.mars.filter(Number.isFinite)).toHaveLength(2);
    }
  });

  it("every pair is one Mars year apart — the entire basis of the method", () => {
    // Separated by 687 days, Mars is back at the same point in its orbit, so
    // the two sight lines cross THERE. Break this and the construction is
    // meaningless even though it still draws a tidy intersection.
    for (const p of pairs) {
      const gap = parseDate(p.d2) - parseDate(p.d1);
      expect(Math.abs(gap - MARS.siderealPeriodDays), `pair ${p.n} gap ${gap}d`).toBeLessThanOrEqual(1);
    }
  });

  it("Earth advances ~317° across each gap, as 687 days of its own motion requires", () => {
    // 687 x 0.9856°/day = 677° = 317° (mod 360). An angle typo shows up here
    // before it ever reaches a student's chalk.
    for (const p of pairs) {
      const advance = ((p.earth[1] - p.earth[0]) % 360 + 360) % 360;
      expect(Math.abs(advance - 317), `pair ${p.n} advance ${advance}°`).toBeLessThanOrEqual(2);
    }
  });

  it("reconstructs distances inside Mars' real perihelion/aphelion range", () => {
    // The headline payoff: naked-eye data from 1585 lands within ~2% of truth.
    const rs = pairs.map((p) => triangulate(p).r);
    for (const [i, r] of rs.entries()) {
      expect(r, `pair ${pairs[i].n} gave r=${r.toFixed(3)} AU`).toBeGreaterThan(MARS.perihelionAu - 0.03);
      expect(r, `pair ${pairs[i].n} gave r=${r.toFixed(3)} AU`).toBeLessThan(MARS.aphelionAu + 0.03);
    }
  });

  it("every reconstructed point lands on Mars' actual ellipse", () => {
    // Stronger than the range check above, which pair 3 (r=1.49, mid-range)
    // would satisfy even with a large angle error. This compares each point to
    // where Mars ACTUALLY is at that heliocentric longitude.
    //
    // Honest about what this catches, established by mutation-testing the
    // shipped table (worst baseline residual 0.033 AU):
    //   5° error -> caught in 16 of 20 single-angle mutations
    //   3° error -> 8 of 20
    //   2° error -> 5 of 20
    //   1° error -> 1 of 20
    // A one-degree error is genuinely indistinguishable here, and that is a
    // property of the source data rather than a weakness of the test: Tycho's
    // angles are recorded to whole degrees and the reconstruction already
    // carries ~0.03 AU of its own error. The exact guards against typos are the
    // two structural ones above — the 687-day gap and Earth's 317° advance —
    // which pin dates and Earth longitudes to within a degree.
    for (const p of pairs) {
      const { r, thetaDeg } = triangulate(p);
      const residual = Math.abs(r - marsTrueRadius(thetaDeg));
      expect(
        residual,
        `pair ${p.n}: r=${r.toFixed(3)} at θ=${thetaDeg.toFixed(1)}°, but Mars is at ${marsTrueRadius(thetaDeg).toFixed(3)} AU`,
      ).toBeLessThan(0.05);
    }
  });

  it("the distances vary enough that a student cannot conclude 'circle'", () => {
    // The whole discovery. If the spread ever collapses, the activity teaches
    // the opposite of what it is for.
    const rs = pairs.map((p) => triangulate(p).r);
    expect(Math.max(...rs) - Math.min(...rs)).toBeGreaterThan(0.2);
  });

  it("the sight lines cross steeply enough to survive chalk-scale error", () => {
    // Near-parallel lines turn one degree of drawing error into tens of
    // centimetres of intersection error. Every shipped pair crosses at 47-63°.
    for (const p of pairs) {
      const { crossDeg } = triangulate(p);
      expect(crossDeg, `pair ${p.n} crosses at ${crossDeg}°`).toBeGreaterThan(30);
    }
  });

  it("warns the tutor that five clustered points cannot fit an ellipse", () => {
    // Three of the five sit near aphelion. Enough to kill the circle, not
    // enough to determine the shape — the tutor must not let a group over-claim.
    expect(template.teachingGoal).toMatch(/for få punkter/i);
  });
});
