// smoke-sim-reopen.mjs — drive a REAL Chromium as a student and check that what
// they typed into a sim survives closing and reopening it (1.1.160 M1).
//
// Called by scripts/smoke-sim-reopen.sh, which creates the activity and the join
// code and deletes the activity afterwards. Run that, not this.
//
//   node scripts/smoke-sim-reopen.mjs <baseUrl> <code> <skillId> <activityId> \
//        <displayName> <fieldSelector> <outDir>
//
// Prints one JSON line: {survived, value, expected, simLoadsDuringCloseReopen,
// canvasWidthAfterReopen}. Exit 0 = survived · 3 = text lost · 2 = could not run.
//
// Why a browser: jsdom cannot show whether an iframe is reloaded. The unit test
// (StudentWorkspace.test.tsx) proves the React tree keeps the frame; this proves
// the browser keeps its document. Before the fix it printed survived:false with
// 2 iframe loads; after, survived:true with 0.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PW = join(ROOT, "infrastructure/mcp-sandbox/node_modules/playwright/index.mjs");
if (!existsSync(PW)) {
  console.log("ERROR playwright is not installed: cd infrastructure/mcp-sandbox && npm ci && npx playwright install chromium");
  process.exit(2);
}
const { chromium } = await import(PW);
const [base, code, skillId, aid, name, field, out] = process.argv.slice(2);
const TYPED = "x^2 - 3*x";

const browser = await chromium.launch({ headless: true, args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
let frameLoads = 0;
page.on("framenavigated", (f) => {
  if (f !== page.mainFrame()) frameLoads++; // the sandbox frame and the sim inside it
});
const step = (s) => console.log("STEP", s);

// The sim's document sits in a nested sandbox frame whose URL does not name the
// sim, so find it by the field instead.
async function simFrame() {
  for (let i = 0; i < 60; i++) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      try {
        if (await f.$(field)) return f;
      } catch {
        // frame detached mid-scan; try the next
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no frame with ${field} appeared`);
}

try {
  step("join");
  await page.goto(`${base}/group`, { waitUntil: "networkidle" });
  const box = page.getByPlaceholder("bright-fox-42");
  for (let i = 0; i < 10; i++) {
    await box.fill(code);
    await page.waitForTimeout(500);
    if ((await box.inputValue()) === code) break; // hydration can reset an early fill
  }
  await page.getByRole("button", { name: "Tilslut", exact: true }).click();
  await page.waitForURL(/\/lessons/, { timeout: 30000 });

  step("open the lesson and the sim");
  await page.goto(`${base}/chat/${encodeURIComponent(skillId)}?activity_id=${encodeURIComponent(aid)}`, {
    waitUntil: "domcontentloaded",
  });
  const openBtn = page.getByRole("button", { name: `Åbn ${name}` });
  await openBtn.waitFor({ timeout: 45000 });
  await openBtn.click();
  let f = await simFrame();
  await page.waitForTimeout(1500);
  await f.fill(field, TYPED);
  await page.screenshot({ path: join(out, "1-typed.png") });
  const loadsBefore = frameLoads;

  step("close");
  await page.getByRole("button", { name: `Luk ${name}` }).click();
  await openBtn.waitFor({ timeout: 10000 });
  await page.screenshot({ path: join(out, "2-closed.png") });

  step("reopen");
  await page.waitForTimeout(2000);
  await openBtn.click();
  f = await simFrame();
  await page.waitForTimeout(1500);
  const value = await f.inputValue(field);
  const canvasWidthAfterReopen = await f.evaluate(() => {
    const c = document.querySelector("canvas");
    return c ? Math.round(c.getBoundingClientRect().width) : -1;
  });
  await page.screenshot({ path: join(out, "3-reopened.png") });
  const survived = value === TYPED;
  console.log(
    JSON.stringify({
      survived,
      value,
      expected: TYPED,
      simLoadsDuringCloseReopen: frameLoads - loadsBefore,
      canvasWidthAfterReopen,
    }),
  );
  process.exitCode = survived ? 0 : 3;
} catch (e) {
  console.log("ERROR", e.message);
  await page.screenshot({ path: join(out, "error.png") }).catch(() => {});
  process.exitCode = 2;
} finally {
  await browser.close();
}
