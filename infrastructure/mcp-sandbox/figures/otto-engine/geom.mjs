// Geometry helpers the anatomy kit does not have, for parts that are not
// vertical extrusions: the crank, connecting rod and webs swing in the x-z plane
// (the crank axis runs along y), and the valve springs coil along z. Used by
// build.mjs for the static art AND inlined into the page for the parts redrawn
// every frame, so both halves draw identically. Depends only on the kit's `iso`,
// `depthOf`, `pathOf` and `cameraOf`.

import { cameraOf, depthOf, iso, pathOf } from "../../../../.claude/skills/anatomy/kit/iso-kit.mjs";

const SHADE_COUNT = 4;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mean = (pts) => pts.reduce((m, p) => [m[0] + p[0] / pts.length, m[1] + p[1] / pts.length, m[2] + p[2] / pts.length], [0, 0, 0]);

/** A convex polyhedron from its faces, drawn with the kit's tone classes.
 *  Back faces are culled by the kit's own facing rule (depthOf(normal) > 0), so
 *  a convex solid needs no painter's sort of its own. */
export function polySolid(faces, P, { tone = "mid", lit = false } = {}) {
  const centre = mean(faces.flat());
  const { sinA, cosA } = cameraOf(P);
  const fills = [];
  const edges = [];
  for (const face of faces) {
    let n = cross(sub(face[1], face[0]), sub(face[2], face[0]));
    if (dot(n, sub(mean(face), centre)) < 0) n = n.map((v) => -v);
    if (depthOf(n, P) <= 1e-9) continue;
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const flat = face.map((p) => iso(p, P));
    const d = pathOf(flat, true);
    if (n[2] / len > 0.72) fills.push(`<path class="iso-top" d="${d}"/>`);
    else {
      const light = ((n[0] / len) * -sinA + (n[1] / len) * cosA + 1) / 2;
      const shade = Math.min(SHADE_COUNT - 1, Math.max(0, Math.floor(light * SHADE_COUNT)));
      fills.push(`<path class="iso-shade" data-shade="${shade}" d="${d}"/>`);
    }
    edges.push(d);
  }
  return `<g class="iso-solid"${lit ? " data-lit" : ""}>${fills.join("")}<path class="iso-line iso-edge" data-tone="${tone}" d="${edges.join("")}"/></g>`;
}

/** Convex profile [[x, z], …] in the x-z plane, extruded along y from y0 to y1. */
export function prismY(profile, y0, y1) {
  const back = profile.map(([x, z]) => [x, y0, z]);
  const front = profile.map(([x, z]) => [x, y1, z]);
  const faces = [back, front];
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    faces.push([back[i], back[j], front[j], front[i]]);
  }
  return faces;
}

export const circle2 = (cx, cz, r, n = 28, from = 0, to = Math.PI * 2) =>
  Array.from({ length: n }, (_, i) => {
    const a = from + ((to - from) * i) / n;
    return [cx + r * Math.cos(a), cz + r * Math.sin(a)];
  });

/** Convex hull of 2-D points (monotone chain) — rod and web outlines. */
export function hull2(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** A helix along z (valve spring), split into the turns behind and in front. */
export function helixZ(cx, cy, r, z0, z1, turns, P, perTurn = 18) {
  const count = Math.max(2, Math.round(turns * perTurn));
  const back = [];
  const front = [];
  let run = [];
  let near = null;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * turns * Math.PI * 2;
    const point = [cx + r * Math.cos(a), cy + r * Math.sin(a), z0 + ((z1 - z0) * i) / count];
    const facing = depthOf([Math.cos(a), Math.sin(a), 0], P) > 0;
    const flat = iso(point, P);
    if (near === null) near = facing;
    if (facing !== near) {
      run.push(flat);
      (near ? front : back).push(pathOf(run));
      run = [flat];
      near = facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(pathOf(run));
  return { back: back.join(""), front: front.join("") };
}

/** Clip a plan ring to the back half (y·side ≤ 0) of the section plane y = 0. */
export function clipBack(ring, side) {
  const inside = (p) => p[1] * side <= 1e-9;
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = a[1] / (a[1] - b[1]);
      out.push([a[0] + (b[0] - a[0]) * t, 0]);
    }
  }
  return out;
}

/** The back half of a plan with an optional back-half hole: a C-shaped ring
 *  whose straight edges along y = 0 are the section faces. */
export function halfRing(outer, hole, side) {
  const shell = clipBack(outer, side);
  if (!hole) return shell;
  const cut = clipBack(hole, side);
  // The shell's cut edge runs between its two points on y = 0; splice the hole
  // (traversed the other way) into that edge so the ring stays simple.
  const onPlane = (p) => Math.abs(p[1]) < 1e-6;
  const i = shell.findIndex((p, k) => onPlane(p) && onPlane(shell[(k + 1) % shell.length]));
  const rotated = shell.slice(i + 1).concat(shell.slice(0, i + 1)); // starts after the cut edge
  const start = rotated[0];
  const j = cut.findIndex((p, k) => onPlane(p) && onPlane(cut[(k + 1) % cut.length]));
  let inner = cut.slice(j + 1).concat(cut.slice(0, j + 1)).reverse();
  // join the hole end nearer the shell's last point first
  const end = rotated[rotated.length - 1];
  if (Math.abs(inner[0][0] - end[0]) > Math.abs(inner[inner.length - 1][0] - end[0])) inner = inner.reverse();
  return rotated.concat(inner, [start]).slice(0, -1);
}

/** 45° hatch lines on a rectangle of the section plane y = 0 (x0..x1, z0..z1). */
export function hatch(x0, x1, z0, z1, gap, P) {
  const out = [];
  for (let c = x0 - (z1 - z0); c < x1; c += gap) {
    // line x - z' = c, with z' = z - z0
    let a = [c, 0];
    let b = [c + (z1 - z0), z1 - z0];
    if (a[0] < x0) a = [x0, x0 - c];
    if (b[0] > x1) b = [x1, x1 - c];
    if (b[0] - a[0] < 0.6) continue;
    out.push(pathOf([iso([a[0], 0, z0 + a[1]], P), iso([b[0], 0, z0 + b[1]], P)]));
  }
  return out.join("");
}
