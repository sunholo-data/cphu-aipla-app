// Aitana MCP App sandbox proxy server.
//
// Serves sandbox.html + sandbox.js on a different origin than the Aitana
// host (frontend), per MCP Apps spec — allow-same-origin on the inner
// iframe is only safe when the sandbox is on its own origin.
//
// Local dev: SANDBOX_PORT defaults to 3457 (next to frontend's 3456).
// Cloud Run: gets a unique *.run.app URL distinct from the frontend's.
//
// CSP is set via HTTP headers built from the ?csp=<json> query param so
// that the served HTML can't tamper with its own CSP (which it could via
// meta tags). Domain entries are sanitized to reject anything that could
// break out of a directive.
//
// Adapted from `modelcontextprotocol/ext-apps/examples/basic-host/serve.ts`
// (commit 0008d3b7, ext-apps 1.7.1). Differences from the reference:
// - Host server (port 8080) removed — Aitana's Next.js frontend IS the host
// - SANDBOX_PORT defaults to 3457 (matches scripts/dev.sh orchestration)
// - Allowed-host-origins regex is injected into sandbox.html at request
//   time via window.__AITANA_SANDBOX_CONFIG__ so the regex isn't baked
//   into the bundle
// - Logging prefix changed from [Sandbox] to [aitana-sandbox]

import cors from "cors";
import express from "express";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Inlined from @modelcontextprotocol/ext-apps spec.types — keeps the
// service free of any runtime dep on the SDK (only the type surface used).
interface McpUiResourceCsp {
  resourceDomains?: string[];
  connectDomains?: string[];
  frameDomains?: string[];
  baseUriDomains?: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cloud Run convention: respect PORT env var (set by the runtime to 8080).
// Fall back to SANDBOX_PORT for the local dev workflow (scripts/dev.sh
// orchestrates frontend:3456, backend:1956, sandbox:3457). Final fallback
// to 3457 keeps the local default behaviour unchanged.
const SANDBOX_PORT = parseInt(
  process.env.PORT || process.env.SANDBOX_PORT || "3457",
  10,
);
const PUBLIC_DIR = join(__dirname, "public");

// Comma-separated list of host origins allowed to embed this sandbox.
// Default targets local dev. Set to e.g. "https://aitana-v6-frontend-dev-xxx.run.app"
// in deployed envs.
const ALLOWED_HOST_ORIGINS_RAW = process.env.ALLOWED_HOST_ORIGINS ?? "http://localhost:3456";
const ALLOWED_HOST_ORIGINS = ALLOWED_HOST_ORIGINS_RAW
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Build a regex string suitable for the `RegExp(...)` ctor in sandbox.ts.
// Each origin becomes an exact match anchored at start, with optional path/port.
function buildAllowedReferrerPattern(origins: string[]): string {
  if (origins.length === 0) {
    throw new Error("ALLOWED_HOST_ORIGINS must contain at least one origin");
  }
  const escaped = origins.map((o) => o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `^(${escaped.join("|")})(:|/|$)`;
}

const ALLOWED_REFERRER_PATTERN = buildAllowedReferrerPattern(ALLOWED_HOST_ORIGINS);

// Pre-read sandbox.html so we can inject the runtime config script.
const SANDBOX_HTML_RAW = readFileSync(join(PUBLIC_DIR, "sandbox.html"), "utf8");
const SANDBOX_HTML = SANDBOX_HTML_RAW.replace(
  '<script type="module" src="/sandbox.js"></script>',
  `<script>window.__AITANA_SANDBOX_CONFIG__ = ${JSON.stringify({
    allowedReferrerPattern: ALLOWED_REFERRER_PATTERN,
  })};</script>\n    <script type="module" src="/sandbox.js"></script>`,
);

// Validate CSP domain entries to prevent injection attacks.
// Rejects entries containing characters that could:
// - `;` or newlines: break out to new CSP directive
// - quotes: inject CSP keywords like 'unsafe-eval'
// - space: inject multiple sources in one entry
export function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

export function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains =
    sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const directives = [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ];

  return directives.join("; ");
}

// Shared sim libraries (vendor.json). Each file is read ONCE at startup from a
// pinned npm dependency and served only if its bytes match the manifest's
// sha384 — the same digest the artefact must carry as its SRI `integrity`, so
// the browser re-checks what this server already checked. Nothing else under
// node_modules is reachable: the route looks names up in this map, it never
// joins a request path onto the filesystem.
interface VendorFile {
  body: Buffer;
  sha384: string;
}

export interface VendorTable {
  files: Map<string, VendorFile>; // key: "<lib>/<version>/<file>"
  errors: string[];
}

export function loadVendorTable(baseDir: string = __dirname): VendorTable {
  const files = new Map<string, VendorFile>();
  const errors: string[] = [];
  let manifest: { libraries?: Record<string, { version: string; files: Record<string, { from: string; sha384: string }> }> };
  try {
    manifest = JSON.parse(readFileSync(join(baseDir, "vendor.json"), "utf8"));
  } catch (e) {
    return { files, errors: [`vendor.json unreadable: ${(e as Error).message}`] };
  }
  for (const [lib, entry] of Object.entries(manifest.libraries ?? {})) {
    for (const [name, spec] of Object.entries(entry.files)) {
      const key = `${lib}/${entry.version}/${name}`;
      try {
        const body = readFileSync(join(baseDir, spec.from));
        const actual = createHash("sha384").update(body).digest("base64");
        if (actual !== spec.sha384) {
          errors.push(`${key}: sha384 mismatch (manifest ${spec.sha384}, file ${actual}) — not served`);
          continue;
        }
        files.set(key, { body, sha384: spec.sha384 });
      } catch (e) {
        errors.push(`${key}: ${(e as Error).message} — not served`);
      }
    }
  }
  return { files, errors };
}

export function createSandboxApp(): express.Express {
  const app = express();
  app.use(cors());

  const vendor = loadVendorTable();
  for (const err of vendor.errors) console.error(`[aitana-sandbox] vendor: ${err}`);

  // Serve sandbox.html (with injected runtime config) at / and /sandbox.html
  app.get(["/", "/sandbox.html"], (req, res) => {
    let cspConfig: McpUiResourceCsp | undefined;
    if (typeof req.query.csp === "string") {
      try {
        cspConfig = JSON.parse(req.query.csp);
      } catch (e) {
        console.warn("[aitana-sandbox] Invalid CSP query param:", e);
      }
    }
    res.setHeader("Content-Security-Policy", buildCspHeader(cspConfig));
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.type("html").send(SANDBOX_HTML);
  });

  // Serve the bundled bridge script.
  app.get("/sandbox.js", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.sendFile(join(PUBLIC_DIR, "sandbox.js"));
  });

