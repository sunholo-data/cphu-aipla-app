// otto-engine — live code. Runs in the page after the inlined anatomy kit,
// model.mjs and geom.mjs (all as plain functions) and the build's constants.

const ARTEFACT_NAME = "otto-engine";
function emit(type, extra) {
  return AIPLA_BRIDGE.emit(ARTEFACT_NAME + "." + type, extra);
}

const strings = {
  da: {
    title: "Firetaktsmotoren",
    figNo: "Fig. 1",
    hint: "Start motoren, eller gå én takt ad gangen",
    figLabel:
      "En encylindret firetaktsmotor skåret igennem på langs. Stemplet bevæger sig op og ned i cylinderen, drevet af plejlstang og krumtap. To ventiler i toppen åbner og lukker, og en tændrør tænder blandingen.",
    keyFresh: "Frisk luft-benzin-blanding",
    keyBurning: "Brændende gas",
    keyExhaust: "Udstødningsgas",
    stroke_intake: "Indsugning",
    stroke_compression: "Kompression",
    stroke_power: "Arbejdstakt",
    stroke_exhaust: "Udstødning",
    start: "Start motoren",
    pause: "Pause",
    step: "Næste takt",
    measure: "Mål én cyklus",
    measuring: "Måler …",
    ratio: "Kompressionsforhold r",
    strokeL: "Takt",
    pressure: "Tryk p",
    volumeL: "Volumen V",
    temperature: "Temperatur T",
    recordTitle: "Målte cykler",
    colR: "r",
    colQ: "Tilført varme Q (J)",
    colW: "Arbejde W (J)",
    empty: "Ingen målinger endnu. Tryk »Mål én cyklus«.",
    pvTitle: "p-V-diagram for gassen i cylinderen",
    axisV: "V (cm³)",
    axisP: "p (bar)",
    areaHint: "Prikken følger gassen. Når du har målt en cyklus, er det farvede areal inden for løkken arbejdet W.",
    reset: "Nulstil",
    labelRun: "Startede motoren ved r = {r}",
    labelStep: "Gik videre til {stroke} (r = {r})",
    labelReading: "Målte én cyklus ved r = {r}: Q = {q} J, W = {w} J",
  },
  en: {
    title: "The four-stroke engine",
    figNo: "Fig. 1",
    hint: "Start the engine, or go one stroke at a time",
    figLabel:
      "A single-cylinder four-stroke engine cut in half lengthways. The piston moves up and down in the cylinder, driven by the connecting rod and crank. Two valves at the top open and close, and a spark plug ignites the mixture.",
    keyFresh: "Fresh air-fuel mixture",
    keyBurning: "Burning gas",
    keyExhaust: "Exhaust gas",
    stroke_intake: "Intake",
    stroke_compression: "Compression",
    stroke_power: "Power stroke",
    stroke_exhaust: "Exhaust",
    start: "Start the engine",
    pause: "Pause",
    step: "Next stroke",
    measure: "Measure one cycle",
    measuring: "Measuring …",
    ratio: "Compression ratio r",
    strokeL: "Stroke",
    pressure: "Pressure p",
    volumeL: "Volume V",
    temperature: "Temperature T",
    recordTitle: "Measured cycles",
    colR: "r",
    colQ: "Heat in Q (J)",
    colW: "Work W (J)",
    empty: "No measurements yet. Press “Measure one cycle”.",
    pvTitle: "p-V diagram of the gas in the cylinder",
    axisV: "V (cm³)",
    axisP: "p (bar)",
    areaHint: "The dot follows the gas. Once you have measured a cycle, the shaded area inside the loop is the work W.",
    reset: "Reset",
    labelRun: "Started the engine at r = {r}",
    labelStep: "Moved on to {stroke} (r = {r})",
    labelReading: "Measured one cycle at r = {r}: Q = {q} J, W = {w} J",
  },
};
let lang = "da";
let langLockedByStudent = false;
const t = (key) => (strings[lang] || strings.da)[key];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
function num(v, dp) {
  const s = v.toFixed(dp);
  return lang === "da" ? s.replace(".", ",") : s;
}

