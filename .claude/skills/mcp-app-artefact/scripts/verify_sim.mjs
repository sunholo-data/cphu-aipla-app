#!/usr/bin/env node
/*
 * verify_sim.mjs — drive a sim artefact in a real browser and report what the
 * static gates cannot see.
 *
 * The other gates read the file. This one runs it, which is the difference
 * between "the HTML is well formed" and "a student can use it". It exists
 * because phase-change v1 passed every static gate while shipping with its
 * "mark point" button disabled for the entire run — the one interaction the
 * whole sim is for.
 *
 * Checks:
 *   - the ?test=1 self-test verdict, and any page/console errors
 *   - horizontal overflow at 390 / 700 / 1024 px (the workspace pane is ~700)
 *   - with --drive: a generic interaction sweep, capturing every
 *     ui/update-model-context payload the sim emits, then asserting
 *       * every kind is namespaced with the artefact id
 *       * at least one emit carries a `label` (the broadcast floor)
 *       * no payload exceeds the backend's 4096-byte cap
 *       * which kinds map to a proactive category, and which are inert
 *
 * Usage:
 *   node verify_sim.mjs <id> [--drive] [--headed] [--out <dir>]
 *   node verify_sim.mjs --path /abs/path/to/index.html [--drive]
 *
 * Exit codes: 0 all checks passed · 1 a check failed · 2 could not run.
 * A check that could not run is NEVER reported as a pass.
 */

import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../../..");

// The proactive gate's vocabulary, mirrored from
// frontend/src/lib/proactiveEventCheck.ts. Kept here so the script can say
// "this kind will never wake the tutor" without importing TypeScript.
const PROACTIVE_TOKENS = {
  sim_run: ["play", "run", "simulate", "afspil"],
  step_advance: ["step", "next", "advance", "placed", "calibrated"],
  measurement_commit: ["measure", "record", "commit", "show_value", "reading", "fit", "spectrum"],
};
// GenericArtefactFrame drops these before the tutor ever sees them.
const NOISE_SUFFIXES = [".pause", ".reset", "-error", ".sync"];
const MAX_STRUCTURED_CONTENT_BYTES = 4096; // backend/protocols/iframe_context_routes.py

function proactiveCategory(kind) {
  const suffix = String(kind).split(".").slice(-1)[0]?.toLowerCase() ?? "";
  if (!suffix) return null;
  for (const [category, keywords] of Object.entries(PROACTIVE_TOKENS)) {
    if (keywords.includes(suffix)) return category;
    const tokens = suffix.split(/[-_]/).filter(Boolean);
    if (tokens.some((t) => keywords.includes(t))) return category;
  }
  return null;
}

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const explicitPath = value("--path");
const id = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--path" &&
  argv[argv.indexOf(a) - 1] !== "--out");
const drive = flag("--drive");
const headed = flag("--headed");
// Screenshots land outside the repo by default — they are a debugging aid, not
// an artefact, and a gitignore entry is one more thing to forget.
const outDir = value("--out") ?? join(tmpdir(), "aipla-verify-sim");

if (!explicitPath && !id) {
  console.error("Usage: node verify_sim.mjs <id> [--drive] [--headed] [--out <dir>]");
  console.error("       node verify_sim.mjs --path /abs/path/to/index.html [--drive]");
  process.exit(2);
}

const artefactFile = explicitPath
  ? resolve(explicitPath)
  : join(REPO_ROOT, "infrastructure/mcp-sandbox/artefacts", id, "v1/index.html");

if (!existsSync(artefactFile)) {
  console.error(`Could not run: no artefact at ${artefactFile}`);
  if (!explicitPath) console.error(`Resolved repo root: ${REPO_ROOT}`);
  process.exit(2);
}
const artefactId = id ?? "(unknown)";

