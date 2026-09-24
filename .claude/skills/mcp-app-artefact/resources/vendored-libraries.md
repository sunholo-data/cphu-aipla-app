# Vendored libraries — the one way a sim loads code it did not inline

Since 2026-09-24 (`sol-jord-maane`, three.js r128). Before that, every sim was
vanilla JS with nothing external, and that is still the default. This file is
the policy for the exception.

## The shape

```html
<script src="/vendor/three/0.128.0/three.min.js"
        integrity="sha384-CI3ELBVUz9XQO+97x6nwMDPosPR5XvsxW2ua7N1Xeygeh1IxtgqtCkGfQY9WWdHu"
        crossorigin="anonymous"></script>
```

| Layer | What it guarantees | Where |
|---|---|---|
| **Pinned npm dependency** | exact version, lockfile tarball integrity, and `npm audit` + dependabot see it like any other dep | `infrastructure/mcp-sandbox/package.json` (`"three": "0.128.0"`, no caret) |
| **Manifest** | the only files servable, each with its sha384 | `infrastructure/mcp-sandbox/vendor.json` |
| **Server** | reads each file once at startup, **refuses** any whose bytes miss the manifest hash, serves the rest immutable + nosniff + CORS-open. It is a lookup table, never a filesystem join, so nothing else in `node_modules` is reachable | `serve.ts` `/vendor/:lib/:version/:file`; `/healthz` lists served files and errors |
| **Browser (SRI)** | re-checks the same hash and refuses to execute on mismatch | the `integrity` attribute. `crossorigin="anonymous"` is what makes the browser check it at all |
| **Audit** | every `<script src>` is a manifest path with the manifest's hash and `crossorigin` | `audit_artefact.sh` gate 12 (`check_vendor_scripts.cjs`) |
| **CSP** | unchanged in substance: `'self'` only — no third-party origin is ever added | sandbox.html's CSP already allowed `'self'`; the direct-load artefact CSP gained `'self'` to match |

**Why not the CDN** (what the author shipped): a cdnjs `<script>` sends every
student's IP and a Referer to a third party on every load (the GDPR/UCPH-IT
point the author's own INTEGRATION.md raises), needs the CSP widened to an
origin we do not control, and fails when that origin is slow or blocked on a
school network. Serving from the sandbox costs one npm dependency.

**Why not inline it:** three.min.js is 590 KB, three times the 200 KB artefact
cap. Every sim would carry its own copy, and none would be audited as a dependency.

**Absolute path, always.** The artefact is `document.write`n into a frame under
`sandbox.html`, so a relative `../../vendor/…` resolves against `sandbox.html`,
not the artefact. `/vendor/…` resolves the same in both.

## Admitting a library

A library earns a place when it does something a sim cannot reasonably do in
vanilla JS **and** more than one future sim is likely to want it. three.js
qualifies (WebGL scene graph, cameras, lighting). A charting library does not:
every existing sim draws its graphs on a `<canvas>` in a few dozen lines.

1. `cd infrastructure/mcp-sandbox && npm install --save-exact <lib>@<version>`
2. Hash the file: `openssl dgst -sha384 -binary node_modules/<path> | openssl base64 -A`
3. Add it to `vendor.json` with a `why` line.
4. `npx vitest run` (the manifest test fails if any hash is wrong), then
   `aipla-security-checkup` if `npm audit` says anything.
5. Add it to the authoring prompt's HARD CONSTRAINTS so authors know it exists
   (`make sim-prompt`).

A new version goes in **beside** the old one (`/vendor/three/0.160.0/…`). A
versioned path never changes content, which is why it can be cached forever,
and a sim moves when it is re-verified, not when the library does.

## three.js specifics

- **r128 is pinned because the first sim is written against the global
  `THREE`.** `build/three.min.js` (the non-module global build) was removed in
  r160. A sim written today against a current three.js would use
  `three.module.js` and an import map. Admit that as a separate manifest entry
  when a sim needs it, rather than migrating sol-jord-maane.
- The npm file is byte-identical to cdnjs `three.js/r128/three.min.js`
  (verified 2026-09-24), so a sim tested against the CDN runs unchanged.
- WebGL in `verify_sim.mjs` runs on SwiftShader (software). It proves the
  scene initialises and renders, not that it is fast on a school Chromebook.

## Known gap: external hosts

`backend/protocols/sim_apps.py` offers catalogued sims to Claude/ChatGPT over
`/mcp`. Those hosts render the HTML on their own origin with an empty CSP, where
`/vendor/…` is a 404, so a sim that loads a vendored library is **not offered
there** (`VENDOR_MARKER`, tested in `test_mcp_server.py`). The fix, when wanted,
is to inline the manifest file into the served resource at read time. That is
safe because the hash is already checked, but it sends 590 KB per render.
