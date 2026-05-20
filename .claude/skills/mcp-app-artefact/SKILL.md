---
name: mcp-app-artefact
description: >
  Add a new MCP App artefact (hand-curated HTML/JS rendered as a
  sandboxed iframe in the chat workspace) to the AIPLA fork. Covers the
  static-artefact path (one shared mcp-sandbox Cloud Run service, files
  under infrastructure/mcp-sandbox/artefacts/<name>/v<version>/),
  the decision tree for "static vs. dynamic MCP server", the
  ADR-013 security gates (CSP, sandbox flags, 200 KB size limit,
  library-bypass review), and the frontend wiring (NEXT_PUBLIC_MCP_SANDBOX_URL,
  MCPAppToolCallRouter, workspace surface mount). Use when the user
  says "add a new MCP app", "new artefact", "build a sim", "deploy
  a sandbox iframe", "embed an interactive visualization", or
  references Boldkast / mcp-sandbox / mcp-ext-apps-map. Do NOT use
  for the agent-skills authoring workflow (that's the inherited
  template's skill creator) or for dynamic-MCP-server scaffolding
  (a separate v1 skill).
license: Apache-2.0
metadata:
  author: AIPLA fork
  version: "0.1.0"
  added: "2026-05-21"
---

# MCP App Artefact — Hand-Curated Static Sim Path

> See also: [`agent-protocols/SKILL.md`](../agent-protocols/SKILL.md) for
> the underlying MCP / MCP Apps / A2UI spec disambiguation; this skill
> is the **how to ship one** companion.

## Decision tree — static artefact vs dynamic MCP server

**Static artefact** (this skill covers this path):
- The artefact is HTML + inline JS + inline CSS.
- All logic runs client-side in the iframe.
- No server-side computation, no per-user state, no tool-calls.
- Examples (current/planned): Boldkast projectile sim, future curated
  physics sims, parameter-driven dashboards initialized via query
  params or `postMessage`.
- Lives at `infrastructure/mcp-sandbox/artefacts/<name>/v<version>/index.html`.
- Deployed by the existing `aipla-mcp-sandbox-deploy` Cloud Build trigger.

**Dynamic MCP server** (NOT this skill — defer to a separate skill):
- The artefact needs server-side computation (e.g. lookup tables, RAG,
  external API calls, per-user state).
- Exposes MCP tools that return `ui://` resources.
- Examples: `mcp-ext-apps-map` (live external tool), future
  `mcp-aipla-grading` (server-side answer verification without
  exposing the answer to the agent).
- Lives in its own `infrastructure/mcp-<name>/` directory with its own
  Cloud Run service.
- AIPLA doesn't have one yet; the pattern lives in the inherited template
  at `infrastructure/mcp-ext-apps-map/`.

**Rule of thumb:** if you can ship it as a single committed HTML file
under 200 KB, use the static artefact path. Reach for a dynamic MCP
server only when you actually need a server.

## ADR-013 security gates (NEVER skip)

Every static artefact MUST pass these checks at commit time:

1. **Size ≤ 200 KB** (HTML + inline scripts + inline CSS combined).
   `wc -c infrastructure/mcp-sandbox/artefacts/<name>/v<version>/index.html` — gate.
2. **No external resource fetches.** Grep the file: no `<script src="http`,
   no `<link href="http`, no `<img src="http`, no `fetch(`, no `XMLHttpRequest`,
   no `WebSocket`, no `eval(`. The host iframe's CSP blocks these anyway,
   but defence-in-depth is cheaper to add than to debug.
3. **No `<iframe>` nesting.** This artefact is *already* in a sandboxed
   iframe; nesting another one inside is a CSP / sandbox-flag headache
   no one needs.
4. **Pedagogical guardrail (AIPLA-specific):** if the artefact relates
   to a problem-set, answers that would defeat the "no full solution"
   skill prompt MUST be redacted by default. Boldkast's pattern is the
   reference — per-marker "Vis" toggles that fire a postMessage so the
   host can log toggle events.
5. **AR (or domain expert) sign-off** before merge for any pedagogically
   loaded artefact. Capture as a PR comment.

## Steps to add a new artefact

Worked example below targets a hypothetical `wave-superposition` sim;
substitute your artefact name.

### 1. Scaffold the dir

```bash
mkdir -p infrastructure/mcp-sandbox/artefacts/wave-superposition/v1
```

Versioned dir (`v1`, `v2`, …) so future revisions land alongside, not
in place — the host frontend pins to a version-specific URL.

### 2. Write the artefact

Single file at
`infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html`.
Structure follows the Boldkast model:

```html
<!doctype html>
<meta charset="utf-8">
<title>Wave superposition — interaktiv visualisering</title>
<style>/* inline CSS, ~5 KB */</style>
<body>
  <header><h1>Title</h1><p>Givet: …</p></header>
  <main>
    <canvas id="viz"></canvas>
    <aside class="controls">
      <label>Param <input type="range" …></label>
      <button id="play">▶ Afspil</button>
    </aside>
    <aside class="markers">
      <p>Result: <span class="value">—</span> <button data-marker="x">Vis</button></p>
    </aside>
  </main>
  <script>/* inline JS, ~30 KB; uses requestAnimationFrame; emits postMessage on user events */</script>
</body>
```

Telemetry events to emit via `parent.postMessage({type, marker, ...}, '*')`:
- `<artefact>.open` — fired once on load (gives the host an "iframe ready" signal).
- `<artefact>.play` — user clicked play / interacted.
- `<artefact>.show_value` with `marker: <id>` — user clicked the per-marker reveal.

The host (frontend) routes these into OTel via the existing
`MCPAppToolCallRouter` → `/api/proxy/api/sessions/{id}/iframe-context`
pipeline. Cloud Trace then shows them per-session.

### 3. Run the local size + safety check

```bash
wc -c infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html
# must be ≤ 200000

grep -E 'src="http|href="http|fetch\(|XMLHttpRequest|WebSocket|eval\(' \
  infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html
# must be empty
```

### 4. Local smoke

```bash
# Backend + frontend already running via scripts/dev-local.sh.
# Open the file directly to iterate:
open infrastructure/mcp-sandbox/artefacts/wave-superposition/v1/index.html
```

For full iframe-in-host smoke, start the sandbox alongside (port 3457
by default — see scripts/dev.sh) and point a frontend test page at it.

### 5. Wire into the frontend (if it's a new mount, not a Boldkast revision)

If the artefact is a new top-level capability (not just a v2 of an
existing one), wire a launcher button in
`frontend/src/components/workspace/` or the relevant chat surface.
Boldkast's pattern:

```tsx
const url = `${process.env.NEXT_PUBLIC_MCP_SANDBOX_URL}/artefacts/wave-superposition/v1/index.html`;
// ... button onClick opens this URL in a sandboxed iframe in the workspace
```

`NEXT_PUBLIC_MCP_SANDBOX_URL` is set at build time in
`cloudbuild.yaml` (`--build-arg`) and reads from `frontend/.env.local`
for LOCAL_MODE.

### 6. Commit + push

The Cloud Build trigger `aipla-mcp-sandbox-deploy` only fires when
files inside `infrastructure/mcp-sandbox/**` change, so the artefact
addition triggers a sandbox redeploy. The frontend is unaffected
unless step 5 also changed frontend files (in which case the root
trigger `aipla-dev-deploy` fires that too).

```bash
git add infrastructure/mcp-sandbox/artefacts/wave-superposition/
git commit -m "feat(artefact): wave-superposition v1 sim"
git push
```

Watch the build:
```bash
gcloud builds list --project=aipla-dev-2026 --region=europe-north1 \
  --filter='trigger_id:7bcc7e59-923e-4684-b9af-6c0f3103deac' --limit=3
```

### 7. Verify deployed

```bash
SANDBOX_URL=$(gcloud run services describe aipla-v01-sandbox \
  --project=aipla-dev-2026 --region=europe-north1 \
  --format='value(status.url)')
curl -s -o /dev/null -w '%{http_code}\n' \
  "$SANDBOX_URL/artefacts/wave-superposition/v1/index.html"
# expect 200
```

## Why a separate Cloud Run service (and not a sidecar)

ADR-013 mandates the iframe live on a **different origin** from the
host frontend. Sidecars share the ingress origin — so they'd defeat
the security model. The `aipla-v01-sandbox` service exists *because*
it's a separate origin. Don't try to fold it back into
`aipla-v01-frontend` to save a Cloud Run service; the dollars saved
are a rounding error and the security model is load-bearing.

Each new artefact, however, **does not** need its own Cloud Run
service — they all live as static files under
`/artefacts/<name>/v<version>/` on the single shared sandbox. Spinning
up a new Cloud Run per artefact is overkill.

## Operational notes

- **Cloud Run service name:** `aipla-v01-sandbox` (dev). test/prod will
  use the same name in their respective projects.
- **Cloud Build trigger:** `aipla-mcp-sandbox-deploy`. Fires on push to
  `dev` AND change inside `infrastructure/mcp-sandbox/**`.
- **Image registry path:** `europe-north1-docker.pkg.dev/aipla-dev-2026/cphu/aipla-v01-sandbox:dev`.
- **Logs:** `gs://aipla-dev-2026-aipla-v01-logs` (shared with the frontend build).
- **Frontend integration env var:** `NEXT_PUBLIC_MCP_SANDBOX_URL` — set in
  `frontend/.env.local` for LOCAL_MODE; threaded through the Dockerfile
  build-arg via `cloudbuild.yaml`'s `--build-arg NEXT_PUBLIC_MCP_SANDBOX_URL=${_MCP_SANDBOX_URL}`.

## See also

- [`agent-protocols/SKILL.md`](../agent-protocols/SKILL.md) — protocol-level
  reference: A2UI vs MCP App vs AG-UI disambiguation, the MCP Apps SEP-1865
  spec, sandbox iframe contract details.
- [`docs/design/aipla/v0.1.0-jutland/boldkast-mcp-app.md`](../../../docs/design/aipla/v0.1.0-jutland/boldkast-mcp-app.md) —
  worked example: the first AIPLA artefact (in progress).
- [`scripts/bootstrap-aipla-dev.NOTES.md`](../../../scripts/bootstrap-aipla-dev.NOTES.md) —
  Decisions 9 + 10 (deploy + artefact pattern), Terraform recipe trail.
- ADR-013 in the scoping site (`~/Documents/clients/cph-uni/architecture.qmd`)
  — artefact safety + library-bypass path.
