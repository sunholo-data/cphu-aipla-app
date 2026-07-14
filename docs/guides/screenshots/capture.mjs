// Reproducible screenshot capture for the AIPLA teacher guides.
//
// Logs in as the test teacher on the DEPLOYED DEV frontend (where the authoring
// co-pilot and concept-map features are enabled and content is realistic) and
// writes PNGs into ../assets/, replacing the placeholder images the guides
// reference. Re-run any time the UI changes so the guides never silently rot.
//
// Run it via the wrapper, which mints the cleanup token and passes creds:
//     make guide-screens
// or directly:
//     BASE_URL=https://…run.app TEACHER_EMAIL=… TEACHER_PASSWORD=… node capture.mjs
//
// Side effects on shared dev: the "activity created" shot creates one throwaway
// activity and then soft-deletes it (needs GUIDE_TEACHER_TOKEN for cleanup).

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const BASE_URL =
  process.env.BASE_URL || "https://aipla-v01-frontend-wgwhd7mspa-lz.a.run.app";
const EMAIL = process.env.TEACHER_EMAIL || "test-teacher@example.dk";
const PASSWORD = process.env.TEACHER_PASSWORD || "aipla-demo-1";
const CLEANUP_TOKEN = process.env.GUIDE_TEACHER_TOKEN || "";
const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const VIEWPORT = { width: 1280, height: 860 };

// Dev chrome we never want in a teacher-facing guide screenshot.
const HIDE_CSS = `
  [aria-label="LOCAL_MODE active"],
  [aria-label="Local mode banner"],
  nextjs-portal,
  #__next-build-watcher { display: none !important; }
`;

async function shoot(page, file, opts = {}) {
  // Hide the floating co-pilot on non-co-pilot shots so it doesn't obscure the
  // surface being documented (T4 has its own dedicated co-pilot shots).
  if (opts.hideCopilot) {
    await page
      .addStyleTag({
        content:
          '[data-testid="copilot-panel"],[data-testid="copilot-fab"]{display:none!important}',
      })
      .catch(() => {});
    await page.waitForTimeout(150);
  }
  if (opts.element) {
    const loc = page.locator(opts.element).first();
    if (await loc.count()) {
      await loc.screenshot({ path: resolve(ASSETS, file) });
      console.log("  captured", file, "(element)");
      return;
    }
    console.log("  (warn) element not found for", file, "- full viewport");
  }
  if (opts.focus) {
    const loc = page.locator(opts.focus).first();
    if (await loc.count()) {
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
      await page.waitForTimeout(200);
    }
  } else {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  }
  await page.screenshot({ path: resolve(ASSETS, file) });
  console.log("  captured", file);
}

async function go(page, path, waitText) {
  await page.goto(BASE_URL + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.addStyleTag({ content: HIDE_CSS }).catch(() => {});
  if (waitText) {
    await page
      .getByText(waitText, { exact: false })
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => console.log("  (warn) did not see:", waitText));
  }
}

// Builder section nav (Setup / Lesson / Workspace / Materials).
async function section(page, name) {
  const btn = page.getByRole("button", { name, exact: true }).first();
  if (await btn.count()) await btn.click().catch(() => {});
  await page.waitForTimeout(250);
}

