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

  it("/artefacts/* responses set the strict ADR-013 CSP", async () => {
    // Write a temp artefact so express.static has something to serve.
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { dirname, join: pjoin } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const ARTEFACT_DIR = pjoin(__dirname, "..", "artefacts", "__test", "v1");
    mkdirSync(ARTEFACT_DIR, { recursive: true });
    const ARTEFACT_PATH = pjoin(ARTEFACT_DIR, "index.html");
    writeFileSync(ARTEFACT_PATH, "<!doctype html><html><body>test</body></html>");

    try {
      const { createSandboxApp } = await import("../serve");
      const app = createSandboxApp();
      const { default: request } = await import("supertest");
      const res = await request(app).get("/artefacts/__test/v1/index.html");
      expect(res.status).toBe(200);
      const csp = res.headers["content-security-policy"];
      expect(csp).toBeDefined();
      // Defence-in-depth pieces of the ADR-013 contract:
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("connect-src 'none'"); // no external fetches from artefact
      expect(csp).toContain("frame-src 'none'"); // no nested iframes
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      // Safe defaults:
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      rmSync(pjoin(__dirname, "..", "artefacts", "__test"), {
        recursive: true,
        force: true,
      });
    }
  });

  // M1 of sprint MCPAPP-SPEC: the static-artefact spec path reuses the
  // existing /sandbox.html proxy (mounting it as the host's sandbox
  // iframe) and fetches artefact HTML from /artefacts/<name>/v<n>/.
  // The host (StaticArtefactFrame, landing in M2) then sends the
  // artefact HTML to the sandbox via ui/notifications/sandbox-resource-ready.
  // These two tests pin the contract that M2 will rely on.

  it("M1: /sandbox.html serves the proxy bridge with an injected runtime config (static-artefact path entry point)", async () => {
    const { createSandboxApp } = await import("../serve");
    const app = createSandboxApp();
    const { default: request } = await import("supertest");
    const res = await request(app).get("/sandbox.html");
    expect(res.status).toBe(200);
    // The bridge script is included
    expect(res.text).toContain('src="/sandbox.js"');
    // The runtime config (allowedReferrerPattern) is injected so the
    // bridge can validate parent-origin without baking the regex into
    // the bundle.
    expect(res.text).toContain("window.__AITANA_SANDBOX_CONFIG__");
    expect(res.text).toContain("allowedReferrerPattern");
    // The server-set CSP applies (overrides any meta-tag tampering).
    const csp = res.headers["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("script-src");
  });

  it("M1: /sandbox.html accepts a ?csp= query for tailoring per artefact's _meta.ui (static-artefact path)", async () => {
    const { createSandboxApp } = await import("../serve");
    const app = createSandboxApp();
    const { default: request } = await import("supertest");
    const csp = JSON.stringify({
      connectDomains: ["https://api.example.com"],
      resourceDomains: ["https://cdn.example.com"],
    });
    const res = await request(app).get(`/sandbox.html?csp=${encodeURIComponent(csp)}`);
    expect(res.status).toBe(200);
    const header = res.headers["content-security-policy"];
    expect(header).toContain("https://api.example.com"); // landed in connect-src
    expect(header).toContain("https://cdn.example.com"); // landed in script-src etc.
  });

  it("/artefacts/* refuses to serve dotfiles (.env, .gitkeep etc.)", async () => {
    // Setup: write a .gitkeep next to a real artefact dir.
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { dirname, join: pjoin } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const ARTEFACTS_BASE = pjoin(__dirname, "..", "artefacts");
    mkdirSync(ARTEFACTS_BASE, { recursive: true });
    const DOTFILE = pjoin(ARTEFACTS_BASE, ".env");
    writeFileSync(DOTFILE, "SECRET=should-not-be-served");

    try {
      const { createSandboxApp } = await import("../serve");
      const app = createSandboxApp();
      const { default: request } = await import("supertest");
      // dotfiles: "deny" should 403 these.
      const res = await request(app).get("/artefacts/.env");
      expect(res.status).not.toBe(200);
      expect(res.text).not.toContain("SECRET=should-not-be-served");
    } finally {
      rmSync(DOTFILE, { force: true });
    }
  });
});
