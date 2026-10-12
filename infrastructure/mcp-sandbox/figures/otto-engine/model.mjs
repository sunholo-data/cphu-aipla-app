// The one model behind the otto-engine sim: crank kinematics, valve timing and
// an ideal (air-standard) Otto cycle. The figure's moving parts, the readouts
// and the p-V diagram all come from these functions, so the picture can never
// disagree with the numbers. Pure functions only: the build imports this file
// and the page inlines it (minus `export`), and the self-test checks it.
//
// Units: crank angle in degrees over a 720° four-stroke cycle, θ = 0 at top dead
// centre (TDC) at the start of the intake stroke. Volumes in cm³, pressure in
// bar, temperature in K, energy in J.

export const GAMMA = 1.4; // air
export const R_AIR = 287; // J/(kg·K)
export const CV_AIR = 718; // J/(kg·K)
export const P_INTAKE = 1.0; // bar
export const T_INTAKE = 300; // K
export const SWEPT = 500; // cm³ — one 0.5 L cylinder
export const DT_COMBUSTION = 1800; // K — temperature rise from one fixed fuel charge
export const R_RANGE = [6, 12];

// Figure geometry (world units, z up). Crank radius and rod length set the
// piston's motion; the picture and the volume use the same numbers.
export const CRANK_R = 18;
export const ROD_L = 62;
export const CRANK_Z = 40;

export const STROKES = ["intake", "compression", "power", "exhaust"];

export const strokeOf = (theta) => STROKES[Math.floor((((theta % 720) + 720) % 720) / 180)];

/** Height of the gudgeon (wrist) pin above the bench for a crank angle. */
export function pinZ(theta) {
  const a = (theta * Math.PI) / 180;
  const s = Math.sin(a);
  return CRANK_Z + CRANK_R * Math.cos(a) + Math.sqrt(ROD_L * ROD_L - CRANK_R * CRANK_R * s * s);
}

/** Crank pin position in the crank's plane: [sideways offset, height]. */
export function crankPin(theta) {
  const a = (theta * Math.PI) / 180;
  return [CRANK_R * Math.sin(a), CRANK_Z + CRANK_R * Math.cos(a)];
}

export const PIN_TDC = CRANK_Z + CRANK_R + ROD_L;
export const PIN_BDC = CRANK_Z - CRANK_R + ROD_L;

/** Clearance volume for a compression ratio: r = (Vs + Vc) / Vc. */
export const clearance = (r) => SWEPT / (r - 1);

/** Cylinder volume (cm³) at a crank angle, from the real slider-crank motion. */
export function volume(theta, r) {
  const travel = (PIN_TDC - pinZ(theta)) / (PIN_TDC - PIN_BDC); // 0 at TDC, 1 at BDC
  return clearance(r) + SWEPT * travel;
}

/** The four corner states of the ideal cycle for compression ratio r. */
export function cycle(r) {
  const v1 = SWEPT + clearance(r);
  const v2 = clearance(r);
  const mass = (P_INTAKE * 1e5 * v1 * 1e-6) / (R_AIR * T_INTAKE); // kg of charge
  const p2 = P_INTAKE * r ** GAMMA;
  const t2 = T_INTAKE * r ** (GAMMA - 1);
  const t3 = t2 + DT_COMBUSTION;
  const p3 = (p2 * t3) / t2;
  const p4 = p3 / r ** GAMMA;
  const t4 = t3 / r ** (GAMMA - 1);
  const qIn = mass * CV_AIR * (t3 - t2);
  const qOut = mass * CV_AIR * (t4 - T_INTAKE);
  return { v1, v2, mass, p1: P_INTAKE, t1: T_INTAKE, p2, t2, p3, t3, p4, t4, qIn, qOut, work: qIn - qOut };
}

/** Ideal efficiency — what the student is meant to find. Never displayed. */
export const idealEfficiency = (r) => 1 - r ** (1 - GAMMA);

/** Gas state {p, V, T, burning} at a crank angle. Combustion is instantaneous at
 *  TDC (θ = 360°) and the exhaust blow-down at BDC (540°), as in the ideal cycle. */
export function state(theta, r) {
  const th = ((theta % 720) + 720) % 720;
  const c = cycle(r);
  const v = volume(th, r);
  if (th < 180) return { p: c.p1, v, t: c.t1, phase: "fresh" };
  if (th < 360) {
    const k = c.v1 / v;
    return { p: c.p1 * k ** GAMMA, v, t: c.t1 * k ** (GAMMA - 1), phase: "fresh" };
  }
  if (th < 540) {
    const k = c.v2 / v;
    return { p: c.p3 * k ** GAMMA, v, t: c.t3 * k ** (GAMMA - 1), phase: th < 400 ? "burning" : "burnt" };
  }
  return { p: c.p1, v, t: c.t4, phase: "exhaust" };
}

/** Valve lift as a fraction of full lift, with eased opening (no instant jumps). */
export function valveLift(theta) {
  const th = ((theta % 720) + 720) % 720;
  const bump = (from, to) => (th > from && th < to ? Math.sin((Math.PI * (th - from)) / (to - from)) : 0);
  return { intake: bump(0, 180), exhaust: bump(540, 720) };
}

/** Points of the ideal p-V loop for drawing: [[V, p], …], one full cycle. */
export function loop(r, steps = 180) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const th = (720 * i) / steps;
    const s = state(th, r);
    out.push([s.v, s.p]);
  }
  return out;
}
