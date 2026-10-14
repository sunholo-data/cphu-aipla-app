# Collisions and contact with matter.js

First decide whether you need it.

| The sim | Use |
|---|---|
| Carts or balls colliding **on a line** (a momentum lab) | `AIPLA_PHYSICS.collide1d`: exact. Students compute momentum before and after and it must balance; matter.js's solver is approximate |
| Smooth balls bouncing off each other and the walls | `AIPLA_PHYSICS.collideDiscs` + `bounce`: exact and simple |
| Blocks stacking, sliding with friction, a ramp, rolling, chains, many bodies at once | **matter.js** |

## Load it

In `<head>`, exactly:

```html
<script src="/vendor/matter-js/0.20.0/matter.min.js"
        integrity="sha384-HASH:matter.min.js"
        crossorigin="anonymous"></script>
```

It defines the global `Matter`.

## Units

matter.js works in **pixels** and **steps**, not metres and seconds. Choose a
scale and keep it in one place:

```js
const PX_PER_M = 100;                       // 1 m on screen = 100 px
const DT = 1000 / 120;                      // ms per physics step (fixed)
engine.gravity.scale = 0.001;               // matter's default; then
engine.gravity.y = 9.82 / 9.81;             // ≈ 1 → ~9.8 m/s² at 100 px/m
const speedMs = (body) => (body.speed * (1000 / DT)) / PX_PER_M; // m/s, for a readout
```

## A ramp with a block (friction)

```js
const { Engine, Bodies, Composite, Body } = Matter;
const engine = Engine.create();
const ramp = Bodies.rectangle(320, 260, 520, 16, { isStatic: true, angle: -0.35, friction: 0.3 });
const floor = Bodies.rectangle(320, 350, 700, 20, { isStatic: true });
const block = Bodies.rectangle(150, 150, 40, 30, { friction: 0.3, frictionStatic: 0.5, restitution: 0 });
Composite.add(engine.world, [ramp, floor, block]);

// Step with the fixed-step loop from aipla-physics, NOT Matter.Runner:
const sim = AIPLA_PHYSICS.loop({
  dt: DT / 1000,
  step() { Engine.update(engine, DT); },
  draw() { render(); },
});
```

Draw it yourself on a canvas (or SVG) from `body.position`, `body.angle` and
`body.vertices`; do not use `Matter.Render` (it is a debug view, not a sim).

```js
function drawBody(ctx, body) {
  ctx.beginPath();
  body.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
  ctx.closePath(); ctx.fill(); ctx.stroke();
}
```

## Rules

- **Fixed step.** Always `Engine.update(engine, DT)` with the same `DT`, from
  `AIPLA_PHYSICS.loop`. A varying step changes the physics.
- **Readouts from the bodies**, converted with your one scale, through
  `AIPLA_PHYSICS.format`.
- **Measured momentum or energy is approximate here** (a few per cent). If the
  sim shows them, say so on screen ("ca.") or use the exact 1D/disc helpers.
- Restitution 0–1 and friction 0–1 per body; `isStatic: true` for ground and walls.
- Reset by removing and re-adding the bodies (`Composite.clear(engine.world, false)`),
  or `Body.setPosition` / `Body.setVelocity` / `Body.setAngle` / `Body.setAngularVelocity`
  to the start values.
- No `Matter.Runner`, no `Matter.Render`, no `Matter.Mouse` debug drag: the student
  acts through the sim's own controls.
