/* aipla-physics 0.1.0 — small, tested physics helpers for AIPLA sims.
 * Served at /vendor/aipla-physics/0.1.0/aipla-physics.js; exposes window.AIPLA_PHYSICS.
 * Written in this repo (not an npm package; exception recorded in
 * .claude/skills/mcp-app-artefact/resources/vendored-libraries.md). Tests:
 * infrastructure/mcp-sandbox/__tests__/aipla-physics.test.ts. A published path
 * never changes content: a change is a new version beside this one.
 *
 * Why it exists: generated sims re-derive the same pieces every time, and these
 * are where the physics silently goes wrong — a frame-rate-dependent Euler step,
 * a collision that does not conserve momentum, a decimal point in a Danish
 * readout. Kinematics and oscillations need an integrator, not an engine;
 * 1D collisions are solved exactly here. matter.js is for 2D contact.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- constants
  var G_DK = 9.82; // m/s², the value Danish gymnasium uses
  var G_STD = 9.80665;

  // ---------------------------------------------------------------- vectors ([x, y])
  var vec = {
    add: function (a, b) { return [a[0] + b[0], a[1] + b[1]]; },
    sub: function (a, b) { return [a[0] - b[0], a[1] - b[1]]; },
    scale: function (a, k) { return [a[0] * k, a[1] * k]; },
    dot: function (a, b) { return a[0] * b[0] + a[1] * b[1]; },
    len: function (a) { return Math.hypot(a[0], a[1]); },
    norm: function (a) { var l = Math.hypot(a[0], a[1]); return l ? [a[0] / l, a[1] / l] : [0, 0]; },
    rotate: function (a, rad) {
      var c = Math.cos(rad), s = Math.sin(rad);
      return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
    },
    fromAngle: function (rad, length) { var l = length == null ? 1 : length; return [Math.cos(rad) * l, Math.sin(rad) * l]; },
  };

  // ---------------------------------------------------------------- integrators
  // State is an array of numbers; derivs(t, y) returns dy/dt as an array of the same length.
  function rk4(derivs, t, y, dt) {
    var n = y.length, i, k1 = derivs(t, y), y2 = new Array(n), y3 = new Array(n), y4 = new Array(n), out = new Array(n);
    for (i = 0; i < n; i++) y2[i] = y[i] + (dt / 2) * k1[i];
    var k2 = derivs(t + dt / 2, y2);
    for (i = 0; i < n; i++) y3[i] = y[i] + (dt / 2) * k2[i];
    var k3 = derivs(t + dt / 2, y3);
    for (i = 0; i < n; i++) y4[i] = y[i] + dt * k3[i];
    var k4 = derivs(t + dt, y4);
    for (i = 0; i < n; i++) out[i] = y[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    return out;
  }

  // Velocity Verlet for x'' = acc(x, t): energy-stable for oscillators and orbits.
  // x, v: arrays (or numbers); returns { x, v }.
  function verlet(acc, t, x, v, dt) {
    var scalar = typeof x === "number";
    var X = scalar ? [x] : x, V = scalar ? [v] : v, n = X.length, i;
    var a0 = acc(scalar ? X[0] : X, t);
    a0 = scalar ? [a0] : a0;
    var x1 = new Array(n);
    for (i = 0; i < n; i++) x1[i] = X[i] + V[i] * dt + 0.5 * a0[i] * dt * dt;
    var a1 = acc(scalar ? x1[0] : x1, t + dt);
    a1 = scalar ? [a1] : a1;
    var v1 = new Array(n);
    for (i = 0; i < n; i++) v1[i] = V[i] + 0.5 * (a0[i] + a1[i]) * dt;
    return scalar ? { x: x1[0], v: v1[0] } : { x: x1, v: v1 };
  }

  // Integrate from t0 to t1 in fixed steps; returns [{ t, y }] samples (every `every` steps).
  function simulate(derivs, y0, t0, t1, dt, every) {
    var out = [{ t: t0, y: y0.slice() }], y = y0.slice(), t = t0, k = 0, step = every || 1;
    while (t < t1 - 1e-12) {
      var h = Math.min(dt, t1 - t);
      y = rk4(derivs, t, y, h);
      t += h;
      k++;
      if (k % step === 0 || t >= t1 - 1e-12) out.push({ t: t, y: y.slice() });
    }
    return out;
  }

  // ---------------------------------------------------------------- the animation loop
  // Physics advances in fixed steps of `dt` seconds of SIMULATED time whatever the
  // frame rate; `speed` scales simulated time per real second. step(dt, t) advances
  // the model; draw(t) paints. Pauses itself while the tab is hidden.
  // Returns { start, stop, running, reset(t), setSpeed(k), time() }.
  function loop(opts) {
    var dt = opts.dt || 1 / 240, speed = opts.speed == null ? 1 : opts.speed, maxSteps = opts.maxSteps || 2000;
    var t = 0, acc = 0, last = null, raf = null, on = false;
    function frame(now) {
      if (!on) return;
      if (last === null) last = now;
      var real = Math.min((now - last) / 1000, 0.25); // a long stall does not explode the model
      last = now;
      acc += real * speed;
      var n = 0;
      while (acc >= dt && n < maxSteps) {
        opts.step(dt, t);
        t += dt;
        acc -= dt;
        n++;
      }
      if (opts.draw) opts.draw(t);
      raf = root.requestAnimationFrame(frame);
    }
    var api = {
      start: function () { if (on) return; on = true; last = null; raf = root.requestAnimationFrame(frame); },
      stop: function () { on = false; if (raf !== null) root.cancelAnimationFrame(raf); raf = null; },
      running: function () { return on; },
      reset: function (t0) { t = t0 || 0; acc = 0; last = null; if (opts.draw) opts.draw(t); },
      setSpeed: function (k) { speed = k; },
      time: function () { return t; },
    };
    if (root.document && root.document.addEventListener) {
      root.document.addEventListener("visibilitychange", function () {
        if (root.document.hidden) { if (on) { api.stop(); api._resume = true; } }
        else if (api._resume) { api._resume = false; api.start(); }
      });
    }
    return api;
  }

  // ---------------------------------------------------------------- collisions (exact)
  // 1D, coefficient of restitution e (1 elastic, 0 perfectly inelastic). Momentum is
  // conserved exactly; kinetic energy is lost by (1 - e²) of the relative-motion energy.
  function collide1d(m1, v1, m2, v2, e) {
    var r = e == null ? 1 : e, M = m1 + m2;
    var u1 = (m1 * v1 + m2 * v2 + m2 * r * (v2 - v1)) / M;
    var u2 = (m1 * v1 + m2 * v2 + m1 * r * (v1 - v2)) / M;
    return [u1, u2];
  }

  // Two smooth discs, positions p, velocities v (vectors), masses m, restitution e.
  // Exchanges impulse along the line of centres only (no friction, no spin).
  // Returns [va', vb'], or null when they are not approaching (already separating).
  function collideDiscs(pa, va, ma, pb, vb, mb, e) {
    var n = vec.norm(vec.sub(pb, pa));
    var rel = vec.dot(vec.sub(va, vb), n);
    if (rel <= 0) return null;
    var r = e == null ? 1 : e;
    var j = ((1 + r) * rel) / (1 / ma + 1 / mb);
    return [vec.sub(va, vec.scale(n, j / ma)), vec.add(vb, vec.scale(n, j / mb))];
  }

  // A wall: reverse and scale the normal component. normal is a unit vector out of the wall.
  function bounce(v, normal, e) {
    var r = e == null ? 1 : e, vn = vec.dot(v, normal);
    if (vn >= 0) return v;
    return vec.sub(v, vec.scale(normal, (1 + r) * vn));
  }

  function kineticEnergy(m, v) { var s = typeof v === "number" ? v * v : vec.dot(v, v); return 0.5 * m * s; }
  function momentum(m, v) { return typeof v === "number" ? m * v : vec.scale(v, m); }

  // ---------------------------------------------------------------- measurement
  // A seeded generator (mulberry32) so a run's "measurement noise" can be reproduced.
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      uniform: function (lo, hi) { return lo + (hi - lo) * next(); },
      // Box–Muller
      gauss: function (mean, sd) {
        var u = 1 - next(), v = next();
        return (mean || 0) + (sd == null ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
    };
  }

  // What an instrument with this resolution would read (0.01 → nearest hundredth).
  function reading(value, resolution) {
    if (!resolution) return value;
    var k = Math.round(value / resolution) * resolution;
    var d = Math.max(0, -Math.floor(Math.log10(resolution) + 1e-9));
    return Number(k.toFixed(d));
  }

  // ---------------------------------------------------------------- formatting
  // Numbers as the reader's language writes them: "da" uses a decimal comma and a
  // non-breaking space before the unit ("9,82 m/s²"); "en" a decimal point.
  function format(x, decimals, lang) {
    if (typeof x !== "number" || !isFinite(x)) return "–";
    var d = decimals == null ? 2 : decimals;
    var s = x.toFixed(d);
    if (s === "-" + (0).toFixed(d)) s = (0).toFixed(d);
    if (s.charAt(0) === "-") s = "−" + s.slice(1);
    return String(lang || "da").slice(0, 2) === "da" ? s.replace(".", ",") : s;
  }
  function withUnit(x, decimals, unit, lang) { return format(x, decimals, lang) + (unit ? " " + unit : ""); }

  // ---------------------------------------------------------------- canvas
  // Size a canvas for crisp lines on any screen; returns its 2D context scaled to CSS pixels.
  function fitCanvas(canvas, cssWidth, cssHeight) {
    var dpr = Math.min(root.devicePixelRatio || 1, 3);
    canvas.style.width = cssWidth + "px";
    canvas.style.height = cssHeight + "px";
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  root.AIPLA_PHYSICS = {
    version: "0.1.0",
    G_DK: G_DK,
    G_STD: G_STD,
    vec: vec,
    rk4: rk4,
    verlet: verlet,
    simulate: simulate,
    loop: loop,
    collide1d: collide1d,
    collideDiscs: collideDiscs,
    bounce: bounce,
    kineticEnergy: kineticEnergy,
    momentum: momentum,
    rng: rng,
    reading: reading,
    format: format,
    withUnit: withUnit,
    fitCanvas: fitCanvas,
  };
})(typeof window !== "undefined" ? window : globalThis);
