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

## Patterns that work / patterns that don't (from Boldkast)

What actually shipped + what we learned:

**Works:**
- Single self-contained HTML, vanilla JS, <30 KB for a sim with one
  canvas + sliders + markers + two component graphs.
- Three structural panels: trajectory canvas (main), controls (sliders +
  play/pause/reset), markers (Vis-redacted answer rows).
- **Pedagogical default trick:** sliders should NOT start pre-set to the
  problem's exact values. Neutral starting values force the student to
  read the problem, drag the sliders to match, and only then verify.
  Pre-set defaults defeat the Vis gate. Boldkast 2026-05-20 caught this
  late; the artefact now starts at v₀=10, θ=30 (problem asks 15, 40).
- Slider drag resets reveals — student must re-commit per parameter set.
- Component / position graphs that ride the main animation cursor.
  Excellent for visualising decomposition-type misconceptions.
- postMessage events `{source: name, type: name + ".event"}` with stable
  names: `open / play / pause / reset / param.change / show_value`.
  Boldkast also emits per-marker `show_value` so OTel sees which answers
  the student revealed.
- **Field-name discipline on emit():** the host validates `e.data.source
  === "<artefact-name>"` to namespace messages. So the `extra` object
  passed to `emit()` MUST NOT include a key named `source` — it'll
  override the namespace via Object.assign and the host will reject
  the message as cross-namespace. Use `triggeredBy` for "where did
  this event come from" (slider vs preset click), `marker` for which
  answer-marker, `param` for which parameter changed, etc. Reserved
  field names enforced by convention only — easy to typo, easy to
  catch in a Playwright test.
- Self-test on `?test=1` — flips `document.title` to "TEST PASS" or
  "TEST FAIL". CI can probe headlessly.
