import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The brand colour is asserted, not eyeballed.
 *
 * KU red `hsl(358 69% 33%)` scores ~8.9:1 against white — great for a
 * white-on-red button in light mode — but only ~2.2:1 against the dark
 * background, which fails WCAG AA. That is exactly why dark mode carries a
 * lightened brand (45%). Anyone hand-tuning either value gets caught here
 * instead of shipping an unreadable button.
 */

const CSS = readFileSync(join(__dirname, "..", "globals.css"), "utf-8");

/** Read `--name: <h> <s>% <l>%;` from the :root or .dark block. */
function readHsl(scope: "root" | "dark", name: string): [number, number, number] {
  const blockStart =
    scope === "root" ? CSS.indexOf(":root {") : CSS.indexOf(".dark {");
  expect(blockStart, `no ${scope} block in globals.css`).toBeGreaterThan(-1);
  const block = CSS.slice(blockStart, CSS.indexOf("}", blockStart));

  const match = block.match(
    new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`),
  );
  expect(match, `--${name} not found (or not literal HSL) in ${scope}`).not.toBeNull();
  return [Number(match![1]), Number(match![2]), Number(match![3])];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = lN - c / 2;
  const [r, g, b] = (
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  ) as [number, number, number];
  return [r + m, g + m, b + m];
}

/** WCAG 2.1 relative luminance. */
function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("brand contrast", () => {
  it("light mode: brand-foreground on brand clears WCAG AA (4.5:1)", () => {
    const ratio = contrast(
      hslToRgb(readHsl("root", "brand")),
      hslToRgb(readHsl("root", "brand-foreground")),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("dark mode: brand-foreground on brand clears WCAG AA (4.5:1)", () => {
    const ratio = contrast(
      hslToRgb(readHsl("dark", "brand")),
      hslToRgb(readHsl("dark", "brand-foreground")),
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("dark mode lightens the brand — the light value would fail on a dark page", () => {
    const light = readHsl("root", "brand");
    const dark = readHsl("dark", "brand");
    expect(
      dark[2],
      "dark-mode --brand must be lighter than the light-mode value; " +
        "KU red at 33% scores ~2.2:1 against the dark background",
    ).toBeGreaterThan(light[2]);
  });

  it("brand stays KU red, not the inherited orange", () => {
    const [hue] = readHsl("root", "brand");
    // Orange was hue 24. Anything outside the red band means the token was
    // repointed at something that is not KU red.
    expect(hue > 340 || hue < 15).toBe(true);
  });

  it("--primary and --ring are derived from --brand, not re-hardcoded", () => {
    for (const scope of [":root {", ".dark {"]) {
      const block = CSS.slice(CSS.indexOf(scope), CSS.indexOf("}", CSS.indexOf(scope)));
      expect(block).toMatch(/--primary:\s*var\(--brand\)/);
      expect(block).toMatch(/--ring:\s*var\(--brand\)/);
    }
  });
});
