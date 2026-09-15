// Print each published guide page to PDF with Playwright (1.1.116).
//
// This replaces `quarto render … --to pdf`, which needed quarto + xelatex and a
// parallel .qmd source tree. The input is now the LIVE PAGE: whatever a reader
// sees at /guides/<slug> is what the PDF contains, so the two cannot disagree.
//
// Run through the wrapper, which picks the base URL and lists the slugs:
//   make guides-pdf                      # against deployed dev
//   make guides-pdf BASE_URL=http://localhost:3456
//
// Writes frontend/public/guides/<slug>.pdf — the files the /guides page links
// and `make seed-guide-corpus` ingests into the shared corpus.
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL;
if (!BASE) {
  console.error("BASE_URL is required (use: make guides-pdf).");
  process.exit(1);
}
const SLUGS = (process.env.GUIDE_SLUGS || "").split(/\s+/).filter(Boolean);
if (SLUGS.length === 0) {
  console.error("GUIDE_SLUGS is required (the wrapper derives it from content/guides/).");
  process.exit(1);
}

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "frontend", "public", "guides");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
// Light scheme explicitly: a PDF printed from a dark-mode context is unreadable
// on paper, and the print stylesheet should not have to fight the emulation.
const page = await browser.newPage({ colorScheme: "light" });

let failed = 0;
for (const slug of SLUGS) {
  const url = `${BASE}/guides/${slug}`;
  try {
    const response = await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response ? response.status() : "no response"}`);
    }
    // The screenshots are plain <img> tags; without this the PDF can be printed
    // before they decode and the guide loses its figures silently.
    await page.waitForFunction(
      () => Array.from(document.images).every((img) => img.complete),
      null,
      { timeout: 30_000 },
    );
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: resolve(OUT, `${slug}.pdf`),
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#666;padding:0 16mm;display:flex;justify-content:space-between;">'
        + `<span>aipla.ku.dk/guides/${slug}</span>`
        + '<span class="pageNumber"></span></div>',
    });
    console.log(`  ${slug}.pdf`);
  } catch (err) {
    failed += 1;
    console.error(`  FAILED ${slug}: ${err.message}`);
  }
}

await browser.close();
if (failed) {
  console.error(`${failed} guide(s) did not print.`);
  process.exit(1);
}
console.log(`Printed ${SLUGS.length} guide PDFs to frontend/public/guides/`);