// ---------------------------------------------------------------- playwright
async function loadChromium() {
  const candidates = [
    "playwright",
    join(REPO_ROOT, "infrastructure/mcp-sandbox/node_modules/playwright/index.mjs"),
    join(REPO_ROOT, "frontend/node_modules/playwright/index.mjs"),
  ];
  for (const c of candidates) {
    try {
      const mod = await import(c);
      return mod.chromium ?? mod.default?.chromium;
    } catch { /* try the next */ }
  }
  return null;
}

/* Playwright pins a browser build number; a cache populated by a different
 * Playwright version will not match and launch() fails with "Executable doesn't
 * exist". Rather than give up, fall back to any Chrome-for-Testing in the
 * standard cache — near versions drive fine over CDP. */
function cachedChromePath() {
  const require = createRequire(import.meta.url);
  const home = process.env.HOME ?? "";
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    join(home, "Library/Caches/ms-playwright"),
    join(home, ".cache/ms-playwright"),
  ].filter(Boolean);
  const { readdirSync } = require("node:fs");
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      for (const rel of [
        "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "chrome-linux/chrome",
      ]) {
        const p = join(root, entry, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.error("Could not run: Playwright is not installed.\n");
  console.error("  npm i -D playwright && npx playwright install chromium\n");
  console.error("Nothing was verified. This is NOT a pass.");
  process.exit(2);
}

let browser;
try {
  browser = await chromium.launch({ headless: !headed });
} catch (err) {
  const exe = cachedChromePath();
  if (!exe) {
    console.error(`Could not run: ${err.message}\n`);
    console.error("  npx playwright install chromium");
    process.exit(2);
  }
  browser = await chromium.launch({ headless: !headed, executablePath: exe });
}

mkdirSync(outDir, { recursive: true });
const url = `file://${artefactFile}`;
let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const pass = (msg) => console.log(`  OK    ${msg}`);

console.log(`\nVerifying ${artefactId}\n  ${artefactFile}\n`);

// ------------------------------------------------------------- 1. self-test
{
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
  await page.goto(`${url}?test=1`);
  await page.waitForTimeout(500);
  const title = await page.title();

  if (title.startsWith("TEST PASS")) pass(`self-test: ${title}`);
  else if (title.startsWith("TEST FAIL")) fail(`self-test: ${title}`);
  else fail(`self-test did not run — title is "${title}". Implement the ?test=1 block.`);

  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  else pass("no page or console errors");
  await page.close();
}

// ------------------------------------------------------------- 2. viewports
for (const width of [390, 700, 1024]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(url);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    height: document.body.scrollHeight,
  }));
  const overflow = m.scrollW - m.clientW;
  if (overflow > 1) fail(`${width}px: overflows by ${overflow}px (content height ${m.height}px)`);
  else pass(`${width}px: fits (content height ${m.height}px)`);
  await page.screenshot({ path: join(outDir, `${artefactId}-${width}.png`), fullPage: true });
  await page.close();
}
console.log(`  ...    screenshots in ${outDir}`);

