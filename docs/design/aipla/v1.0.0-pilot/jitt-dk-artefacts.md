# jitt.dk artefact library expansion (activity 4+)

**Status**: Planned
**Priority**: P2 (v1.1 target; enables curated sim library commitment in strands.qmd)
**Estimated**: 1–2 days per artefact; 5 artefacts = 5–8 days total across v1.1
**Scope**: Artefact only (HTML + postMessage wiring). No backend or frontend changes for each app — they slot into the existing `StaticArtefactFrame` + sandbox infrastructure.
**Dependencies**: [lesson-picker.md](lesson-picker.md) shipped; [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md) and [led-planck-skill.md](led-planck-skill.md) as reference implementations (N=2 spec-compliant artefacts before expanding); ADR-013 pipeline scan tooling in place
**Pedagogical source-of-truth:** [`notes/2026-05-26-JB-feedback-jutland.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-05-26-JB-feedback-jutland.md) — JB noted "We can use them freely if we want to." Teacher at the Jutland visit confirmed these are free to use. The [`workbench-types.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-types.md) brief in the scoping site documents the per-app integration checklist and priority order.
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

## Problem Statement

AIPLA v1 commits to a "curated sim library" (strands.qmd). After Boldkast (0.2) + LED Planck (1.C) + KineBot (1.D), the library has three artefacts. jitt.dk is a free, teacher-built collection of 23 Danish physics apps — self-contained HTML artefacts spanning mechanics, waves, acoustics, optics, and measurement. If they're iframe-compatible, each can join the library in ~1 day: ADR-013 scan + postMessage wiring + tutor system prompt.

**Current state:**
- jitt.dk runs at `https://jitt.dk`. 23 apps confirmed by JB as free to use.
- None have been tested for `sandbox="allow-scripts"` iframe compatibility yet.
- No postMessage wiring exists (these were built as standalone apps, not AIPLA artefacts).
- The AIPLA artefact infrastructure (`StaticArtefactFrame`, ADR-013 scan, sandbox proxy) is now proven across two artefacts (Boldkast, LED Planck).

**Impact (if not built):**
- v1 ships a "curated library" of 3 artefacts, all pre-existing. The library never grows to the stated density.
- Jutland teacher's jitt.dk apps — which come with implicit pedagogical endorsement from a practitioner with "years of experience" — stay outside AIPLA.
- Type 3 (experiment tools) and Type 4 (video analysis) workbench types never get their first real implementation.

## Goals

**Primary goal:** Five jitt.dk apps available in the AIPLA workbench, each paired with a Socratic tutor system prompt, each passing the ADR-013 pipeline scan, each emitting spec-compliant JSON-RPC `ui/update-model-context` notifications that reach the agent's context via the existing `StaticArtefactFrame` path.

**Success metrics (per artefact):**
- Loads in `sandbox="allow-scripts"` iframe without console errors
- ADR-013 scan passes: no `fetch(`, no `XMLHttpRequest`, no external `<script src>`, artefact size < 200 KB
- `ui/initialize` handshake completes on load (visible as `StaticArtefactFrame` mounted + initialized in host)
- Core interaction events fire as `ui/update-model-context` notifications and reach `mcp_app_context.<artefact>.state`
- Tutor skill references current app state in the first response that follows a state-change event (qualitative check)
- `aiplatform artefact audit <path>` exits 0

**Non-goals:**
- Rewriting or regenerating the jitt.dk apps (they are hand-crafted by an expert practitioner — preserve every line of original functionality and add only the AIPLA wiring on top)
- Building a tool to scrape/download jitt.dk automatically (manual copy is fine for 5 apps)
- Accessibility or internationalisation (apps are Danish; v1 Danish target audience)
- GPS Fart and sensor apps in v1 (sensor permissions inside sandboxed iframes need a dedicated investigation — tracked in [expanded-workbench-types.md](expanded-workbench-types.md) as Type 3)

## Priority order

| # | App | Why first | Type | Notes |
|---|---|---|---|---|
| 1 | **Pendul** | Gravity / pendulum — planned as skill 4 in strands.qmd; no sensors; likely self-contained | App (Type 1) | First target |
| 2 | **Kredsløb** | Circuit simulator — complements LED Planck; shares audience (stx) | App (Type 1) | |
| 3 | **Videoanalyse** | Frame-by-frame motion analysis — unique capability; bridges virtual/physical; strong research value for Strand B video assessment stream | Video analysis (Type 4) | Privacy review required even for in-browser video (see [expanded-workbench-types.md](expanded-workbench-types.md)) |
| 4 | **GPS Fart** | Real GPS velocity measurement — novel workbench type; sensor experiment | Experiment tool (Type 3) | Sensor permissions investigation needed |
| 5 | **Frekvensanalysator** | Waves/sound curriculum; frequency analysis | App (Type 1) | |

Further apps (Kartoffelkanon, Centripetal, Doppler-effekt, Lydinterferens, etc.) — queue after the first 5 are validated.

## What goes in the artefact vs what AIPLA provides

