# aipla-physics: the helper every moving sim should use

A small library written and tested for AIPLA sims. Use it instead of writing
your own loop, integrator, collision or number formatting: those are where a sim's
physics silently goes wrong (a step that depends on the frame rate, a collision
that does not conserve momentum, a Danish readout with a decimal point).

## Load it

In `<head>`, exactly:

```html
<script src="/vendor/aipla-physics/0.1.0/aipla-physics.js"
        integrity="sha384-HASH:aipla-physics.js"
        crossorigin="anonymous"></script>
```

Everything is on `window.AIPLA_PHYSICS` (below: `P`).

## Which tool for which physics

| Physics | Use |
|---|---|
| Kinematics, free fall, projectiles, circular motion | a closed formula of `t` if there is one; otherwise `P.rk4` |
| Springs, pendulums, orbits (anything that oscillates) | `P.verlet` (keeps the energy; Euler drifts) |
| Two carts / balls colliding on a line | `P.collide1d` (exact: momentum conserved, energy by `e`) |
| Smooth discs colliding in 2D, a ball off a wall | `P.collideDiscs`, `P.bounce` |
| Stacking, friction contacts, many bodies, ramps | matter.js (`read_reference("collisions")`) |

## The loop: physics in fixed steps, whatever the screen

```js
const P = window.AIPLA_PHYSICS;
const state = { x: 1, v: 0 };              // ONE model state; draw from it only
const k = 4, m = 0.5;
const sim = P.loop({
  dt: 1 / 240,                              // simulated seconds per step
  step(dt) {                                // advance the model
    const s = P.verlet((x) => (-k * x) / m, 0, state.x, state.v, dt);
    state.x = s.x; state.v = s.v;
  },
  draw(t) { render(state, t); },            // paint the current state
});
startButton.onclick = () => (sim.running() ? sim.stop() : sim.start());
resetButton.onclick = () => { state.x = 1; state.v = 0; sim.reset(0); };
```

`P.loop` pauses itself while the tab is hidden, never takes more than 0.25 s
of real time per frame, and `sim.setSpeed(0.25)` gives slow motion. Use
`sim.time()` for the stopwatch, so the shown time IS the model's time.

## Integrators

```js
// y = [x, y, vx, vy]; derivs returns dy/dt
const g = P.G_DK;                           // 9.82 m/s², the Danish value
const derivs = (t, y) => [y[2], y[3], 0, -g];
let y = [0, 0, 12, 9];
y = P.rk4(derivs, t, y, dt);                // one step
const path = P.simulate(derivs, y0, 0, 2, 0.01, 5); // [{t, y}] every 5th step: a trajectory to draw
```

`P.verlet(acc, t, x, v, dt)` takes the acceleration `acc(x, t)` and works on a
number or an array; it returns `{ x, v }`.

## Collisions (exact)

```js
const [u1, u2] = P.collide1d(m1, v1, m2, v2, e);   // e: 1 elastic … 0 sticks together
const after = P.collideDiscs(pa, va, ma, pb, vb, mb, e); // vectors [x, y]; null if already separating
v = P.bounce(v, [0, 1], 0.8);                       // floor: normal points up out of it
P.momentum(m, v); P.kineticEnergy(m, v);            // numbers or vectors
```

Detect the contact yourself (distance ≤ sum of radii, moving towards each
other), move the bodies apart to touching, then apply the new velocities.
**Call `P.collide1d` for the new velocities; do not write the formula
yourself.** It is the tested one, and the self-test can then check the sim's
use of it (momentum before = after) rather than re-derive the algebra.

## Defaults that show the physics

The sim's starting values must make the phenomenon happen on the FIRST press of
start: carts that actually meet, a ball that lands on screen, a pendulum that
swings. A default where "nothing happens" (two carts at the same velocity) is
the first thing a student sees and reads as broken.

## Measurements

```js
const noise = P.rng(1234);                         // seeded: a run can be repeated
const shown = P.reading(trueValue + noise.gauss(0, 0.02), 0.01); // what a 0.01-resolution meter reads
```

Give the student instrument readings, not the model's exact numbers, when the
activity is about measuring.

## Numbers on screen

```js
P.format(9.8166, 2, lang)             // "9,82" in Danish, "9.82" in English; "−1,5" with a real minus
P.withUnit(0.731, 3, "s", lang)       // "0,731 s" (non-breaking space)
```

`lang` is the sim's language from the bridge (`AIPLA_BRIDGE.hostContext().locale`).
Never use `toFixed` directly for a readout.

## Crisp canvas

```js
const ctx = P.fitCanvas(canvas, 640, 360); // CSS size; scales for the screen's pixel density
```

Then draw in CSS pixels. Re-call it when the layout width changes.
