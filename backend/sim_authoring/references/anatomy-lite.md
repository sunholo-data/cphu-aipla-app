# The anatomy kit, for a sim (anatomy-lite)

You may draw the apparatus with the **anatomy kit**: a small library that turns
3D world geometry into crafted isometric SVG (shaded solids, seams, ticks,
screws), so the student sees a real instrument rather than boxes and arrows.
It is a cut of the anatomy skill (github.com/wheresryan22/anatomy, MIT) for
AIPLA sims: the browser drawing functions only, no build step, no WebGL.

## Load it

One of the few vendored scripts a sim may load (the others: `physics-helper`,
`plots`, `collisions`). Exactly this tag, in `<head>`:

```html
<script src="/vendor/anatomy-kit/689dcf9/iso-kit.js"
        integrity="sha384-NDD+aJ7n1r1Dqby+WDZG35lXeSNJzeiyL9DtU0CZYBm0ZFab2pK8D39Xoyl5fBuz"
        crossorigin="anonymous"></script>
```

It defines the functions below as globals and injects the kit's CSS. Put
`class="iso" data-theme="light"` on the element that holds the drawing (or on
`<body>`); without it the solids have no colours.

## The one idea

**The object is the explanation.** Build the real apparatus the concept lives in
(an engine block, a kettle on a bench, a ripple tank), with many small, true
parts: a base plate on feet, screws at its corners, a ruler strip with ticks,
posts, a carriage, knobs, a label plate. Every number the sim shows and every
moving part comes from ONE model function of the sim state, so the picture can
never disagree with the readouts. Typically 30–60 solids; keep the page under
200 KB.

## How to build

1. **World units**, about 1 unit per mm of the real thing. x and y on the floor,
   **z up**. Plans are rounded rectangles `{x, y, w, d, r}` on the floor.
2. **Camera once**: `const P = fitProjection(points, W, H, { pad: 20 })` where
   `points` are the extreme corners (`boxCorners(plan, z0, z1)`) and the tallest
   tip. Default azimuth 45°, elevation 30°.
3. **Static parts once** into a string; **moving parts rebuilt each frame** from
   the model, then `figureSvg({ width, height, label, body })` into the page.
   Rebuild only what moves.
4. **Paint back to front**: later strings cover earlier ones. Sort repeated parts
   with `depthOf(point, P)` (larger = nearer). Split a part that wraps another
   (a spring round a rod) into back and front halves.
5. **Cutaways**: to show inside a cylinder or a chamber, do not draw the near
   wall: draw the far half, the inside parts, then only the parts of the near
   side that are really in front. A whole solid in front hides what it contains.
6. **Tones**: base and feet `lo`, structure `mid`, the subject `hi`, and exactly
   one part `lit: true`, the one the student should watch. Grooves `faint`.
   Colour only when colour is the physics (hot gas, a valve open).

## Limits to know

- Solids are **prisms extruded straight up (z)**. A vertical disc (a crank, a
  wheel facing the viewer) is a face drawn with `sideRing(center, r, "y", P)`,
  filled with `<path class="iso-fill" d=…>` and outlined with `lineSvg`. A
  horizontal rod is a `segment` line, or a thin `slabOf` along x or y.
- Rotation about z cannot be a CSS transform: rebuild those paths each frame.
- No WebGL, no canvas mixing: the drawing is one SVG.

## Functions (all take the projection `P` last unless shown)

