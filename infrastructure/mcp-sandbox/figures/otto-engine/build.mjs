// Builds infrastructure/mcp-sandbox/artefacts/otto-engine/v1/index.html — a
// half-section single-cylinder four-stroke engine on a bench, drawn with the
// vendored anatomy kit (.claude/skills/anatomy, see its AIPLA.md), beside a live
// p-V diagram. Run from the repo root:
//
//   node infrastructure/mcp-sandbox/figures/otto-engine/build.mjs && make sim-build
//
// This directory is NOT shipped (the sandbox image copies only `artefacts/`).
// The static art is built here; the parts that move are drawn by live.js in the
// page from the same model.mjs and geom.mjs, so the picture and the numbers
// cannot disagree.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../../../.claude/skills/anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../../../.claude/skills/anatomy/scripts/inline-kit.mjs";
import * as M from "./model.mjs";
import { halfRing, hatch, polySolid, prismY, circle2 } from "./geom.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../..");
const OUT = join(REPO, "infrastructure/mcp-sandbox/artefacts/otto-engine/v1/index.html");

const WIDTH = 520;
const HEIGHT = 470;

// ---- the world (units ≈ 1 px of a small engine; z up; crank axis along y) ----
const PLATE = { x: -112, y: -78, w: 224, d: 156, r: 8 };
const PLATE_H = 9;
const FOOT_H = 5;

const CASE = { x: -48, y: -36, w: 96, d: 72, r: 8 };
const CASE_HOLE = { x: -34, y: -27, w: 68, d: 54, r: 6 };
const CASE_FLOOR = 8;
const CASE_TOP = 70;

const BORE_R = 24;
const BLOCK = { x: -32, y: -32, w: 64, d: 64, r: 6 };
const FIN = { x: -44, y: -44, w: 88, d: 88, r: 9 };
const FIN_T = 2.2;
const FINS = [80, 90, 100, 110, 120, 130];

// Piston crown at r = 6 sits 14 above the pin; the head is placed so that the
// clearance at r = 6 is stroke/(r-1). Higher r = a taller crown (live.js).
const CROWN_ABOVE_PIN = 14;
const STROKE = M.PIN_TDC - M.PIN_BDC;
const HEAD_Z = M.PIN_TDC + CROWN_ABOVE_PIN + STROKE / (M.R_RANGE[0] - 1);
const HEAD = { x: -38, y: -38, w: 76, d: 76, r: 6 };
const HEAD_H = 22;
const COVER = { x: -30, y: -30, w: 60, d: 60, r: 9 };
const COVER_Z = HEAD_Z + HEAD_H;
const COVER_H = 20;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [0, 0, COVER_Z + COVER_H + 22], [-90, 0, 170], [92, 0, 172]],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 40 },
);
const [, VY] = k.towardViewer(P);
const SIDE = VY > 0 ? 1 : -1; // the half with y·SIDE > 0 is cut away
const back = (v) => -SIDE * v; // a y that is v units behind the section plane

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const ex = (ring, z, h, bevel = 0) => k.extrude(ring, z, h, P, { convex: false, bevel });
const half = (plan, hole) => halfRing(k.roundedPlan(plan, 3), hole ? k.roundedPlan(hole, 3) : null, SIDE);
const halfBore = (plan) => halfRing(k.roundedPlan(plan, 3), k.circleRing(0, 0, BORE_R, 32), SIDE);
const hatchSvg = (spans, z0, z1) => L(spans.map(([a, b]) => hatch(a, b, z0, z1, 4.2, P)).join(""), { tone: "lo" });

function bench() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of k.corners(PLATE, 20).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 20), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.4), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(PLATE, 9);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // Ruler strip along the front edge, and the four hold-down bolts of the case.
  const strip = { x: -96, y: PLATE.y + PLATE.d - 14, w: 192, d: 7, r: 1 };
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 4, 5, strip.y + 0.8, 0.6, [2, 3.6], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // Label plate (engraved rule lines stand for printed text).
  const label = { x: -100, y: -70, w: 40, d: 18, r: 1.5 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3, 0.3), { tone: "mid" }));
  out.push(L([5, 9, 13].map((dy) => k.lineOnTop([label.x + 5, label.y + dy], [label.x + label.w - 5, label.y + dy], 0.8, P)).join(""), { tone: "lo", free: "both" }));
  out.push(D(k.corners(label, 2.4).map(([x, y]) => at([x, y, 0.8])), { size: 0.4 }));
  return out.join("");
}

