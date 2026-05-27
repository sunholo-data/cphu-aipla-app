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

## The artefact is the sim, not the whole lesson

**The most important architectural rule.** The workbench artefact is the
simulation or interactive element only. AIPLA is the platform that wraps
it — the chat tutor, the lab notebook, the lesson picker, the session
report. Do not put any of the following inside the artefact:

- Procedure instructions or step-by-step checklists → the tutor handles this
- AI hints or explanations → the tutor provides Socratically
- Data recording tables, results calculators, % error displays → lab notebook or tutor
- Built-in quizzes or MCQs → platform or tutor
- Formula reference cards → tutor provides on demand

**Reference: Boldkast.** One canvas, sliders, answer-reveal markers. That's it.

**Counter-example: LED Planck 1.C (first attempt).** The first artefact
built for LED Planck included a procedure checklist panel, a data recording
table, a Planck results calculator with % error, and a multi-step wizard.
It had everything a standalone lab needs — but a standalone lab is not what
AIPLA needs. The artefact was scrapped; the redo extracts only the circuit
builder, ammeter/voltmeter displays, I-U graph, and spectrometer.

When porting an existing tool (jitt.dk app, virtual lab), read the source,
identify the sim core, strip everything else, and build the artefact from
that core only. The rest becomes input to the tutor system prompt ("the
student will see X — ask them what it implies").

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
- **Rolling your own iframe + `window.addEventListener("message", ...)` in
  the host wrapper.** Use [`<StaticArtefactFrame>`](../../../frontend/src/components/workspace/StaticArtefactFrame.tsx)
  instead. It mounts the spec's sandbox-proxy at `/sandbox.html`, runs
  the `ui/initialize` handshake, parses JSON-RPC envelopes, and
  authenticates by origin (the proxy has a real origin per spec
  §Sandbox proxy lines 470–487). Going off-proxy means re-implementing
  the auth gate AND deviating from MCP Apps spec — both are anti-patterns.
  See "postMessage from artefact → host" below.
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

**postMessage from artefact → host — TWO paths; default to the spec-compliant one.**

### Spec-compliant path (RECOMMENDED for all new artefacts)

The MCP Apps spec defines JSON-RPC 2.0 over postMessage as the iframe ↔
host wire format, routed through a sandbox-proxy architecture (spec
lines 411–487 of the vendored snapshot at
[.claude/skills/agent-protocols/references/mcp-apps-spec-2026-01-26.md](../agent-protocols/references/mcp-apps-spec-2026-01-26.md)).

AIPLA migrated Boldkast onto this path in sprint MCPAPP-SPEC (2026-05-21).

**Host side — use `StaticArtefactFrame`**
([frontend/src/components/workspace/StaticArtefactFrame.tsx](../../../frontend/src/components/workspace/StaticArtefactFrame.tsx)):

```tsx
import { StaticArtefactFrame } from "@/components/workspace/StaticArtefactFrame";

<StaticArtefactFrame
  sandboxOrigin={SANDBOX_ORIGIN}
  artefactPath="myart/v1"   // fetched from ${SANDBOX_ORIGIN}/artefacts/myart/v1/index.html
  onUpdateModelContext={(structuredContent) => {
    // structuredContent.kind carries the artefact's event vocab
    handleEvent(structuredContent as MyArtefactPayload);
  }}
  hostContext={{ theme: "light", locale: "da-DK" }}
/>
```

`StaticArtefactFrame` handles the full spec lifecycle (sandbox-proxy
handshake, JSON-RPC envelope parsing, origin-based auth via
`e.origin === sandboxOrigin`, ui/initialize handshake, ping responder,
cleanup). The wrapper file owns only artefact-specific event routing
(snapshot accumulation, push-with-card vs silent-push, slider debounce,
Danish label functions) — mirror [BoldkastSimFrame.tsx](../../../frontend/src/components/workspace/BoldkastSimFrame.tsx)
as a template.

**Artefact side — speak JSON-RPC directly** (no SDK needed; spec line 426):

```html
<script>
  // ~30 lines of vanilla JSON-RPC helpers; see Boldkast index.html
  // for a working copy. Key functions:
  //   rpcNotify(method, params)        — fire-and-forget
  //   rpcRequest(method, params)        — Promise<result>
  //   + ping responder per spec line 508

  rpcRequest("ui/initialize", {
    protocolVersion: "2026-01-26",
    capabilities: {},
    clientInfo: { name: "myart", version: "1.0.0" },
  }).then(() => {
    rpcNotify("ui/notifications/initialized", {});
    // Now safe to emit application notifications:
    // rpcNotify("ui/update-model-context", {
    //   structuredContent: { kind: "myart.event", ...payload }
    // });
  });
</script>
```

Events emitted before init completes should queue and flush on init
success (race-safe per Boldkast's implementation).

### Path policy: one way, no fallbacks

AIPLA had a defensive fallback hook (`useSandboxedIframeMessages`)
during the migration; it was deleted on 2026-05-21 once the spec path
proved out. **There is exactly one path for iframe artefacts: go
through `StaticArtefactFrame` + the sandbox proxy at `/sandbox.html`.**

References:

- [mcp-app-iframe-spec-compliance.md](../../../docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-spec-compliance.md) — the current path
- [mcp-app-iframe-harness.md](../../../docs/design/aipla/v0.1.0-jutland/mcp-app-iframe-harness.md) — historical (superseded)

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
so failed pushes are visible instead of silent.

### Phase 2 — commit-on-submit (1.E-Ph2, 2026-05-26)

**The Phase 1 rule "debounce slider drags ~500ms and emit one card per
drag-end" is superseded.** AR's 2026-05-26 feedback after live student
testing: *"only record when the student presses Afspil."*

Pre-commit slider exploration ("what about v₀=30? what about v₀=10?")
is *thinking out loud*. It doesn't belong in the chat record or the
model context. The new rule:

**Slider changes accumulate locally inside the artefact. The host only
sees them when the student commits.** Two commit signals:

1. **Commit-class button click** (e.g. Afspil/Play, Submit, Run) — the
   student saying "yes, *this* configuration"
2. **Chat-flush notification from host** (`ui/notifications/chat-flush`
   JSON-RPC notification, no id) — the host signals before sending a
   user message so the tutor sees current state when answering

#### Wire shape

One consolidated `*.state-change` event per commit:

```json
{
  "kind": "boldkast.state-change",
  "changed": ["v0", "theta"],
  "state": { "v0": 25, "theta": 40, "g": 9.82 },
  "triggeredBy": "play"
}
```

`changed` is the set of keys the student touched since the last
commit. `state` carries the full current snapshot (cheap, even for
KineBot-sized artefacts). `triggeredBy` is `"play"` (or other
commit-class button) or `"chat-submit"`.

#### Artefact pattern

```js
// Module-scope: accumulates pre-commit changes.
const pendingChanges = {};
let v0 = 10, theta = 30, g = 9.82;

function flushPendingChanges(triggeredBy) {
  const changedKeys = Object.keys(pendingChanges);
  if (changedKeys.length === 0) return; // No-op when nothing pending.
  emit("boldkast.state-change", {
    changed: changedKeys,
    state: { v0, theta, g },
    triggeredBy,
  });
  for (const k of changedKeys) delete pendingChanges[k];
}

// Slider settle: writes locally, NO host emit.
document.getElementById("v0").addEventListener("input", (e) => {
  v0 = parseFloat(e.target.value);
  // ...recompute markers, render...
  pendingChanges.v0 = v0;
});

// Commit button: flush, then fire the commit-class event.
document.getElementById("play").addEventListener("click", () => {
  flushPendingChanges("play");          // ← first, so state precedes
  emit("boldkast.play");                //   the play event on the wire
});

// Inbound chat-flush handler — alongside the existing ping responder.
window.addEventListener("message", (e) => {
  const d = e.data;
  if (!d || d.jsonrpc !== "2.0") return;
  if (d.method === "ui/notifications/chat-flush") {
    flushPendingChanges("chat-submit");
  }
});
```

#### Host pattern (chat page side)

`BoldkastSimFrame` (and any other workbench frame) exposes a
`sendChatFlush()` method via `useImperativeHandle`. The chat page
holds a ref into the frame and calls `sendChatFlush()` at the top of
`handleSend` — fire-and-forget, no await, optional-chained so missing
frame is a no-op:

```tsx
const boldkastFrameRef = useRef<BoldkastSimFrameHandle | null>(null);
async function handleSend() {
  // ...
  boldkastFrameRef.current?.sendChatFlush();
  await sendMessage(text, { ... });
}
```

#### Acceptance gates (cribbed from workbench-state-debounce.md Phase 2)

- Drag a slider continuously, never press Play, never send chat →
  **zero** host messages from the artefact
- Drag + press Play → **exactly one** `state-change` with
  `triggeredBy: "play"` precedes the commit-class event on the wire
- Drag + type chat + Send → **exactly one** `state-change` with
  `triggeredBy: "chat-submit"` precedes the user message

**Discrete commitment events** (Pause, Reset, marker reveal) keep
firing immediately — those are already commitments. Only continuous
controls (sliders, picker dropdowns where mid-selection isn't a
commit) go through `pendingChanges`. Discrete preset clicks that
*change* a continuous param (e.g. planet → g) still write to
`pendingChanges` because the player hasn't yet pressed Play to commit
the new gravity.

See [workbench-state-debounce.md](../../../docs/design/aipla/v1.0.0-pilot/workbench-state-debounce.md) §Phase 2 for the design rationale.

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