  // Health probe for Cloud Run / smoke tests.
  app.get("/healthz", (_req, res) => {
    res.json({
      status: "ok",
      allowedHostOrigins: ALLOWED_HOST_ORIGINS,
      vendor: { served: [...vendor.files.keys()], errors: vendor.errors },
    });
  });

  // Vendored sim libraries. Versioned paths never change content, so they are
  // immutable-cached. CORS is open (app-wide cors()) because the artefact loads
  // them with crossorigin="anonymous" — required for SRI to be checked at all.
  app.get("/vendor/:lib/:version/:file", (req, res) => {
    const key = `${req.params.lib}/${req.params.version}/${req.params.file}`;
    const hit = vendor.files.get(key);
    if (!hit) {
      res.status(404).send("Unknown vendor file.");
      return;
    }
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Digest", `sha-384=${hit.sha384}`);
    res.send(hit.body);
  });

  // Static artefact subtree — hand-curated MCP App content per ADR-013's
  // library-bypass path. Each artefact lives at
  // `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/index.html`
  // and is loaded by the host frontend inside a sandboxed iframe (no
  // allow-same-origin). The iframe gets a permissive CSP set per-request
  // via the sandbox.html shell; static artefact responses here are just
  // the raw file. Cache-Control is tight (5 min) so iteration during the
  // Jutland buffer week is responsive without thrashing.
  //
  // Why express.static (not custom handlers): traversal-safe by default;
  // ETag + Last-Modified out of the box; dotfiles deny by default. The
  // `index: false` config makes browsing a directory return 404, so the
  // tree isn't accidentally listable.
  const ARTEFACTS_DIR = join(__dirname, "artefacts");
  // Strict CSP for static artefacts: scripts and styles must be inline
  // (the artefact is a single self-contained HTML file); NO external
  // fetches; NO nested iframes; NO base-uri swaps; NO form submissions.
  // ADR-013's "library-bypass" path lives here — artefacts are reviewed
  // at commit time, but defence-in-depth still requires the browser-
  // enforced CSP on top of the host's iframe sandbox="allow-scripts"
  // attribute. The host iframe attribute alone is necessary but not
  // sufficient per ADR-013.
  //
  // `script-src 'self'` admits exactly one thing beyond inline: the hash-
  // checked /vendor/* files above (this origin serves nothing else that is
  // executable). The in-app mount already runs under sandbox.html's CSP, which
  // allows 'self'; this makes a DIRECTLY opened artefact behave the same.
  const ARTEFACT_CSP = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  app.use(
    "/artefacts",
    express.static(ARTEFACTS_DIR, {
      index: false,
      dotfiles: "deny",
      maxAge: "5m",
      setHeaders: (res, _path) => {
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("Content-Security-Policy", ARTEFACT_CSP);
        // X-Frame-Options is superseded by frame-ancestors in CSP but
        // we don't set frame-ancestors above (the host iframe needs to
        // embed this — leaving frame-ancestors unset = allow all, then
        // the iframe sandbox attr on the host side is the gate).
        // Setting Referrer-Policy keeps the inner artefact from
        // leaking the host URL to anything it might somehow fetch.
        res.setHeader("Referrer-Policy", "no-referrer");
        // No content-type sniffing — the iframe shouldn't be tricked
        // into treating a malformed file as something else.
        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    }),
  );

  // Anything else 404s — this server intentionally serves a tiny surface.
  app.use((_req, res) => {
    res.status(404).send("Only sandbox.html / sandbox.js / healthz / artefacts/* / vendor/* are served.");
  });

  return app;
}

// Start the server when run directly (not when imported by tests).
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const app = createSandboxApp();
  app.listen(SANDBOX_PORT, (err?: Error) => {
    if (err) {
      console.error("[aitana-sandbox] Error starting server:", err);
      process.exit(1);
    }
    console.log(`[aitana-sandbox] Listening on http://localhost:${SANDBOX_PORT}`);
    console.log(`[aitana-sandbox] Allowed host origins: ${ALLOWED_HOST_ORIGINS.join(", ")}`);
  });
}
