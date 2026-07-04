#!/usr/bin/env node
/*
 * build-artefact-bridge.mjs — inline the canonical MCP App guest bridge into
 * every artefact index.html, or (with --check) verify none has drifted.
 *
 * The bridge is the single source of truth at
 *   infrastructure/mcp-sandbox/bridge/aipla-mcp-bridge.js
 * and is stamped into each artefact between the marker pair:
 *   <!-- @aipla-bridge:start ... -->
 *   <script> …canonical bridge… </script>
 *   <!-- @aipla-bridge:end -->
 *
 * Usage:
 *   node scripts/build-artefact-bridge.mjs           # write mode (stamp all)
 *   node scripts/build-artefact-bridge.mjs --check    # CI drift guard (exit 1)
 *
 * Dependency-free (node fs only) so it runs from Make, the CLI, and CI without
 * an npm install. See docs/design/aipla/v1.1.0-feedback/shared-mcp-app-bridge.md.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Repo root defaults to this script's parent dir; `--root <dir>` overrides it
// (used by tests to run against a fixture tree).
function resolveRoot() {
  const i = process.argv.indexOf("--root");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

const REPO_ROOT = resolveRoot();
const BRIDGE_SRC = join(REPO_ROOT, "infrastructure", "mcp-sandbox", "bridge", "aipla-mcp-bridge.js");
const ARTEFACTS_DIR = join(REPO_ROOT, "infrastructure", "mcp-sandbox", "artefacts");

const START_RE = /([ \t]*)<!--\s*@aipla-bridge:start\b[^>]*-->\n/;
const END_RE = /\n[ \t]*<!--\s*@aipla-bridge:end\s*-->/;

/** The exact block that must sit between the markers, derived from the source. */
function expectedBlock() {
  const canonical = readFileSync(BRIDGE_SRC, "utf8").replace(/\n+$/, "\n");
  return `<script>\n${canonical}</script>`;
}

/** Every artefact index.html we expect to carry the bridge (top-level v1). */
function artefactIndexFiles() {
  if (!existsSync(ARTEFACTS_DIR)) return [];
  const files = [];
  for (const name of readdirSync(ARTEFACTS_DIR)) {
    const index = join(ARTEFACTS_DIR, name, "v1", "index.html");
    if (existsSync(index)) files.push(index);
  }
  return files.sort();
}

/** Locate the marker region. Returns null if markers are absent. */
function findRegion(html) {
  const start = html.match(START_RE);
  if (!start) return null;
  const afterStart = start.index + start[0].length;
  const rest = html.slice(afterStart);
  const end = rest.match(END_RE);
  if (!end) return null;
  return {
    before: html.slice(0, afterStart),
    inner: rest.slice(0, end.index),
    after: rest.slice(end.index), // begins with "\n<indent><!-- end -->"
  };
}

function rel(p) {
  return p.slice(REPO_ROOT.length + 1);
}

function main() {
  const check = process.argv.includes("--check");
  const block = expectedBlock();
  const files = artefactIndexFiles();

  if (files.length === 0) {
    console.error("build-artefact-bridge: no artefact index.html files found.");
    process.exit(1);
  }

  const drifted = [];
  const missing = [];
  let written = 0;

  for (const file of files) {
    const html = readFileSync(file, "utf8");
    const region = findRegion(html);
    if (!region) {
      missing.push(file);
      continue;
    }
    if (region.inner === block) continue; // up to date

    if (check) {
      drifted.push(file);
    } else {
      writeFileSync(file, region.before + block + region.after, "utf8");
      written++;
      console.log(`stamped ${rel(file)}`);
    }
  }

  if (check) {
    if (missing.length || drifted.length) {
      for (const f of missing) console.error(`MISSING @aipla-bridge markers: ${rel(f)}`);
      for (const f of drifted)
        console.error(`DRIFT — inlined bridge != canonical source: ${rel(f)} (run \`make sim-build\`)`);
      console.error(
        `\nbuild-artefact-bridge --check FAILED: ${missing.length} missing, ${drifted.length} drifted.`,
      );
      process.exit(1);
    }
    console.log(`build-artefact-bridge --check OK: ${files.length} artefact(s) match the canonical bridge.`);
    return;
  }

  if (missing.length) {
    // In write mode, missing markers is a hard error (the artefact hasn't been
    // migrated to the shared bridge). Point the author at the migration.
    for (const f of missing)
      console.error(
        `MISSING @aipla-bridge markers: ${rel(f)} — add the marker pair around a <script> block, then re-run.`,
      );
    process.exit(1);
  }

  console.log(
    written === 0
      ? `build-artefact-bridge: ${files.length} artefact(s) already up to date.`
      : `build-artefact-bridge: stamped ${written} of ${files.length} artefact(s).`,
  );
}

main();