function crankcase() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(CASE, 0, 4, P)}" style="filter:blur(3px)"/>`);
  // Mounting feet with bolts, then floor and walls, cut through the axis.
  for (const x of [-56, 56]) {
    const foot = { x: x - 8, y: back(30) - (SIDE > 0 ? 0 : 0), w: 16, d: 30, r: 2 };
    foot.y = SIDE > 0 ? -34 : 4;
    out.push(S(ex(halfRing(k.roundedPlan(foot, 3), null, SIDE), 0, 5, 0.4), { tone: "mid" }));
    out.push(D([at([x, back(10), 5])], { size: 0.55 }));
  }
  out.push(S(ex(half(CASE), 0, CASE_FLOOR, 0.6), { tone: "mid" }));
  out.push(S(ex(half(CASE, CASE_HOLE), CASE_FLOOR, CASE_TOP - CASE_FLOOR, 0.6), { tone: "mid" }));
  out.push(hatchSvg([[CASE.x, CASE_HOLE.x], [CASE_HOLE.x + CASE_HOLE.w, CASE.x + CASE.w]], CASE_FLOOR, CASE_TOP));
  out.push(hatchSvg([[CASE.x, CASE.x + CASE.w]], 0, CASE_FLOOR));
  // Main bearing boss on the back wall, where the crank axle comes through.
  out.push(polySolid(prismY(circle2(0, M.CRANK_Z, 11, 28), back(36), back(27)), P, { tone: "mid" }));
  out.push(polySolid(prismY(circle2(0, M.CRANK_Z, 7, 24), back(27), back(14)), P, { tone: "mid" }));
  // Split-line bolts along the case top.
  out.push(D([-40, -20, 20, 40].map((x) => at([x, back(31), CASE_TOP])), { size: 0.5 }));
  return out.join("");
}

function block() {
  const out = [];
  out.push(S(ex(halfBore(BLOCK), CASE_TOP, HEAD_Z - CASE_TOP, 0.4), { tone: "mid" }));
  out.push(hatchSvg([[BLOCK.x, -BORE_R], [BORE_R, BLOCK.x + BLOCK.w]], CASE_TOP, HEAD_Z));
  for (const z of FINS) {
    out.push(S(ex(half(FIN, BLOCK), z, FIN_T, 0.3), { tone: "mid", crease: "none" }));
    out.push(L(hatch(FIN.x, BLOCK.x, z, z + FIN_T, 2.6, P) + hatch(BLOCK.x + BLOCK.w, FIN.x + FIN.w, z, z + FIN_T, 2.6, P), { tone: "lo" }));
  }
  // Cylinder base flange bolts.
  out.push(D([-26, 26].map((x) => at([x, back(26), CASE_TOP + 0.5])), { size: 0.5 }));
  return out.join("");
}

function head() {
  const out = [];
  out.push(S(ex(half(HEAD), HEAD_Z, HEAD_H, 0.6), { tone: "mid" }));
  out.push(hatchSvg([[HEAD.x, -16], [-8, -4], [4, 8], [16, HEAD.x + HEAD.w]], HEAD_Z, HEAD_Z + HEAD_H));
  // Head bolts at the corners, and the rocker cover with its own section.
  out.push(D(k.corners(HEAD, 6).filter(([, y]) => y * SIDE <= 0).map(([x, y]) => at([x, y, HEAD_Z + HEAD_H])), { size: 0.6 }));
  out.push(S(ex(half(COVER), COVER_Z, COVER_H, 0.8), { tone: "mid" }));
  out.push(hatchSvg([[COVER.x, COVER.x + 3], [COVER.x + COVER.w - 3, COVER.x + COVER.w]], COVER_Z, COVER_Z + COVER_H));
  out.push(L(hatch(COVER.x, COVER.x + COVER.w, COVER_Z + COVER_H - 3, COVER_Z + COVER_H, 3, P), { tone: "lo" }));
  return out.join("");
}

