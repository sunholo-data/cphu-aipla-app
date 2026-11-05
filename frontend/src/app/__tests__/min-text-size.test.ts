/**
 * No text below 11px on the surfaces people read (2026-11-05).
 *
 * Ported from platform-source's UI audit (2026-11-03, step 4: "nothing below
 * 11px outside the document thumbnails"), which AIPLA had ~50 instances of.
 * Teachers' first feedback on the student workspace was that "a lot is going
 * on"; 10px hints and captions are part of that.
 *
 * Exceptions are listed by file with a reason. SVG charts are exempt because
 * their font size is in viewBox units and scales with the chart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const ROOTS = ["components", "app"];

const ALLOWED: Record<string, string> = {
  "components/shared/work/ChartSvg.tsx": "SVG axis labels: viewBox units, scaled with the chart",
  "components/doc-browser/DocListItem.tsx": "the ellipsis glyph inside a 12px thumbnail box",
  "app/dev/file-browser/page.tsx": "dev-only page, 404s in production",
};

const TINY = /\btext-\[(?:[0-9]|10)(?:\.\d+)?px\]/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("minimum text size", () => {
  it("no component or page sets text smaller than 11px", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(SRC, root))) {
        const rel = relative(SRC, file);
        if (rel in ALLOWED) continue;
        const hits = readFileSync(file, "utf8").match(TINY);
        if (hits) offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders, "use text-[11px] or text-xs (12px); see the header comment").toEqual([]);
  });

  it("every exception still exists, so the list cannot rot", () => {
    for (const rel of Object.keys(ALLOWED)) {
      expect(() => statSync(join(SRC, rel)), rel).not.toThrow();
    }
  });
});