| Function | Returns / does |
|---|---|
| `fitProjection(points, W, H, { pad, azimuth, elevation })` | the projection `P` |
| `iso([x,y,z], P)` | screen point `[sx, sy]` |
| `depthOf([x,y,z], P)` | depth; larger is nearer |
| `boxCorners(plan, z0, z1)`, `corners(plan, inset)` | points for fitting; four inset floor points (feet, screws) |
| `slabOf(plan, z, h, P, steps=8, bevel=0)` | a rounded box (solid) |
| `cylinder(cx, cy, r, z, h, P, steps=32, bevel=0)` | an upright cylinder (solid) |
| `extrude(ring, z, h, P, { convex: false })` | any floor outline `[[x,y],…]` extruded up (solid) |
| `circleRing(cx, cy, r, steps)`, `insetPlan(plan, by)` | floor outlines |
| `solidSvg(solid, { tone, lit, halo, inner })` | SVG for a solid. `inner` = extra line markup under its outline (seams) |
| `lineSvg(d, { tone, dashed, dotted, flow })` | SVG for a path `d`. `flow: true` animates dashes along it (gas flow) |
| `dotsSvg(screenPoints, { size, tone })` | screws, rivets, pins |
| `segment(a, b, P)`, `rise(at, z0, z1, P)` | a 3D line; a vertical line |
| `onTop(points, z, P, closed)`, `planOutline(plan, z, P)`, `ring(cx, cy, r, z, P)` | lines on a top face (grooves, inlays, seats) |
| `sideArc(cx, cy, r, z, P)`, `sideSeam(plan, z, P)` | a band round a cylinder; a seam round a box |
| `sideRing([x,y,z], r, "x"|"y", P)` | a circle on a vertical face (bores, discs, lenses) |
| `coil(from, to, [cy, cz], r, turns, "x"|"y", P)` | `{back, front}` spring halves |
| `topTicks(from, to, step, every, edge, z, [minor, major], P)` | `{minor, major}` ruler ticks |
| `radialTicks(cx, cy, r, count, every, z, [minor, major], P)` | dial ticks |
| `knurl(cx, cy, r, z0, z1, count, P)` | grip lines on a knob |
| `pointsAt(points3, P)` | project many points (for `dotsSvg`) |
| `haloOf(plan, z, h, P)` | a soft shadow path: `<path class="iso-halo" d=…>` |
| `translateAlong(P, [dx,dy,dz])` | a `transform` string to slide a pre-built group |
| `figureSvg({ width, height, label, body })` | the `<svg>` wrapping it all |

## A worked example (it runs)

```js
// World units, z up. A base plate on four feet, a cylinder on two posts, a piston moved by a crank.
const W = 640, H = 420;
const base = { x: 0, y: 0, w: 160, d: 100, r: 6 };
const P = fitProjection([...boxCorners(base, 0, 4), [80, 50, 150]], W, H, { pad: 20 });
const CRANK = { x: 80, y: 50, z: 30, r: 14 }, ROD = 46;

// Static parts: built once.
let still = "";
still += `<path class="iso-halo" d="${haloOf(base, 0, 4, P)}"/>`;
for (const [fx, fy] of corners(base, 8)) still += solidSvg(cylinder(fx, fy, 4, -3, 3, P, 16), { tone: "lo" });
still += solidSvg(slabOf(base, 0, 4, P, 8, 0.6), { tone: "lo" });
still += lineSvg(planOutline(insetPlan(base, 5), 4, P), { tone: "faint" });
for (const pt of pointsAt(corners(base, 5).map(([x, y]) => [x, y, 4]), P)) still += dotsSvg([pt], { size: 0.5 });
const t = topTicks(10, 150, 5, 4, 92, 4, [2, 4], P);
still += lineSvg(t.minor, { tone: "lo" }) + lineSvg(t.major, { tone: "mid" });
for (const px of [40, 120]) still += solidSvg(slabOf({ x: px - 4, y: 46, w: 8, d: 8, r: 1 }, 4, 70, P, 2), { tone: "mid" });

// Moving parts: rebuilt each frame from one model, painted back to front.
function pinZ(th) { return CRANK.z + CRANK.r * Math.cos(th) + Math.sqrt(ROD * ROD - (CRANK.r * Math.sin(th)) ** 2); }
function frame(th) {
  const pin = [CRANK.x + CRANK.r * Math.sin(th), CRANK.y, CRANK.z + CRANK.r * Math.cos(th)];
  const top = pinZ(th);
  let s = still;
  // A vertical disc: kit solids only extrude upward, so draw its face with sideRing (filled, then outlined).
  const disc = sideRing([CRANK.x, CRANK.y + 4, CRANK.z], 18, "y", P, 40);
  s += `<path class="iso-fill" d="${disc}"/>` + lineSvg(disc, { tone: "mid" });
  s += lineSvg(segment(pin, [CRANK.x, CRANK.y, top], P), { tone: "hi" });                         // rod
  s += solidSvg(cylinder(CRANK.x, CRANK.y, 14, top, 16, P, 32, 0.5), { tone: "hi", lit: true });  // piston (the subject)
  s += solidSvg(cylinder(CRANK.x, CRANK.y, 17, 74, 50, P, 40), { tone: "mid" });                  // cylinder barrel
  s += dotsSvg([iso(pin, P)], { size: 1.2, tone: "hi" });
  document.getElementById("fig").innerHTML = figureSvg({ width: W, height: H, label: "A piston driven by a crank", body: s });
}
let th = 0; (function loop() { th += 0.05; frame(th); requestAnimationFrame(loop); })();
```

Grow this the same way: more true parts on the base, the subject drawn as a
cutaway, every moving part from the model, the readouts and the p-V or T-t chart
beside it reading the same model.