// ---- state ----
const SPEED = 90; // crank degrees per second: one full cycle in 8 s, slow enough to follow
const LIFT = 5; // valve lift in world units
let theta = 20;
let ratio = 8;
let running = false;
let stepTarget = null;
let measureFrom = null;
let measuredRatio = null;
let records = [];
let trail = [];
const pending = {};

const still = matchMedia("(prefers-reduced-motion: reduce)");
const svg = document.querySelector(".iso-stage svg");
const part = (name) => svg.querySelector(`[data-part="${name}"]`);
const $ = (id) => document.getElementById(id);

const crownExtra = (r) => STROKE / (R_RANGE[0] - 1) - STROKE / (r - 1);
const crownZ = (th) => pinZ(th) + CROWN_ABOVE_PIN + crownExtra(ratio);
const front = (v) => SIDE * v;
const back = (v) => -SIDE * v;

function simState() {
  const s = state(theta, ratio);
  return {
    crank_deg: Math.round(((theta % 720) + 720) % 720),
    stroke: strokeOf(theta),
    compression_ratio: ratio,
    p_bar: +s.p.toFixed(2),
    V_cm3: +s.v.toFixed(1),
    T_K: Math.round(s.t),
    running,
    measured_cycles: records.map((x) => ({ r: x.r, Q_J: x.q, W_J: x.w })),
  };
}

// ---- drawing: the moving parts ----
function webProfile(th) {
  const [px, pz] = crankPin(th);
  const a = (th * Math.PI) / 180;
  const cw = [-Math.sin(a) * 6, CRANK_Z - Math.cos(a) * 6];
  return hull2([...circle2(px, pz, 8.5, 20), ...circle2(0, CRANK_Z, 10, 20), ...circle2(cw[0], cw[1], 17, 28, a + Math.PI / 2 + Math.PI, a + Math.PI / 2 + 2 * Math.PI)]);
}

function drawCrank(th) {
  const [px, pz] = crankPin(th);
  const web = webProfile(th);
  part("crank-back").innerHTML =
    polySolid(prismY(circle2(0, CRANK_Z, 6, 22), back(16), back(10)), P, { tone: "mid" }) +
    polySolid(prismY(web, back(10), back(4.5)), P, { tone: "mid" }) +
    polySolid(prismY(circle2(px, pz, 5, 20), back(4.5), front(4.5)), P, { tone: "mid" });
  part("crank-front").innerHTML =
    polySolid(prismY(web, front(4.5), front(10)), P, { tone: "mid" }) +
    polySolid(prismY(circle2(0, CRANK_Z, 6, 22), front(10), front(17)), P, { tone: "mid" }) +
    polySolid(prismY(circle2(0, CRANK_Z, 4, 6), front(17), front(20)), P, { tone: "mid" }) +
    dotsSvg([iso([px, front(10), pz], P)], { size: 0.5 });
}

function drawRod(th) {
  const [px, pz] = crankPin(th);
  const pin = pinZ(th);
  const profile = hull2([...circle2(px, pz, 8.5, 24), ...circle2(0, pin, 5.5, 20)]);
  part("rod").innerHTML = polySolid(prismY(profile, -3.2, 3.2), P, { tone: "mid" });
}

function drawGas(th) {
  const top = HEAD_Z;
  const bottom = crownZ(th);
  const g = part("gas");
  const s = state(th, ratio);
  g.setAttribute("data-phase", s.phase);
  if (top - bottom < 0.2) {
    g.innerHTML = "";
    return;
  }
  const ring = halfRing(circleRing(0, 0, BORE_R - 0.3, 48), null, SIDE);
  g.innerHTML = solidSvg(extrude(ring, bottom, top - bottom, P), { tone: "lo", crease: "none" });
}

