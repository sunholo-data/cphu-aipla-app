/**
 * 1.1.138 M0/M2 — one id per frontend build (frontend/build-id.mjs), feeding
 * Next's buildId, its deploymentId and NEXT_PUBLIC_BUILD_ID.
 */

import { describe, expect, it } from "vitest";

import { resolveBuildId } from "../../../build-id.mjs";

const at = new Date("2026-09-29T08:15:30.000Z");

describe("resolveBuildId", () => {
  it("uses AIPLA_BUILD_ID when the build passes a well-formed one", () => {
    expect(resolveBuildId({ AIPLA_BUILD_ID: "3f2a9c1" }, at)).toBe("3f2a9c1");
    expect(resolveBuildId({ AIPLA_BUILD_ID: " v0.1.66 " }, at)).toBe("v0.1.66");
  });

  it("falls back to a UTC build stamp plus a random suffix", () => {
    expect(resolveBuildId({}, at, () => 0.123456)).toMatch(/^b20260929081530-[a-z0-9]{4}$/);
  });

  it("two builds in the same second still differ", () => {
    expect(resolveBuildId({}, at, () => 0.1)).not.toBe(resolveBuildId({}, at, () => 0.2));
  });

  it("ignores a malformed override instead of shipping it into asset URLs", () => {
    expect(resolveBuildId({ AIPLA_BUILD_ID: "has space/and?query" }, at, () => 0.5)).toMatch(/^b2026/);
    expect(resolveBuildId({ AIPLA_BUILD_ID: "" }, at, () => 0.5)).toMatch(/^b2026/);
  });

  it("never produces an id the backend would drop", () => {
    // Mirrors _BUILD_ID in backend/observability/client_error.py.
    const backendShape = /^[A-Za-z0-9._-]{1,64}$/;
    for (const r of [0, 0.5, 0.999999]) {
      expect(resolveBuildId({}, at, () => r)).toMatch(backendShape);
    }
  });
});
