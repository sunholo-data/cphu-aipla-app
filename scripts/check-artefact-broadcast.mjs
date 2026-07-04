#!/usr/bin/env node
/*
 * check-artefact-broadcast.mjs — ensure every interactive MCP App artefact can
 * actually broadcast a student interaction.
 *
 * The rule (see docs/design/aipla/v1.1.0-feedback/shared-mcp-app-bridge.md):
 * an emit() that carries an `extra.label` is the DELIBERATE-COMMIT signal — it
 * renders the trust card in the AIPLA app AND fires the ChatGPT
 * sendFollowUpMessage turn so the model reacts immediately. An artefact whose
 * emit() calls NEVER carry a label can persist widget state (setWidgetState) but
 * can never proactively tell the tutor "the student just did X" in ChatGPT —
 * the LED-Planck / KineBot gap found 2026-07-04.
 *
 * This guard FAILS an artefact that has emit() call-sites but no labelled one.
 * A genuinely display-only / read-only artefact can opt out with a marker
 * comment anywhere in the file:  <!-- @aipla-no-broadcast: <reason> -->
 *
 * Usage:  node scripts/check-artefact-broadcast.mjs [--root <dir>]
 * Dependency-free (node fs only). Runs in CI (sim-bridge job) + `make sim-build-check`.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function resolveRoot() {
  const i = process.argv.indexOf("--root");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

const REPO_ROOT = resolveRoot();
const ARTEFACTS_DIR = join(REPO_ROOT, "infrastructure", "mcp-sandbox", "artefacts");

const OPT_OUT_RE = /<!--\s*@aipla-no-broadcast\b/;
// Strip the generated bridge region so its own emit()/label references don't count.
const BRIDGE_REGION_RE = /<!--\s*@aipla-bridge:start[\s\S]*?<!--\s*@aipla-bridge:end\s*-->/g;
const HAS_EMIT_RE = /\bemit\s*\(/;
// A labelled emit: `emit(` … `label` before the statement's `;` ([^;] spans newlines).
const LABELLED_EMIT_RE = /\bemit\s*\([^;]*\blabel\b/;

function artefactIndexFiles() {
  if (!existsSync(ARTEFACTS_DIR)) return [];
  const files = [];
  for (const name of readdirSync(ARTEFACTS_DIR)) {
    const index = join(ARTEFACTS_DIR, name, "v1", "index.html");
    if (existsSync(index)) files.push([name, index]);
  }
  return files.sort();
}

function main() {
  const files = artefactIndexFiles();
  if (files.length === 0) {
    console.error("check-artefact-broadcast: no artefact index.html files found.");
    process.exit(1);
  }

  const offenders = [];
  for (const [name, file] of files) {
    const html = readFileSync(file, "utf8");
    if (OPT_OUT_RE.test(html)) {
      console.log(`skip  ${name} (opted out via @aipla-no-broadcast)`);
      continue;
    }
    const app = html.replace(BRIDGE_REGION_RE, "");
    if (!HAS_EMIT_RE.test(app)) {
      console.log(`skip  ${name} (no emit() calls — nothing to broadcast)`);
      continue;
    }
    if (LABELLED_EMIT_RE.test(app)) {
      console.log(`ok    ${name} (has a labelled commit → broadcasts to ChatGPT + trust card)`);
    } else {
      offenders.push(name);
    }
  }

  if (offenders.length) {
    console.error("");
    for (const name of offenders) {
      console.error(
        `FAIL  ${name}: emit() calls but NO labelled commit — it can never broadcast a\n` +
          `      student interaction to ChatGPT (only silent setWidgetState). Add\n` +
          `      \`label: "<what the student did>"\` to the deliberate/commit emit(), or\n` +
          `      mark the artefact display-only with <!-- @aipla-no-broadcast: <reason> -->.`,
      );
    }
    console.error(`\ncheck-artefact-broadcast FAILED: ${offenders.length} artefact(s) can't broadcast interactions.`);
    process.exit(1);
  }

  console.log(`\ncheck-artefact-broadcast OK: every interactive artefact has a labelled commit.`);
}

main();