function drawPiston(th) {
  // Sectioned like the block: a real piston is a crown on a hollow skirt, so the
  // cut face is a U, hatched, and the rod's small end shows inside it.
  const pin = pinZ(th);
  const base = pin + CROWN_ABOVE_PIN;
  const skirt = pin - 16;
  const crownT = 6;
  const wall = 3;
  const extra = crownExtra(ratio);
  const R = BORE_R - 0.6;
  const shell = halfRing(circleRing(0, 0, R, 40), circleRing(0, 0, R - wall, 40), SIDE);
  const disc = halfRing(circleRing(0, 0, R, 40), null, SIDE);
  let out = solidSvg(extrude(shell, skirt, base - crownT - skirt, P, { convex: false }), { tone: "hi", lit: true });
  out += solidSvg(extrude(disc, base - crownT, crownT, P), { tone: "hi", lit: true });
  if (extra > 0.05) out += solidSvg(extrude(halfRing(circleRing(0, 0, R - 5, 36), null, SIDE), base, extra, P), { tone: "hi", lit: true });
  const hatches = hatch(-R, -R + wall, skirt, base - crownT, 2.6, P) + hatch(R - wall, R, skirt, base - crownT, 2.6, P) + hatch(-R, R, base - crownT, base, 2.6, P);
  out += lineSvg(hatches, { tone: "mid" });
  // Ring grooves: three notches in each side of the crown land.
  out += lineSvg([1.6, 3.4].map((dz) => pathOf([iso([-R, 0, base - dz], P), iso([-R + 1.6, 0, base - dz], P)]) + pathOf([iso([R, 0, base - dz], P), iso([R - 1.6, 0, base - dz], P)])).join(""), { tone: "lit", free: "end" });
  part("piston").innerHTML = out;
}

function drawPin(th) {
  const pin = pinZ(th);
  // Only the stretch through the rod's eye shows; the rest is inside the piston.
  part("pin").innerHTML = polySolid(prismY(circle2(0, pin, 3, 16), back(3.6), front(3.6)), P, { tone: "mid" });
}

function drawValves(th) {
  const lift = valveLift(th);
  const valves = [
    { x: -12, l: lift.intake },
    { x: 12, l: lift.exhaust },
  ].sort((a, b) => depthOf([a.x, 0, 0], P) - depthOf([b.x, 0, 0], P));
  let out = "";
  for (const v of valves) {
    const drop = v.l * LIFT;
    const seat = HEAD_Z - drop;
    const top = COVER_Z + 13 - drop;
    const spring = helixZ(v.x, 0, 4.4, COVER_Z, top - 1.4, 5.5, P);
    out += lineSvg(spring.back, { tone: "lo" });
    out += solidSvg(cylinder(v.x, 0, 1.4, seat, top - seat, P, 14), { tone: "mid", crease: "none" });
    out += solidSvg(cylinder(v.x, 0, 7.2, seat - 1.8, 1.8, P, 40, 0.4), { tone: "mid" });
    out += lineSvg(spring.front, { tone: "mid" });
    out += solidSvg(cylinder(v.x, 0, 5.2, top - 1.4, 1.4, P, 28, 0.3), { tone: "mid" });
  }
  part("valves").innerHTML = out;
}

let plugDrawn = false;
function drawPlug(th) {
  const g = part("plug");
  if (!plugDrawn) {
    const z = COVER_Z + COVER_H;
    g.innerHTML =
      solidSvg(cylinder(0, 0, 3, HEAD_Z - 1, z - HEAD_Z + 1, P, 20), { tone: "mid", crease: "none" }) +
      solidSvg(cylinder(0, 0, 4.8, z, 4, P, 6), { tone: "mid" }) +
      solidSvg(cylinder(0, 0, 2.8, z + 4, 12, P, 24), { tone: "hi" }) +
      lineSvg([z + 7, z + 10, z + 13].map((zz) => sideArc(0, 0, 2.8, zz, P, 20)).join(""), { tone: "lo" }) +
      solidSvg(cylinder(0, 0, 1.5, z + 16, 3.5, P, 16), { tone: "mid" }) +
      `<path class="spark" d="${sparkPath()}" opacity="0"/>`;
    plugDrawn = true;
  }
  const d = ((th % 720) + 720) % 720;
  const fire = d >= 352 && d <= 400 ? Math.exp(-(((d - 362) / 10) ** 2)) : 0;
  g.querySelector(".spark").setAttribute("opacity", fire.toFixed(2));
}

