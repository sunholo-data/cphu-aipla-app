// aipla-physics: the physics a generated sim leans on, checked against the
// textbook. If one of these fails, every sim built on it is wrong the same way.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

type V = [number, number];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let P: any;

beforeAll(() => {
  const src = readFileSync(join(__dirname, "../vendor-src/aipla-physics/0.1.0/aipla-physics.js"), "utf8");
  const ctx: Record<string, unknown> = { Math, Number, String, Array, isFinite };
  ctx.window = ctx;
  runInNewContext(src, ctx);
  P = ctx.AIPLA_PHYSICS;
});

describe("integrators", () => {
  it("RK4 throws a projectile to the textbook range", () => {
    const v0 = 20, a = Math.PI / 4, g = 9.82;
    // y = [x, y, vx, vy]
    const derivs = (_t: number, y: number[]) => [y[2], y[3], 0, -g];
    const T = (2 * v0 * Math.sin(a)) / g;
    const run = P.simulate(derivs, [0, 0, v0 * Math.cos(a), v0 * Math.sin(a)], 0, T, 0.01);
    const end = run[run.length - 1];
    expect(end.t).toBeCloseTo(T, 10);
    expect(end.y[0]).toBeCloseTo((v0 * v0 * Math.sin(2 * a)) / g, 6);
    expect(end.y[1]).toBeCloseTo(0, 6);
  });

  it("Verlet keeps a spring's energy over many periods", () => {
    const k = 4, m = 1, acc = (x: number) => (-k * x) / m;
    let s = { x: 1, v: 0 };
    for (let i = 0; i < 100000; i++) s = P.verlet(acc, 0, s.x, s.v, 0.001);
    const E = 0.5 * m * s.v * s.v + 0.5 * k * s.x * s.x;
    expect(E).toBeCloseTo(2, 4);
  });
});

describe("collisions", () => {
  it("1D: momentum always conserved; elastic keeps energy, inelastic sticks", () => {
    for (const e of [1, 0.6, 0]) {
      const [u1, u2] = P.collide1d(2, 3, 1, -1, e);
      expect(2 * u1 + 1 * u2).toBeCloseTo(2 * 3 + 1 * -1, 12);
      expect(u2 - u1).toBeCloseTo(-e * (-1 - 3), 12);
    }
    const [a, b] = P.collide1d(2, 3, 1, -1, 1);
    expect(0.5 * 2 * a * a + 0.5 * 1 * b * b).toBeCloseTo(0.5 * 2 * 9 + 0.5 * 1, 12);
    const [s1, s2] = P.collide1d(2, 3, 1, -1, 0);
    expect(s1).toBeCloseTo(s2, 12);
  });

  it("equal masses, elastic, head-on: they swap velocities", () => {
    expect(P.collide1d(1, 5, 1, 0, 1)).toEqual([0, 5]);
  });

  it("discs: momentum conserved in 2D; separating discs are left alone", () => {
    const out = P.collideDiscs([0, 0], [2, 0] as V, 1, [1, 0.5], [0, 0] as V, 3, 1);
    const px = 1 * out[0][0] + 3 * out[1][0], py = 1 * out[0][1] + 3 * out[1][1];
    expect(px).toBeCloseTo(2, 12);
    expect(py).toBeCloseTo(0, 12);
    const ke = P.kineticEnergy(1, out[0]) + P.kineticEnergy(3, out[1]);
    expect(ke).toBeCloseTo(2, 12);
    expect(P.collideDiscs([0, 0], [-1, 0], 1, [1, 0], [1, 0], 1, 1)).toBeNull();
  });

  it("a wall reverses the normal component, scaled by e", () => {
    const v = P.bounce([3, -4], [0, 1], 0.5);
    expect(v[0]).toBeCloseTo(3, 12);
    expect(v[1]).toBeCloseTo(2, 12);
  });
});

describe("measurement and formatting", () => {
  it("a seeded generator repeats, and its gaussian has the asked-for spread", () => {
    const a = P.rng(42), b = P.rng(42);
    expect([a.next(), a.next()]).toEqual([b.next(), b.next()]);
    const r = P.rng(7), xs = Array.from({ length: 20000 }, () => r.gauss(10, 2));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it("an instrument reads to its resolution", () => {
    expect(P.reading(1.23456, 0.01)).toBe(1.23);
    expect(P.reading(0.0049, 0.01)).toBe(0);
    expect(P.reading(12.7, 0.5)).toBe(12.5);
  });

  it("Danish uses a decimal comma, a real minus and no '-0'", () => {
    expect(P.format(9.8166, 2, "da")).toBe("9,82");
    expect(P.format(9.8166, 2, "en")).toBe("9.82");
    expect(P.format(-1.5, 1, "da")).toBe("−1,5");
    expect(P.format(-0.0001, 2, "da")).toBe("0,00");
    expect(P.withUnit(9.82, 2, "m/s²", "da")).toBe("9,82 m/s²");
    expect(P.format(NaN)).toBe("–");
  });
});