// Intake (air filter + manifold) on -x, exhaust (manifold + silencer) on +x.
function intake() {
  const out = [intakeStand()];
  const z0 = HEAD_Z + 5;
  out.push(S(k.slabOf({ x: -66, y: -8, w: 30, d: 16, r: 3 }, z0, 11, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: -40, y: -11, w: 3, d: 22, r: 1 }, z0 - 2, 15, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([-38.5, -7, z0 + 13]), at([-38.5, 7, z0 + 13])], { size: 0.45 }));
  const fx = -80;
  out.push(S(k.cylinder(fx, 0, 14, z0 - 26, 4, P, 28, 0.5), { tone: "mid" }));
  out.push(S(k.cylinder(fx, 0, 13, z0 - 22, 38, P, 28), { tone: "mid", crease: "none" }));
  out.push(L([z0 - 16, z0 - 10, z0 - 4, z0 + 2, z0 + 8].map((z) => k.sideArc(fx, 0, 13, z, P, 30)).join(""), { tone: "faint" }));
  out.push(S(k.cylinder(fx, 0, 14.5, z0 + 16, 4, P, 28, 0.6), { tone: "mid" }));
  out.push(S(k.cylinder(fx, 0, 3, z0 + 20, 3, P, 18), { tone: "mid" }));
  return out.join("");
}

// The filter stands on its own post, like the silencer; drawn first so the
// canister sits on it.
function intakeStand() {
  const fx = -80;
  const z0 = HEAD_Z + 5;
  return [
    S(k.slabOf({ x: fx - 8, y: -8, w: 16, d: 16, r: 2 }, 0, 2, P, 3, 0.3), { tone: "mid" }),
    D([at([fx - 5, -5, 2]), at([fx + 5, 5, 2])], { size: 0.45 }),
    S(k.slabOf({ x: fx - 3, y: -3, w: 6, d: 6, r: 1 }, 2, z0 - 28, P, 2, 0.3), { tone: "mid" }),
  ].join("");
}

// The exhaust leaves the head on +x and turns BACK, so nothing on the near side
// crosses the cutaway (first build: a straight manifold covered the chamber).
const EXH_X = 62;
const EXH_Y = 40; // silencer centre, behind the section plane
function exhaust() {
  const out = [];
  const z0 = HEAD_Z + 5;
  const by = (a, b) => ({ y: Math.min(back(a), back(b)), d: Math.abs(back(a) - back(b)) });
  out.push(S(k.slabOf({ x: 37, y: -11, w: 3, d: 22, r: 1 }, z0 - 2, 15, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([38.5, back(7), z0 + 13])], { size: 0.45 }));
  out.push(S(k.slabOf({ x: 40, ...by(-7, 7), w: 10, r: 2 }, z0, 10, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 38.5, ...by(7, EXH_Y - 6), w: 13, r: 3 }, z0, 10, P, 4, 0.5), { tone: "mid" }));
  out.push(S(k.slabOf({ x: 45, ...by(EXH_Y - 6, EXH_Y + 6), w: EXH_X - 45, r: 2 }, z0, 10, P, 3, 0.4), { tone: "mid" }));
  const sx = EXH_X + 8;
  const sy = back(EXH_Y);
  out.push(S(k.slabOf({ x: sx - 8, y: sy - 8, w: 16, d: 16, r: 2 }, 0, 2, P, 3, 0.3), { tone: "mid" }));
  out.push(D([at([sx - 5, sy - 5, 2]), at([sx + 5, sy + 5, 2])], { size: 0.45 }));
  out.push(S(k.slabOf({ x: sx - 3, y: sy - 3, w: 6, d: 6, r: 1 }, 2, z0 - 52, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.cylinder(sx, sy, 11, z0 - 50, 3, P, 28, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(sx, sy, 10, z0 - 47, 62, P, 28), { tone: "mid", crease: "none" }));
  out.push(L([z0 - 40, z0 - 4].map((z) => k.sideArc(sx, sy, 10, z, P, 30)).join(""), { tone: "lo" }));
  out.push(S(k.cylinder(sx, sy, 11, z0 + 15, 3, P, 28, 0.4), { tone: "mid" }));
  out.push(S(k.cylinder(sx, sy, 3.4, z0 + 18, 12, P, 20), { tone: "mid" }));
  return out.join("");
}

// Painter's order: far side assembly, case, block, head, then the live interior
// (crank, rod, gas, piston, valves, plug), then the near side assembly.
const farFirst = true; // intake (far side) and the exhaust (now routed behind) both precede the case
const slot = (name) => `<g data-part="${name}"></g>`;
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "",
  body: [
    bench(),
    intake(),
    exhaust(),
    crankcase(),
    block(),
    head(),
    slot("crank-back"),
    slot("gas"),
    slot("piston"),
    slot("rod"),
    slot("pin"),
    slot("crank-front"),
    slot("valves"),
    slot("plug"),
    slot("flow"),
  ],
}).replace('aria-label=""', 'data-t-aria="figLabel"');