function sparkPath() {
  const [cx, cy] = iso([0, 0, HEAD_Z - 2.5], P);
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const r = i % 2 ? 2.2 : 6.5;
    const a = (i * Math.PI) / 8;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pathOf(pts, true);
}

let flowDrawn = false;
function drawFlow(th) {
  const g = part("flow");
  if (!flowDrawn) {
    const zin = HEAD_Z + 10;
    const line = (pts, cls) => `<path class="flow ${cls}" d="${pathOf(pts.map((p) => iso(p, P)))}" opacity="0"/>`;
    g.innerHTML =
      line([[-64, 0, zin], [-30, 0, zin], [-14, 0, HEAD_Z + 3]], "flow-in") + line([[14, 0, HEAD_Z + 3], [30, 0, zin], [44, 0, zin], [44, back(22), zin], [EXH_X, back(22), zin]], "flow-out");
    flowDrawn = true;
  }
  const lift = valveLift(th);
  const [fin, fout] = g.querySelectorAll(".flow");
  fin.setAttribute("opacity", lift.intake.toFixed(2));
  fout.setAttribute("opacity", lift.exhaust.toFixed(2));
  const off = (-(theta * 0.4) % 6).toFixed(1);
  fin.setAttribute("stroke-dashoffset", off);
  fout.setAttribute("stroke-dashoffset", off);
}

// ---- the p-V diagram ----
const PV = { x0: 44, x1: 312, y0: 12, y1: 178, vMax: 620, pMax: 110 };
const px = (v) => PV.x0 + (v / PV.vMax) * (PV.x1 - PV.x0);
const py = (p) => PV.y1 - (p / PV.pMax) * (PV.y1 - PV.y0);
const pvSvg = $("pv");

function drawPvFrame() {
  let s = "";
  for (let v = 0; v <= 600; v += 100) s += `<line class="grid" x1="${px(v)}" y1="${PV.y0}" x2="${px(v)}" y2="${PV.y1}"/><text class="tick" x="${px(v)}" y="${PV.y1 + 13}" text-anchor="middle">${v}</text>`;
  for (let p = 0; p <= 100; p += 20) s += `<line class="grid" x1="${PV.x0}" y1="${py(p)}" x2="${PV.x1}" y2="${py(p)}"/><text class="tick" x="${PV.x0 - 5}" y="${py(p) + 4}" text-anchor="end">${p}</text>`;
  s += `<path class="axis" d="M${PV.x0} ${PV.y0}V${PV.y1}H${PV.x1}"/>`;
  s += `<text class="tick" x="${PV.x1}" y="${PV.y1 + 27}" text-anchor="end">${t("axisV")}</text>`;
  s += `<text class="tick" x="${PV.x0 + 4}" y="${PV.y0 + 8}">${t("axisP")}</text>`;
  s += `<path class="loop" id="pv-loop"/><path class="trail" id="pv-trail"/><circle class="dot" id="pv-dot" r="4"/>`;
  pvSvg.innerHTML = s;
  drawLoop();
}

function drawLoop() {
  const d = loop(ratio).map(([v, p], i) => `${i ? "L" : "M"}${px(v).toFixed(1)} ${py(p).toFixed(1)}`).join("") + "Z";
  const el = $("pv-loop");
  el.setAttribute("d", d);
  el.classList.toggle("measured", measuredRatio === ratio);
}