- Danish-first copy; pedagogical-warning panel ("Værdierne er skjult
  med vilje…") as a yellow strip near the markers.

**Doesn't work:**
- React / Vue / Svelte — bundle blows the 200 KB ceiling 5-10×.
- CDN imports — `default-src 'none'` CSP blocks them anyway.
- `eval()`, `new Function()`, `WebSocket`, `fetch()` to anywhere —
  same CSP gate. Network artefact = don't ship.
- Cross-origin iframes nested inside the artefact — `frame-src 'none'`.
- Showing the answer-value without an explicit toggle. Defeats the
  whole pedagogical gate.
- Defaults that match the problem's exact parameters (see above).
- **Rolling your own `window.addEventListener("message", ...)` in the
  host wrapper.** Origin-based auth doesn't work for sandboxed
  iframes (their effective origin is opaque, `e.origin === "null"`).
  Use the [`useSandboxedIframeMessages`](../../../frontend/src/hooks/useSandboxedIframeMessages.ts)
  hook — auth via `e.source` window identity, type-marker filter,
  cleanup, and dev-mode logging baked in. See "postMessage from
  artefact → host" below.
- **Pushing iframe-context to the agent without dispatching a chat
  card.** The agent gets the state but the student / dev has no
  visible signal it landed. Always pair the iframe-context POST with
  a `useHumanToolEvents.dispatch` call (silent for non-pedagogical
  events, with a Danish label for student actions).

## Recipe — how to prompt an LLM to generate a new artefact

When asking Claude (or any coding agent) to generate a new artefact,
paste the prompt below. Substitute `<<PROBLEM>>` with the actual physics
or maths problem the artefact illustrates.

```
TASK: Generate a single self-contained HTML/JS/CSS artefact for the AIPLA
educational harness. The artefact will be served from a sandboxed iframe
on a separate origin from the host, and embedded in the chat workspace.

PROBLEM:
<<PROBLEM — paste the Danish stx problem statement, including givens
and sub-parts. Note the values the problem ASKS the student to use.>>

HARD CONSTRAINTS (the harness enforces these; failures = won't deploy):
1. Single file, <= 200 KB total (HTML + inline CSS + inline JS).
2. NO external resources. No script-src http, no img-src http, no
   network fetch calls, no eval, no nested iframes. The host's CSP
   blocks all of these — it will be a black screen if you try.
3. No frameworks (React/Vue/Svelte). Vanilla JS only. requestAnimationFrame
   is fine for animation. <canvas> for any visualisation.
4. Sandboxed iframe with `sandbox="allow-scripts"` only — NO
   allow-same-origin, NO popups, NO top-nav. Plan accordingly.

PEDAGOGICAL CONSTRAINTS:
5. The student must NOT be able to read the answer just by opening the
   artefact. Hide the answer-values (e.g. y_max, range) behind per-marker
   "Vis" toggle buttons. Render as "—" until clicked.
6. Slider defaults must NOT match the problem's exact parameter values.
   Start with NEUTRAL values (e.g. 60-70% of the problem's value) so
   the student has to read the problem and drag the sliders to match
   before the artefact is meaningfully calibrated.
7. When the student drags a slider, reset all revealed markers to "—"
   so they must re-commit to a calculation per parameter set.
8. If the artefact illustrates a documented misconception (e.g. for
   projectile motion: independence of horizontal/vertical axes), include
   secondary visualisations that make that misconception concretely
   visible (e.g. v_x(t) and v_y(t) graphs side-by-side with the
   trajectory canvas).
9. Danish-first UI copy with English-as-secondary in comments only.
   Decimal separator: comma (e.g. "4,74 m" not "4.74 m").

TELEMETRY / AGENT-OBSERVABILITY:
10. Emit postMessage events on every pedagogically meaningful user
    action so the host (and the agent through it) can observe what
    the student is doing inside the iframe. Pattern:
        parent.postMessage(
          { source: "<artefact-name>", type: "<artefact-name>.<verb>",
            ...payload }, "*");
    Mandatory event verbs (use these literal strings — the host has
    handlers keyed on them):
      - "open"          — fired once on artefact load.
      - "show_value"    — fired on per-marker reveal. Payload:
                          {marker: "<id>", revealed: true|false}.
      - "param.change"  — fired on every parameter change. Payload:
                          {param: "<id>", value: <number>,
                           triggeredBy?: "slider" | "preset:<name>"}.
                          The host debounces slider-drag pushes 500ms
                          so the agent sees the final value without
                          flooding (per the trust-the-context UX);
                          preset clicks push + card immediately.
      - "play" / "pause" / "reset" — control state. Host logs locally
                          but does NOT push to the agent (not
                          pedagogically interesting).
    Field-name discipline: never include a top-level `source` key
    in the payload — it collides with the namespace `source: "<artefact>"`
    that the host filters on. Use `triggeredBy:` for context-of-event.
11. Pedagogical-state snapshot: each `show_value` and preset-click
    event should leave the artefact in a deterministic state that the
    host can render as "what the student has interacted with so far".
    The host accumulates: which markers are revealed, current
    parameter values, last-clicked preset. Don't break invariants
    (e.g. don't auto-reveal a marker on init — student must click).

STRUCTURAL TEMPLATE:
Start from `infrastructure/mcp-sandbox/artefacts/_template/v1/index.html`.
Replace the TODO blocks. Keep the `emit()` helper, the slider event
handlers' reveal-reset behaviour, and the `?test=1` self-test stub.

OUTPUT:
Write the file at `infrastructure/mcp-sandbox/artefacts/<NAME>/v1/index.html`.
Where <NAME> is a kebab-case identifier (e.g. `wave-superposition`).
After writing, verify:
  - `wc -c <path>` shows under 200000.
  - `grep -E 'src="http|fetch\(|XMLHttpRequest|WebSocket|eval\('` matches nothing.
  - Open `<path>?test=1` and check the tab title says "TEST PASS — ...".
```

The `_template/v1/index.html` ships all the structural patterns —
slider state, animation loop, marker rendering, telemetry, self-test.
You can run the scaffold script and edit, or paste the prompt above
into a Claude session.

## Steps to add a new artefact (using the scaffold)

Worked example below targets a hypothetical `wave-superposition` sim;
substitute your artefact name.

### 1. Scaffold the dir

```bash
./scripts/new-artefact.sh wave-superposition "Bølge-superposition"
```

This:
- Clones `_template/v1/` to `artefacts/wave-superposition/v1/`
- Substitutes `{{ARTEFACT_NAME}}` and `{{ARTEFACT_TITLE}}`
- Runs the safety gates (size cap, no external fetches) and bails if
  the scaffold somehow fails them
- Prints the URLs you can use to test it

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

**Compose the URL from the sandbox origin** (drop the trailing
`/sandbox.html` from `NEXT_PUBLIC_MCP_SANDBOX_URL`, then append the
artefact path):

```tsx
// Strip the /sandbox.html suffix so we get just the sandbox origin.
const SANDBOX_ORIGIN = (process.env.NEXT_PUBLIC_MCP_SANDBOX_URL ?? "")
  .replace(/\/sandbox\.html$/, "");
const url = `${SANDBOX_ORIGIN}/artefacts/wave-superposition/v1/index.html`;
```

**Iframe attribute contract — REQUIRED, both layers needed.** Per
ADR-013, the server-side CSP (set by `serve.ts` on `/artefacts/*`)
covers script execution + external-fetch denial. The host-side
iframe `sandbox` attribute covers what the frame is allowed to do to
the host (top navigation, popups, same-origin storage). Always set
BOTH:

```tsx
<iframe
  src={url}
  // allow-scripts only — explicitly NOT allow-same-origin, NOT
  // allow-top-navigation, NOT allow-popups. With these omitted the
  // iframe runs in a unique-origin sandbox and can't reach host cookies.
  sandbox="allow-scripts"
  // Block any referrer leakage to the artefact.
  referrerPolicy="no-referrer"
  // Optional: title for screen readers.
  title="Wave superposition simulation"
  className="h-full w-full border-0"
/>
```

`NEXT_PUBLIC_MCP_SANDBOX_URL` is set at build time in
`cloudbuild.yaml` (`--build-arg`) and reads from `frontend/.env.local`
for LOCAL_MODE.

**postMessage from artefact → host — use the standard hook, not a raw listener.**

The artefact emits telemetry / events via `parent.postMessage(...)`.
The host authenticates the sender by **window identity**, not origin
(see "The origin gotcha" below for why origin doesn't work under
this sandbox profile). Use the shared
[`useSandboxedIframeMessages`](../../../frontend/src/hooks/useSandboxedIframeMessages.ts)
hook — it handles auth, type-filtering, dev-mode console logging,
and unmount cleanup:

```tsx
import {
  type SandboxedIframeMessage,
  useSandboxedIframeMessages,
} from "@/hooks/useSandboxedIframeMessages";

interface MyArtefactMessage extends SandboxedIframeMessage {
  type: string;       // e.g. "myart.event-a"
  // ...artefact-specific fields
}

const iframeRef = useRef<HTMLIFrameElement | null>(null);
useSandboxedIframeMessages<MyArtefactMessage>({
  iframeRef,
  sourceMarker: "myart",        // matches what the iframe emits as `data.source`
  onMessage: (data) => {
    // data.source === "myart" and data.type is a string — guaranteed
    // by the hook. Field-shape validation past that is up to you.
  },
});

return <iframe ref={iframeRef} sandbox="allow-scripts" src={...} />;
```

**The origin gotcha (2026-05-21 incident).** ADR-013 mandates
`sandbox="allow-scripts"` with no `allow-same-origin`. That makes the
iframe's effective origin **opaque** — every `postMessage` arrives at
the host with `e.origin === "null"`. A naive `if (e.origin !==
expectedOrigin) return;` check rejects every legitimate event
silently. The hook above uses `e.source ===
iframeRef.current.contentWindow` instead (window identity per HTML
living standard) which is the correct pattern for sandboxed iframes.
**Always use the hook**; never write a raw `window.addEventListener("message", ...)`
for MCP-App iframes. See:
[mcp-app-iframe-harness.md](../../../docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-harness.md).

**Surface activity in chat — the "trust the context" card.** Whenever
the host pushes iframe-context state to the agent (so it sees what
the student did), also dispatch a card so the *student* and the *dev*
see the same thing in the chat transcript. Mirror the pattern in
[BoldkastSimFrame.tsx](../../../frontend/src/components/workspace/BoldkastSimFrame.tsx):

```tsx
import { useHumanToolEvents } from "@/hooks/useHumanToolEvents";

const humanToolEvents = useHumanToolEvents();
// inside the onMessage handler, when a push is warranted:
const req = fetchWithAuth(`/api/proxy/api/sessions/${sid}/iframe-context`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ serverId: "myart", toolName: "state", structuredContent }),
});
const label = labelFor(data); // Danish, artefact-specific, e.g. "Justerede v₀ til 15 m/s"
if (label) humanToolEvents.dispatch({ label, push: () => req });
else void req.catch(() => {});  // silent push for non-pedagogical events
```

The card transitions pending → confirmed (POST 204) → failed (4xx/5xx),
so failed pushes are visible instead of silent. **For high-frequency
events (slider drags), debounce ~500ms and emit one card per drag-end**
— not one per pixel.

**Per-artefact label function.** Each sim has its own vocabulary. The
labels are the *only* thing each new artefact wrapper has to write
beyond the iframe markup. Keep them in the wrapper file alongside the
event-shape interface; do NOT push them into the hook (the hook stays
artefact-agnostic).

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
