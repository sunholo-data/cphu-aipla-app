import { describe, expect, it } from "vitest";

import {
  MAX_EDGE,
  computeTargetSize,
  stripDataUrlPrefix,
} from "../imageResize";

describe("computeTargetSize", () => {
  it("does not upscale images already within the max edge", () => {
    expect(computeTargetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape image so the longest edge equals the max", () => {
    const out = computeTargetSize(4096, 2048, MAX_EDGE);
    expect(out.width).toBe(2048);
    expect(out.height).toBe(1024);
  });

  it("scales a portrait image by its height (longest edge)", () => {
    const out = computeTargetSize(3000, 6000, 2048);
    expect(out.height).toBe(2048);
    expect(out.width).toBe(1024);
  });

  it("preserves aspect ratio within rounding", () => {
    const out = computeTargetSize(4000, 3000, 2048);
    const ratioIn = 4000 / 3000;
    const ratioOut = out.width / out.height;
    expect(Math.abs(ratioIn - ratioOut)).toBeLessThan(0.01);
  });

  it("clamps degenerate dimensions to at least 1px", () => {
    expect(computeTargetSize(0, 0)).toEqual({ width: 1, height: 1 });
    const tiny = computeTargetSize(1, 100000, 10);
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBe(10);
  });
});

describe("stripDataUrlPrefix", () => {
  it("removes the data-URL prefix, leaving raw base64", () => {
    expect(stripDataUrlPrefix("data:image/jpeg;base64,QUJD")).toBe("QUJD");
  });

  it("returns the input unchanged when there is no prefix", () => {
    expect(stripDataUrlPrefix("QUJD")).toBe("QUJD");
  });
});