// ---- page ----
// The page needs the kit's drawing functions, not its page builders or its CSS
// string (that CSS is already in <style>): cut from swatchSvg to the end.
const runtimeKit = (() => {
  const src = kitScript();
  return src.slice(0, src.indexOf("function swatchSvg"));
})();
const strip = (src) => src.replace(/^import .*$/gm, "").replace(/^export /gm, "");
const bridge = (() => {
  const t = readFileSync(join(REPO, "infrastructure/mcp-sandbox/artefacts/_template/v1/index.html"), "utf8");
  const a = t.indexOf("<!-- @aipla-bridge:start");
  const b = t.indexOf("<!-- @aipla-bridge:end -->") + "<!-- @aipla-bridge:end -->".length;
  return t.slice(a, b);
})();
const constants = `
const P = ${JSON.stringify(P)};
const SIDE = ${SIDE};
const BORE_R = ${BORE_R};
const HEAD_Z = ${HEAD_Z};
const COVER_Z = ${COVER_Z};
const COVER_H = ${COVER_H};
const CROWN_ABOVE_PIN = ${CROWN_ABOVE_PIN};
const STROKE = ${STROKE};
const EXH_X = ${EXH_X};
`;
const css = readFileSync(join(HERE, "page.css"), "utf8");
const markup = readFileSync(join(HERE, "page.html"), "utf8").replace("{{FIGURE}}", svg);
const live = readFileSync(join(HERE, "live.js"), "utf8");

const html = `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Firetaktsmotoren</title>
<!--
  otto-engine — a four-stroke petrol engine and its ideal Otto cycle.
  GENERATED by infrastructure/mcp-sandbox/figures/otto-engine/build.mjs with the
  vendored anatomy kit; edit the sources there, not this file (the bridge block
  is the one part stamped separately, by make sim-build).

  What it deliberately does NOT show: the efficiency. The student reads Q_in and
  W for one cycle, computes eta = W / Q_in themselves, and finds how it depends on
  the compression ratio. The reference values live in the catalogue tutorBlock.
  The cycle is the IDEAL air-standard Otto cycle (instant combustion at TDC,
  instant blow-down at BDC); a real engine reaches roughly half of it, and that
  gap is a discussion the tutor leads, not something the sim models.
-->
<style>${k.ISO_CSS.replace(/font-size:10\.5px/g, "font-size:11px") /* AIPLA floor: no text under 11px */}${css}</style>
</head>
<body class="iso" data-theme="light">
${markup}
${bridge}
<script>
"use strict";
${runtimeKit}
${strip(readFileSync(join(HERE, "model.mjs"), "utf8"))}
${strip(readFileSync(join(HERE, "geom.mjs"), "utf8"))}
${constants}
${live}
</script>
</body>
</html>
`;

mkdirSync(dirname(OUT), { recursive: true });
// An inline script ends at the first "</script" anywhere in it, strings included.
const safe = html.replace(/(<script>)([\s\S]*?)(<\/script>\s*<\/body>)/, (_, a, body, c) => a + body.replace(/<\/(script)/gi, "<\\/$1") + c);
writeFileSync(OUT, safe);
console.log(`wrote ${OUT} (${(safe.length / 1024).toFixed(1)} KB, side ${SIDE}, head at z ${HEAD_Z.toFixed(1)})`);