function drawPvLive() {
  const s = state(theta, ratio);
  $("pv-dot").setAttribute("cx", px(s.v).toFixed(1));
  $("pv-dot").setAttribute("cy", py(s.p).toFixed(1));
  $("pv-trail").setAttribute("d", trail.map(([v, p], i) => `${i ? "L" : "M"}${px(v).toFixed(1)} ${py(p).toFixed(1)}`).join(""));
}

// ---- readouts ----
function drawReadouts() {
  const s = state(theta, ratio);
  const strokeName = t("stroke_" + strokeOf(theta));
  $("r-stroke").textContent = strokeName;
  $("r-p").textContent = num(s.p, 1) + " bar";
  $("r-v").textContent = num(s.v, 0) + " cm³";
  $("r-t").textContent = num(s.t, 0) + " K";
  $("corner-readout").textContent = strokeName + " · " + Math.round(((theta % 720) + 720) % 720) + "°";
}

function drawRecords() {
  const body = $("record-body");
  body.innerHTML = records.length
    ? records.map((x) => `<tr><td>${num(x.r, 1)}</td><td>${num(x.q, 0)}</td><td>${num(x.w, 0)}</td></tr>`).join("")
    : `<tr class="empty"><td colspan="3">${t("empty")}</td></tr>`;
}

function drawButtons() {
  $("btn-run").textContent = running && measureFrom === null ? t("pause") : t("start");
  $("btn-run").disabled = measureFrom !== null;
  $("btn-step").disabled = measureFrom !== null;
  $("btn-measure").textContent = measureFrom === null ? t("measure") : t("measuring");
  $("btn-measure").disabled = measureFrom !== null;
  $("ratio").disabled = measureFrom !== null;
  $("ratio-out").textContent = "r = " + num(ratio, 1);
}

function draw() {
  drawCrank(theta);
  drawRod(theta);
  drawGas(theta);
  drawPiston(theta);
  drawPin(theta);
  drawValves(theta);
  drawPlug(theta);
  drawFlow(theta);
  drawPvLive();
  drawReadouts();
}

// ---- motion ----
let frame = 0;
let last = 0;
let reducedAcc = 0;
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  let step = SPEED * dt * (stepTarget !== null ? 2 : 1);
  if (still.matches) {
    // Reduced motion: no smooth animation — the crank jumps 45° twice a second.
    reducedAcc += dt;
    step = reducedAcc >= 0.5 ? 45 : 0;
    if (step) reducedAcc = 0;
  }
  if (stepTarget !== null) step = Math.min(step, stepTarget - theta);
  if (step > 0) {
    theta += step;
    const s = state(theta, ratio);
    trail.push([s.v, s.p]);
    if (trail.length > 400) trail.shift();
  }
  if (stepTarget !== null && theta >= stepTarget - 1e-6) {
    theta = stepTarget;
    stepTarget = null;
    running = false;
  }
  if (measureFrom !== null && theta - measureFrom >= 720) finishMeasurement();
  draw();
  drawButtons();
  frame = running || stepTarget !== null ? requestAnimationFrame(tick) : 0;
  if (!frame) last = 0;
}
function go() {
  if (!frame) frame = requestAnimationFrame(tick);
}

// ---- actions ----
function flushPendingChanges(triggeredBy) {
  const changed = Object.keys(pending);
  if (!changed.length) return;
  emit("state-change", { changed, state: simState(), triggeredBy });
  changed.forEach((key) => delete pending[key]);
}

function finishMeasurement() {
  const c = cycle(ratio);
  const rec = { r: ratio, q: Math.round(c.qIn), w: Math.round(c.work) };
  records = [rec, ...records.filter((x) => x.r !== ratio)].slice(0, 8);
  measureFrom = null;
  measuredRatio = ratio;
  running = false;
  drawLoop();
  drawRecords();
  emit("reading", {
    state: simState(),
    label: fill(t("labelReading"), { r: num(rec.r, 1), q: num(rec.q, 0), w: num(rec.w, 0) }),
  });
}