// ---------------------------------------------------------------- 3. drive
if (drive) {
  console.log("\n  Driving the sim (generic sweep)\n");
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  // The bridge posts to `parent`; at top level that is this window, so a plain
  // listener sees exactly what the host sandbox proxy would receive.
  await page.addInitScript(() => {
    window.__simEvents = [];
    window.addEventListener("message", (e) => {
      const d = e.data;
      if (d && d.jsonrpc === "2.0" && d.method === "ui/update-model-context") {
        window.__simEvents.push(d.params.structuredContent);
      }
    });
  });
  await page.goto(url);
  await page.waitForTimeout(300);

  // Nudge every range to a value that is not its default, then press every
  // enabled button in DOM order, re-checking enablement each time (buttons
  // enable each other). Language toggles are skipped: they are not the sim.
  for (const r of await page.$$('input[type="range"]')) {
    const [min, max] = await r.evaluate((el) => [Number(el.min || 0), Number(el.max || 100)]);
    await r.evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, min + (max - min) * 0.6);
  }
  // Two passes. A reset clicked early disables the very buttons a measurement
  // sim enables only after a run, so destructive controls go last — otherwise
  // the sweep reports "no measurement_commit" for a sim that has one.
  const isLang = (el) =>
    el.id === "btn-da" || el.id === "btn-en" || /dansk|english/i.test(el.textContent || "");
  const isDestructive = (el) =>
    /reset|nulstil|clear|ryd|slet/i.test(`${el.id} ${el.textContent || ""}`);

  for (const destructivePass of [false, true]) {
    // Re-query each pass: clicking can replace nodes.
    for (const b of await page.$$("button")) {
      const role = await b.evaluate((el, src) => {
        const f = new Function("el", `return (${src})(el)`);
        return { lang: f(el) };
      }, isLang.toString()).catch(() => ({ lang: false }));
      if (role.lang) continue;
      const destructive = await b
        .evaluate((el, src) => new Function("el", `return (${src})(el)`)(el), isDestructive.toString())
        .catch(() => false);
      if (destructive !== destructivePass) continue;
      if (await b.isDisabled()) continue;
      await b.click().catch(() => {});
      await page.waitForTimeout(700);
    }
  }
  await page.waitForTimeout(400);

  const events = await page.evaluate(() => window.__simEvents);
  await page.screenshot({ path: join(outDir, `${artefactId}-driven.png`), fullPage: true });
  await page.close();

  if (!events.length) {
    fail("the sim emitted nothing. Check AIPLA_BRIDGE.init() ran and emit() is wired.");
  } else {
    console.log("    kind                              proactive           label");
    console.log("    " + "-".repeat(78));
    for (const e of events) {
      const noise = NOISE_SUFFIXES.some((s) => String(e.kind).endsWith(s));
      const cat = noise ? "dropped (noise)" : (proactiveCategory(e.kind) ?? "—");
      const label = e.label ? `"${e.label}"` : "—";
      console.log(`    ${String(e.kind).padEnd(33)} ${String(cat).padEnd(19)} ${label}`);
    }
    console.log("");

    const wrong = events.filter((e) => !String(e.kind).startsWith(`${artefactId}.`));
    if (id && wrong.length) {
      fail(`kinds not namespaced with "${artefactId}.": ${[...new Set(wrong.map((e) => e.kind))].join(", ")}`);
    } else pass("every kind is namespaced with the artefact id");

    if (events.some((e) => typeof e.label === "string" && e.label.trim())) {
      pass("at least one labelled emit (trust card + proactive broadcast)");
    } else {
      fail("no labelled emit observed — no trust card can render and no proactive turn can fire.\n" +
           "        Add `label` to the deliberate commit, or mark the sim display-only\n" +
           "        with <!-- @aipla-no-broadcast: <reason> -->");
    }

    const oversize = events
      .map((e) => ({ kind: e.kind, bytes: Buffer.byteLength(JSON.stringify(e), "utf8") }))
      .filter((e) => e.bytes > MAX_STRUCTURED_CONTENT_BYTES);
    if (oversize.length) {
      fail(`payload over the ${MAX_STRUCTURED_CONTENT_BYTES}-byte cap (the backend returns 413): ` +
           oversize.map((o) => `${o.kind} = ${o.bytes}B`).join(", "));
    } else pass(`every payload within the ${MAX_STRUCTURED_CONTENT_BYTES}-byte cap`);

    if (!events.some((e) => proactiveCategory(e.kind))) {
      fail("no kind maps to a proactive category — the tutor will never react on its own.\n" +
           "        Deliberate actions want a verb like run / step / reading / measure.");
    } else pass("a deliberate action maps to a proactive category");
  }
} else {
  console.log("\n  (run with --drive to exercise the sim and inspect its events)");
}

await browser.close();

console.log(
  failures
    ? `\n${failures} check(s) failed.\n`
    : "\nAll automated checks passed.\n" +
      "Still yours to judge: is the physics right, does the Danish read well,\n" +
      "and does a student know what to do next?\n",
);
process.exit(failures ? 1 : 0);