AIPLA is the platform. The workbench artefact is the **simulation or interactive element only**. This distinction is the most important architectural decision in the whole migration and the most common source of failure.

**Stays in the artefact (the "sim core"):**
- The interactive simulation — drag-and-drop, sliders, canvas rendering, physical model
- Visual feedback the student gets by manipulating parameters
- Any measurement readout the student reads directly (ammeter display, spectrometer peak)

**Moves to AIPLA (do not replicate in the artefact):**
- Instructions, step-by-step procedure → the tutor chat guides the student through this
- AI-generated hints or explanations → the tutor provides these Socratically
- Quizzes, MCQs → the tutor or a platform-level quiz component handles this
- Data tables, results calculators, % error display → platform-level features or lab notebook (Type 5)
- Checklists and progress tracking → platform UI or tutor conversation
- Formula references → tutor provides on demand

**Reference: Boldkast is correct.** It has: one canvas, sliders, answer-reveal markers. It does not have a procedure panel, an AI chat panel, a quiz section, or a formula reference. That is the right scope.

**Counter-example: LED Planck 1.C is wrong.** The artefact built for 1.C included a procedure checklist panel, a measurement data table, a results calculator with % error, a spectrometer tab, and a multi-step wizard — essentially a complete standalone lab app. This is the pattern to avoid. When the original `leds_planck_virtual_lab.html` is ported correctly, the artefact should contain only: the circuit builder, the ammeter/voltmeter displays, the I-U graph canvas, and the spectrometer visualisation. The data recording, Planck calculation, error analysis, and procedure guidance are AIPLA's job.

For jitt.dk apps specifically: they are self-contained teaching tools. Each one bundles simulation + instructions + data recording. When porting to AIPLA, extract the simulation core and strip the rest. The jitt.dk teacher built these as standalone apps because they had no platform — AIPLA is the platform now.

## Integration recipe (per app)

This is the standard sequence; see the mcp-app-artefact skill for the full runbook.

### 1. Acquire source and decide what to keep

Download the standalone HTML from jitt.dk. Read it fully. Map its UI panels to the two columns above:
- Simulation elements → keep in artefact
- Instructional / analytical / AI elements → strip (AIPLA provides better versions)

Document the decision before editing. This is a judgment call that needs AR (physics) input — the physics educator knows which parts of the interaction are the simulation and which are scaffolding around it.

### 2. ADR-013 scan

```bash
aiplatform artefact audit path/to/app.html
```

Run this on the **real source file** before making any edits. Fail conditions: any `fetch(`, `XMLHttpRequest`, external `<script src>`, or file > 200 KB. If the app uses a CDN resource, self-host it by inlining (consistent with the Boldkast zero-dependency design).

### 3. Add JSON-RPC wiring

The AIPLA spec-compliant path (MCP Apps spec via `StaticArtefactFrame`) requires JSON-RPC 2.0 over postMessage — not raw `window.parent.postMessage` with a custom envelope. **Do not use `{type: 'aipla:workbench', event: '...'}` — that format is obsolete.**

Add the following block at the **top of the existing `<script>` section**, before any app code. This is a copy of the helpers from the Boldkast template (also at `infrastructure/mcp-sandbox/artefacts/_template/v1/index.html`):

```javascript
// ─── AIPLA MCP Apps wiring (add to every jitt.dk artefact) ──────────────────
let __rpcNextId = 1, __initialized = false, __pendingEmits = [], __hostContext = null;
function __post(m) { try { window.parent.postMessage(m, '*'); } catch(_) {} }
function rpcNotify(method, params) { __post({jsonrpc:'2.0', method, params: params||{}}); }
function rpcRequest(method, params) {
  return new Promise((resolve, reject) => {
    const id = __rpcNextId++;
    const listener = e => {
      const d = e.data;
      if (!d || d.id !== id) return;
      window.removeEventListener('message', listener);
      d.result !== undefined ? resolve(d.result) : reject(new Error((d.error&&d.error.message)||'rpc error'));
    };
    window.addEventListener('message', listener);
    __post({jsonrpc:'2.0', id, method, params: params||{}});
  });
}
function emit(kind, payload) {
  const msg = {jsonrpc:'2.0', method:'ui/update-model-context',
    params:{structuredContent: Object.assign({}, payload||{}, {kind: '<APP-ID>.'+kind})}};
  if (!__initialized) { __pendingEmits.push(msg); return; }
  __post(msg);
}
// ping responder + chat-flush handler (add alongside any existing message listeners)
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || d.jsonrpc !== '2.0') return;
  if (d.method === 'ping' && d.id != null) { __post({jsonrpc:'2.0', id:d.id, result:{}}); return; }
  if (d.method === 'ui/notifications/chat-flush') { flushPendingChanges('chat-submit'); }
});
// ui/initialize handshake — the artefact initiates this, StaticArtefactFrame responds
rpcRequest('ui/initialize', {protocolVersion:'2026-01-26', capabilities:{},
  clientInfo:{name:'<APP-ID>', version:'1.0.0'}})
  .then(result => {
    __hostContext = (result && result.hostContext) || null;
    rpcNotify('ui/notifications/initialized', {clientInfo:{name:'<APP-ID>', version:'1.0.0'}});
    __initialized = true;
    while (__pendingEmits.length) __post(__pendingEmits.shift());
  })
  .catch(() => { __initialized = true; __pendingEmits.length = 0; });

// commit-on-submit: accumulate continuous-control changes locally, flush on commit
const pendingChanges = {};
function flushPendingChanges(triggeredBy) {
  const keys = Object.keys(pendingChanges);
  if (!keys.length) return;
  emit('state-change', {changed: keys, state: getCurrentState(), triggeredBy});
  for (const k of keys) delete pendingChanges[k];
}
// ─────────────────────────────────────────────────────────────────────────────
```

