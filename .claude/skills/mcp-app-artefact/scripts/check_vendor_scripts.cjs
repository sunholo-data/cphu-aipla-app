#!/usr/bin/env node
// Gate 12 of audit_artefact.sh: every <script src> in an artefact is a file named in
// infrastructure/mcp-sandbox/vendor.json, by its absolute /vendor/ path, with the
// manifest's sha384 as SRI and crossorigin="anonymous". Prints one line per problem.
// Usage: node check_vendor_scripts.cjs <artefact_dir> <vendor.json>
const fs = require("fs"), path = require("path");
const [dir, manifestPath] = process.argv.slice(2);
let libs = {};
try { libs = JSON.parse(fs.readFileSync(manifestPath, "utf8")).libraries || {}; }
catch (e) { console.log(`cannot read ${manifestPath}: ${e.message}`); process.exit(0); }
const allowed = {};
for (const [lib, e] of Object.entries(libs))
  for (const [f, spec] of Object.entries(e.files)) allowed[`/vendor/${lib}/${e.version}/${f}`] = spec.sha384;
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  for (const tag of html.match(/<script\b[^>]*\bsrc\s*=[^>]*>/gi) || []) {
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
    const integrity = (tag.match(/\bintegrity\s*=\s*["']([^"']+)["']/i) || [])[1];
    const cors = /\bcrossorigin\s*=\s*["']anonymous["']/i.test(tag);
    if (!(src in allowed)) { console.log(`${file}: ${src} is not a vendored library (vendor.json)`); continue; }
    if (integrity !== `sha384-${allowed[src]}`) console.log(`${file}: ${src} integrity must be sha384-${allowed[src]}`);
    if (!cors) console.log(`${file}: ${src} needs crossorigin="anonymous" or SRI is not enforced`);
  }
}