$("btn-run").addEventListener("click", () => {
  if (running) {
    running = false;
    drawButtons();
    emit("pause", { state: simState() });
    return;
  }
  flushPendingChanges("run");
  running = true;
  stepTarget = null;
  emit("run", { state: simState(), label: fill(t("labelRun"), { r: num(ratio, 1) }) });
  go();
});

$("btn-step").addEventListener("click", () => {
  flushPendingChanges("step");
  running = false;
  stepTarget = (Math.floor(theta / 180 + 1e-6) + 1) * 180;
  const entering = t("stroke_" + strokeOf(stepTarget + 1));
  emit("step", { state: { ...simState(), entering: strokeOf(stepTarget + 1) }, label: fill(t("labelStep"), { stroke: entering.toLowerCase(), r: num(ratio, 1) }) });
  go();
});

$("btn-measure").addEventListener("click", () => {
  flushPendingChanges("measure");
  measureFrom = theta;
  stepTarget = null;
  running = true;
  trail = [];
  drawButtons();
  go();
});

$("ratio").addEventListener("input", (e) => {
  ratio = Number(e.target.value);
  pending.compression_ratio = ratio;
  trail = [];
  drawLoop();
  draw();
  drawButtons();
});

$("btn-reset").addEventListener("click", () => {
  running = false;
  stepTarget = null;
  measureFrom = null;
  measuredRatio = null;
  theta = 20;
  trail = [];
  records = [];
  drawLoop();
  drawRecords();
  draw();
  drawButtons();
  emit("reset", { state: simState() });
});

document.querySelectorAll("[data-lang]").forEach((b) =>
  b.addEventListener("click", () => {
    lang = b.dataset.lang;
    langLockedByStudent = true;
    applyLang();
  }),
);

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t("title");
  document.querySelectorAll("[data-t]").forEach((el) => {
    el.textContent = t(el.dataset.t);
  });
  svg.setAttribute("aria-label", t("figLabel"));
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  drawPvFrame();
  drawPvLive();
  drawReadouts();
  drawRecords();
  drawButtons();
}

// ---- start ----
applyLang();
draw();
AIPLA_BRIDGE.init({ name: ARTEFACT_NAME, version: "1.0.0" });
AIPLA_BRIDGE.onChatFlush(() => flushPendingChanges("chat-submit"));
(function adoptHostLocale() {
  let tries = 0;
  const timer = setInterval(() => {
    const ctx = AIPLA_BRIDGE.hostContext();
    if (ctx && typeof ctx.locale === "string") {
      clearInterval(timer);
      const hostLang = ctx.locale.slice(0, 2).toLowerCase();
      if (!langLockedByStudent && strings[hostLang] && hostLang !== lang) {
        lang = hostLang;
        applyLang();
      }
    } else if (++tries > 40) clearInterval(timer);
  }, 50);
})();
emit("open", { state: simState() });

// ---- self-test (?test=1): the physics, checked against hand-computed values ----
if (new URLSearchParams(location.search).get("test") === "1") {
  // r = 8: Vc = 500/7 = 71.43 cm³, V1 = 571.43 cm³; ideal eta = 1 - 8^-0.4 = 0.5647,
  // and W/Q from the cycle's own corner states must equal it.
  const c = cycle(8);
  const checks = [
    Math.abs(volume(0, 8) - 71.43) < 0.01,
    Math.abs(volume(180, 8) - 571.43) < 0.01,
    Math.abs(c.work / c.qIn - 0.5647) < 5e-4,
    Math.abs(idealEfficiency(10) - 0.6019) < 5e-4,
    strokeOf(400) === "power",
    valveLift(90).intake > 0.99 && valveLift(450).exhaust === 0,
  ];
  const ok = checks.every(Boolean);
  document.title = (ok ? "TEST PASS" : "TEST FAIL") + " — " + strings.da.title;
  if (!ok) console.error("otto-engine self-test failed", checks);
}