Substitute `<APP-ID>` with the kebab-case artefact name (e.g. `pendul`, `kredsløb`).

Then hook into the app's existing interaction points to call `emit()` and update `pendingChanges`. The exact hooks depend on each app; see per-app notes below. For **continuous controls** (sliders, value inputs the student adjusts before committing), write to `pendingChanges` on change and call `flushPendingChanges('commit')` when the student confirms the value.

### 4. Tutor system prompt

The tutor replaces everything that was stripped from the original app. Write a Socratic system prompt that:
- Guides the student through the procedure that the original app's instruction panel covered — but Socratically, not as a list
- References the sim's specific UI labels and controls (so the tutor can say "look at the pendulum period readout" not "look at the result")
- Surfaces the appresent DRAs that the simulation makes visible but doesn't explain (see [dra-activity-framework.md](dra-activity-framework.md))
- Replaces any AI hint system the original app had — but without giving answers

The DRA map drives which questions the tutor asks. It must be drafted before the system prompt is finalised.

### 5. Place in artefact library

```
infrastructure/mcp-sandbox/artefacts/<app-id>/v1/index.html
```

### 6. Add to activity library

Create an entry in the backend skill template for the paired tutor skill. Wire the lesson picker to show the new activity.

### 7. Test

- Load in `StaticArtefactFrame` sandbox — no console errors
- Primary interaction event fires and reaches `mcp_app_context` within one agent turn
- Tutor references app state in next response
- All existing tests still pass (`make test-fast` + `npm run test:run`)

## Per-app event shapes (to be filled as each app is onboarded)

### Pendul (pendulum)

*Pending sandbox test. Expected hook point and emit call:*

```javascript
// Hook into whatever function the app calls when a measurement is recorded.
// Replace window.parent.postMessage(...) with emit():
emit('measurement', {
  length: metersValue,        // pendulum length in m
  period: secondsValue,       // measured period T in s
  g_computed: gValue          // derived g = 4π²L/T²
});
// For the length slider (continuous): write to pendingChanges, flush on commit button
pendingChanges.length = metersValue;
```

### Kredsløb (circuit simulator)

*Pending sandbox test. Expected hook point and emit call:*

```javascript
// Hook into circuit-state change; fire on component placement or parameter commit.
emit('circuit-state', {
  components: [...],          // what's in the circuit
  voltage: voltsValue,
  current: ampsValue,
  isComplete: true            // circuit is closed and functional
});
```

### Videoanalyse

*Pending sandbox test. See [expanded-workbench-types.md](expanded-workbench-types.md) Type 4 section for the state shape and privacy constraints.*

## Relationship to workbench type system

Pendul, Kredsløb, and Frekvensanalysator are **Type 1 Apps** — they slot directly into the existing `StaticArtefactFrame` infrastructure.

Videoanalyse is **Type 4 Video analysis** — needs the privacy gate and additional consent flow documented in [expanded-workbench-types.md](expanded-workbench-types.md).

GPS Fart is **Type 3 Experiment tool** — needs the sensor permissions investigation from [expanded-workbench-types.md](expanded-workbench-types.md) before implementation begins.

Do not start Videoanalyse or GPS Fart before the workbench-types doc defines the privacy/permissions approach.

## DRA maps

Each jitt.dk artefact ships with a DRA map covering which concept aspects are present vs appresent in the app, following the format in [dra-activity-framework.md](dra-activity-framework.md). AR writes the physics content; JB reviews against the PER framework. Both must sign off before the tutor system prompt is finalised.

## Checklist (per artefact before student deployment)

- [ ] Downloaded source confirmed self-contained (no external deps)
- [ ] ADR-013 scan passes (`aiplatform artefact audit` exits 0)
- [ ] postMessage `app-ready` event fires on load
- [ ] Primary interaction event fires with correct state shape
- [ ] `StaticArtefactFrame` loads it without console errors
- [ ] DRA map drafted (AR) + reviewed (JB)
- [ ] Tutor system prompt references all present DRAs and prompts for all appresent DRAs
- [ ] Tutor response references app state after first interaction event
- [ ] Lesson picker entry added (activity visible to students)
- [ ] All existing tests pass
