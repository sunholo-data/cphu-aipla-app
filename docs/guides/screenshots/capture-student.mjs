// Reproducible screenshot capture for the STUDENT guide (S1).
//
// Students are anonymous — no login. This drives the real group-code join flow
// on the deployed dev frontend with a seeded demo code, then captures the join
// page, the activity list, and the tutor + workspace. Writes ../assets/.
//
//     BASE_URL=https://…run.app GROUP=aipla-demo-1 node capture-student.mjs
//
// The tutor's chat replies need a live model; the join page, activity list, and
// workspace all render from config, so they capture regardless.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE_URL =
  process.env.BASE_URL || "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app";
const CODE = process.env.GROUP || "aipla-demo-1";
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");
const VIEWPORT = { width: 1280, height: 860 };
const HIDE_CSS = `
  [aria-label="LOCAL_MODE active"],[aria-label="Local mode banner"],
  nextjs-portal,#__next-build-watcher { display:none !important; }
`;

async function settle(page, waitText) {
  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
  if (waitText)
    await page
      .getByText(waitText, { exact: false })
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => console.log("  (warn) did not see:", waitText));
}

async function shot(page, file, el) {
  if (el) {
    const loc = page.locator(el).first();
    if (await loc.count()) {
      await loc.screenshot({ path: resolve(ASSETS, file) });
      console.log("  captured", file, "(element)");
      return;
    }
  }
  await page.screenshot({ path: resolve(ASSETS, file) });
  console.log("  captured", file);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await ctx.newPage();
let ok = 0;

try {
  // Join page + code filled (before submit).
  await page.goto(BASE_URL + "/group", { waitUntil: "networkidle" });
  await settle(page, "");
  const input = page.locator('input[placeholder="bright-fox-42"]').first();
  if (!(await input.count())) throw new Error("join form not present (auth mode?)");
  await input.fill(CODE);
  await page.waitForTimeout(200);
  await shot(page, "s1-01-join.png");
  ok++;

  // Submit → activity list.
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/lessons/, { timeout: 20000 }).catch(() => {});
  await settle(page, "");
  await shot(page, "s1-02-lessons.png");
  ok++;

  // Open an activity that HAS a workspace (the Boldkast sim) so the shot shows
  // the tutor + workspace, not a chat-only activity. Fall back to the first.
  let card = page
    .locator('a[href*="/chat/"]')
    .filter({ hasText: /Boldkast|Kastebev/i })
    .first();
  if (!(await card.count())) card = page.locator('a[href*="/chat/"]').first();
  if (await card.count()) {
    await card.click();
    await page.waitForURL(/\/chat\//, { timeout: 20000 }).catch(() => {});
    await settle(page, "");
    // Give the workspace a moment to load its config.
    await page
      .getByRole("region", { name: "Workspace" })
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => console.log("  (warn) no workspace region"));
    await page.waitForTimeout(1000);
    await shot(page, "s1-03-workspace.png");
    ok++;
  } else {
    console.log("  (warn) no activity card — skipping workspace shot (bind a code with activities)");
  }
} catch (err) {
  console.log("  (fail)", err.message.split("\n")[0]);
}

await browser.close();
console.log(`\ndone: ${ok}/3 student screenshots captured into assets/`);