async function login(page) {
  console.log("signing in as", EMAIL, "…");
  await page.goto(BASE_URL + "/teacher/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /sign in with email/i }).first().click();
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await page
    .waitForURL(/\/teacher\/classes/, { timeout: 30000 })
    .catch(() => console.log("  (warn) sign-in did not land on /teacher/classes"));
  await page.waitForTimeout(1000);
}

const TITLE = "Guide capture — energy on a ramp (delete me)";
const GOAL =
  "Help the student reason about energy conservation on a frictionless ramp. Do not give the final answer; ask guiding questions.";

// The co-pilot converses before it proposes — it often asks a clarifying
// question first. Nudge it directively and answer follow-ups until a proposal
// card appears, then scroll the card into view within the panel.
async function copilotPropose(page) {
  const panel = page.locator('[data-testid="copilot-panel"]');
  const input = panel.getByPlaceholder(/energibevarelse for en B-klasse/).first();
  const card = page.locator('[data-testid="proposal-card"]').first();
  const prompts = [
    "Lav et konkret forslag til en lærer-prompt og en tjekliste til energibevarelse for en 2.g klasse. Kom med forslaget nu.",
    "Ja tak — kom med et konkret forslag på lærer-prompt og en tjekliste nu.",
    "Bare foreslå noget nu; jeg retter det bagefter.",
  ];
  for (const prompt of prompts) {
    await input.waitFor({ timeout: 10000 });
    await input.fill(prompt);
    await page.getByRole("button", { name: "Send" }).first().click();
    try {
      await card.waitFor({ timeout: 50000 });
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(400);
      return;
    } catch {
      /* still conversing — ask again more directively */
    }
  }
  throw new Error("co-pilot did not return a proposal card");
}

async function fillBasics(page) {
  await section(page, "Setup");
  const t = page.locator("#activity-title");
  if (await t.count()) await t.fill(TITLE);
  await section(page, "Lesson");
  const g = page.locator("#activity-goal");
  if (await g.count()) await g.fill(GOAL);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  await login(page);

  // Resolve a class id from the list for the class-detail shot.
  let classId = null;
  await go(page, "/teacher/classes", "classes");
  try {
    const href = await page
      .locator('a[href^="/teacher/classes/"]')
      .first()
      .getAttribute("href");
    classId = href?.split("/").pop() || null;
    console.log("resolved classId:", classId);
  } catch {
    console.log("  (warn) could not resolve a class id");
  }

  let createdActivityId = null;

  const shots = [
    // T1 — set up a class
    { file: "t1-02-class-list.png", run: () => go(page, "/teacher/classes", "classes") },
    {
      file: "t1-01-new-class.png",
      focus: "form[aria-label='Create class']",
      run: async () => {
        await go(page, "/teacher/classes", "classes");
        await page.getByRole("button", { name: /new class/i }).first().click();
        await page.getByLabel(/class name/i).first().waitFor({ timeout: 5000 });
      },
    },
    {
      file: "t1-03-mint-group.png",
      skip: () => !classId,
      run: () => go(page, `/teacher/classes/${classId}`, ""),
    },
    // T2 — create an activity
    { file: "t2-01-new-activity.png", run: () => go(page, "/teacher/activities/new", "New activity") },
    {
      file: "t2-03-goal.png",
      focus: "#activity-goal",
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await fillBasics(page);
      },
    },
    {
      file: "t2-04-elements.png",
      focus: "input[aria-label='Checklist step 1']",
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await fillBasics(page);
        await section(page, "Workspace");
        const add = page.getByRole("button", { name: /add step/i }).first();
        if (await add.count()) {
          await add.click();
          const step = page.getByLabel(/checklist step 1/i).first();
          if (await step.count())
            await step.fill("Identify the system and its energy at the start");
        }
        await page.waitForTimeout(300);
      },
    },
    // T3 — curriculum materials (browse the real dev corpus; no upload → no pollution)
    {
      file: "t3-01-materials.png",
      focus: "#builder-materials",
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await section(page, "Materials");
        await page.waitForTimeout(500);
      },
    },
    {
      file: "t3-02-extracted.png",
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await section(page, "Materials");
        await page.waitForTimeout(500);
        const view = page.locator('button[title="View what was extracted"]').first();
        if (!(await view.count())) throw new Error("no corpus doc to view");
        await view.click();
        await page.getByText(/what we extracted/i).first().waitFor({ timeout: 8000 });
      },
      element: '[role="dialog"]',
    },
    // T4 — authoring co-pilot (flag on in dev; needs the live model backend)
    {
      file: "t4-01-copilot-panel.png",
      element: '[data-testid="copilot-panel"]',
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await page.locator('[data-testid="copilot-panel"]').first().waitFor({ timeout: 10000 });
        await page.waitForTimeout(500);
      },
    },
    {
      file: "t4-02-proposal.png",
      element: '[data-testid="copilot-panel"]',
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await copilotPropose(page);
      },
    },
    {
      file: "t4-03-applied.png",
      element: '[data-testid="copilot-panel"]',
      run: async () => {
        // Reuse the proposal from the previous shot if still present; else re-ask.
        const card = page.locator('[data-testid="proposal-card"]').first();
        if (!(await card.count())) {
          await go(page, "/teacher/activities/new", "New activity");
          await copilotPropose(page);
        }
        const apply = page.getByRole("button", { name: "Anvend" }).first();
        await apply.scrollIntoViewIfNeeded().catch(() => {});
        await apply.click();
        await page
          .getByRole("status")
          .filter({ hasText: /Anvendt/ })
          .first()
          .waitFor({ timeout: 10000 });
        await page.waitForTimeout(400);
      },
    },
    // T2 success — LAST teacher shot; creates a throwaway activity we then delete.
    {
      file: "t2-05-success.png",
      run: async () => {
        await go(page, "/teacher/activities/new", "New activity");
        await fillBasics(page);
        await page.getByRole("button", { name: /create activity/i }).first().click();
        await page.getByText(/is live for/i).first().waitFor({ timeout: 15000 });
        const href = await page
          .locator('a:has-text("Configure activity")')
          .first()
          .getAttribute("href")
          .catch(() => null);
        createdActivityId = href?.match(/\/teacher\/activities\/([^?]+)/)?.[1] || null;
        console.log("  created throwaway activity:", createdActivityId);
      },
    },
  ];

  // Optional subset re-runs: SKIP=a,b or ONLY=a,b (comma-separated basenames).
  const SKIP = (process.env.SKIP || "").split(",").filter(Boolean);
  const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);

  let ok = 0;
  for (const s of shots) {
    const base = s.file.replace(/\.png$/, "");
    if (ONLY.length && !ONLY.includes(base)) continue;
    if (SKIP.includes(base)) {
      console.log("skip", s.file, "(SKIP)");
      continue;
    }
    if (s.skip?.()) {
      console.log("skip", s.file, "(missing prerequisite)");
      continue;
    }
    try {
      console.log("shot:", s.file);
      await s.run();
      await shoot(page, s.file, {
        focus: s.focus,
        element: s.element,
        hideCopilot: !s.file.startsWith("t4-"),
      });
      ok++;
    } catch (err) {
      console.log("  (fail)", s.file, "-", err.message.split("\n")[0]);
    }
  }

  // Clean up the throwaway activity created for the success shot.
  if (createdActivityId && CLEANUP_TOKEN) {
    try {
      const r = await fetch(
        `${BASE_URL}/api/proxy/api/activities/${encodeURIComponent(createdActivityId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${CLEANUP_TOKEN}` } },
      );
      console.log(`cleanup: deleted ${createdActivityId} → ${r.status}`);
    } catch (err) {
      console.log(`cleanup FAILED for ${createdActivityId}: ${err.message}`);
      console.log("  delete it manually (title contains 'delete me').");
    }
  } else if (createdActivityId) {
    console.log(
      `cleanup SKIPPED (no GUIDE_TEACHER_TOKEN). Manually delete activity ${createdActivityId} (title contains 'delete me').`,
    );
  }

  await browser.close();
  console.log(`\ndone: ${ok}/${shots.length} screenshots captured into assets/`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
