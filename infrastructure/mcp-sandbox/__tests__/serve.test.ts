// Tests for the Aitana MCP sandbox proxy server.
// Covers the security-critical CSP builder + sanitizer + HTTP route surface.

import { describe, expect, it } from "vitest";

import { buildCspHeader, sanitizeCspDomains } from "../serve";

describe("sanitizeCspDomains", () => {
  it("returns empty for undefined", () => {
    expect(sanitizeCspDomains(undefined)).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(sanitizeCspDomains([])).toEqual([]);
  });

  it("preserves valid domains", () => {
    expect(sanitizeCspDomains(["https://api.example.com", "https://cdn.example.com"]))
      .toEqual(["https://api.example.com", "https://cdn.example.com"]);
  });

  it("rejects entries with semicolons (CSP directive breakout)", () => {
    expect(sanitizeCspDomains(["https://evil.com; script-src *"]))
      .toEqual([]);
  });

  it("rejects entries with newlines (CSP directive breakout)", () => {
    expect(sanitizeCspDomains(["https://evil.com\nscript-src *"]))
      .toEqual([]);
  });

  it("rejects entries with single quotes (CSP keyword injection)", () => {
    expect(sanitizeCspDomains(["'unsafe-eval'"]))
      .toEqual([]);
  });

  it("rejects entries with double quotes", () => {
    expect(sanitizeCspDomains(['https://evil.com" "*']))
      .toEqual([]);
  });

  it("rejects entries with spaces (multiple sources in one entry)", () => {
    expect(sanitizeCspDomains(["https://a.com https://b.com"]))
      .toEqual([]);
  });

  it("rejects non-string entries", () => {
    // @ts-expect-error — testing runtime type guard
    expect(sanitizeCspDomains([null, 42, "https://ok.com"]))
      .toEqual(["https://ok.com"]);
  });
});

describe("buildCspHeader", () => {
  it("returns a default CSP when csp is undefined", () => {
    const header = buildCspHeader(undefined);
    expect(header).toContain("default-src 'self' 'unsafe-inline'");
    expect(header).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:");
    expect(header).toContain("frame-src 'none'");
    expect(header).toContain("object-src 'none'");
    expect(header).toContain("base-uri 'none'");
  });

  it("includes resource domains in script-src and style-src", () => {
    const header = buildCspHeader({
      resourceDomains: ["https://cdn.example.com"],
    });
    expect(header).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https://cdn.example.com");
    expect(header).toContain("style-src 'self' 'unsafe-inline' blob: data: https://cdn.example.com");
    expect(header).toContain("worker-src 'self' blob: https://cdn.example.com");
  });

  it("includes connect domains in connect-src", () => {
    const header = buildCspHeader({
      connectDomains: ["https://api.example.com"],
    });
    expect(header).toContain("connect-src 'self' https://api.example.com");
  });

  it("uses frame-src 'none' when frameDomains absent", () => {
    const header = buildCspHeader({});
    expect(header).toContain("frame-src 'none'");
  });

  it("uses provided frameDomains when present", () => {
    const header = buildCspHeader({
      frameDomains: ["https://embed.example.com"],
    });
    expect(header).toContain("frame-src https://embed.example.com");
  });

  it("strips malicious resourceDomain entries silently (sanitization gate)", () => {
    const header = buildCspHeader({
      resourceDomains: ["https://ok.com", "https://evil.com; script-src *"],
    });
    expect(header).toContain("https://ok.com");
    expect(header).not.toContain("script-src *");
    expect(header).not.toContain("evil.com");
  });

  it("uses base-uri 'none' when baseUriDomains absent (defence-in-depth)", () => {
    const header = buildCspHeader({});
    expect(header).toContain("base-uri 'none'");
  });
});

describe("createSandboxApp HTTP routes", () => {
  it("serves /healthz with allowedHostOrigins (smoke target for deploy probes)", async () => {
    const { createSandboxApp } = await import("../serve");
    const app = createSandboxApp();
    const { default: request } = await import("supertest").catch(async () => {
      // supertest isn't a dep; fall back to inline express.test() via http
      throw new Error(
        "supertest not installed — skip this test or add as dev dep. " +
          "For now the smoke probe lives in scripts/smoke-deployed.sh.",
      );
    });
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok" });
    expect(Array.isArray(res.body.allowedHostOrigins)).toBe(true);
  });
});
