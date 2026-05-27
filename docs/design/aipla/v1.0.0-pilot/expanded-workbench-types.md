# Expanded workbench type system (Types 2–5)

**Status**: Framing decision; implement types incrementally
**Priority**: P2 (v1.1 target for Types 2 + 5; v1.2 for Types 3 + 4; decision after pilot feedback)
**Estimated**: Type 2 (drawing board): 2–3d; Type 5 (lab notebook): 1d; Types 3+4 need scoping
**Scope**: Frontend (new iframe wrappers / components per type), activity config extension, skill config schema change
**Dependencies**: [lesson-picker.md](lesson-picker.md); [teacher-ui.md](teacher-ui.md) Phase 2 (activity config screen); Types 3+4 require privacy review and sensor-permission investigation; [jitt-dk-artefacts.md](jitt-dk-artefacts.md) for the jitt.dk apps that use Types 3 + 4
**Pedagogical source-of-truth:** [`workbench-types.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/workbench-types.md) in the scoping site — full type definitions, event shapes, and the jitt.dk integration checklist. JB framing: *"The workbench might include other stuff than apps: Like a drawing board or things related to doing experiments or…"*
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

## Problem Statement

The workbench is currently a single type: a sandboxed HTML artefact (MCP App) in an iframe (Type 1). JB's 2026-05-26 feedback flagged that the workbench concept should be broader — drawing boards, physical experiment tools, video analysis, lab notebooks are all forms of "interactive student work surface" that the Socratic tutor should be able to read. Each produces state the tutor can act on; none requires a full simulator.

Formalising the type system now prevents ad-hoc iframe wrappers diverging from each other and ensures the tutor skill config knows which postMessage shape to expect. The type also drives the activity config UI.

**Current state:**
- Type 1 (App) is live — `StaticArtefactFrame` + ADR-013 pipeline + JSON-RPC 2.0 `ui/update-model-context` wire (the old `aipla:workbench` postMessage format was superseded in MCPAPP-SPEC sprint 2026-05-21).
- Types 2–5 are described in the scoping site brief but have no execution doc in this repo.
- The activity config screen (1.G Phase 2) has a workbench slot — currently hardcoded to Type 1.

**Impact (if not formalised):**
- Each new workbench type gets a bespoke implementation with no shared contract.
- The tutor skill config can't declare what type it expects, so the InstructionProvider injection can't adapt its context shape.
- Drawing boards and lab notebooks — the cheapest new types — stay permanently deferred because there's no clear spec to build against.

## Architectural principle: the workbench is the sim, not the whole lesson

Each workbench type provides **one interactive student surface** — the simulation, the drawing board, the sensor tool, the video tracker, or the notebook. It does not provide instructions, procedure checklists, AI chat, quizzes, data tables, or formula references. Those are AIPLA's job:

- **Instructions / procedure** → the Socratic tutor guides the student through these in chat
- **AI hints / explanations** → the tutor provides Socratically (never as a list in the artefact)
- **Data recording / results** → Type 5 lab notebook, or tutor-elicited in conversation
- **Progress tracking** → platform-level session state

This separation is why AIPLA is the platform, not just a container. An existing teaching tool (jitt.dk app, LED Planck lab) that bundles simulation + instructions + AI is being **refactored**, not just rehosted. The workbench artefact gets the sim core; AIPLA gets the rest.

The reference implementation is **Boldkast**: one canvas, sliders, answer-reveal markers. Not a procedure panel, not a quiz, not a data table.

## Goals

**Primary goal:** A formal 5-type taxonomy with: a named type identifier, a canonical wire shape per type, a React wrapper component per type, and an activity config field that records the workbench type and sub-parameters. Tutor skill configs record the expected type so the InstructionProvider knows how to describe the workspace state in the agent prompt.

**Non-goals (this doc):**
- Implementing all 5 types in one sprint (incremental delivery per type)
- Sensor data telemetry to BigQuery (beyond what already ships in session logs)
- Cross-student collaborative whiteboards (single-student scope for v1)
- Video storage or playback (video stays in-browser for v1)

## The five types

### Type 1: App (live)

An HTML/JS simulation or virtual lab in a sandboxed iframe. State flows via **JSON-RPC 2.0 `ui/update-model-context` notifications** to the parent `StaticArtefactFrame`.

Examples: Boldkast, LED Planck, KineBot, jitt.dk Type-1 apps (Pendul, Kredsløb, Frekvensanalysator).

**Wire format note:** The raw `{type: 'aipla:workbench', event: '...'}` postMessage format is obsolete. All artefacts use `rpcNotify("ui/update-model-context", {structuredContent: {kind: "<app>.event", ...payload}})` after completing the `ui/initialize` handshake. See [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) for the exact helper block to add.

No new work — this type is complete. All future App artefacts follow the mcp-app-artefact skill runbook.

---

### Type 2: Drawing board

A collaborative whiteboard surface where students sketch free-body diagrams, graphs, ray diagrams, circuit sketches. State shared via periodic SVG/PNG export.

**Use cases:** Student draws a force diagram, tutor asks "what direction is the net force?"; student sketches a v-t graph; student annotates a photo of their experiment.

**Implementation (recommended):** Self-host [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT licence, iframe-embeddable). Bundle the static build at `infrastructure/mcp-sandbox/artefacts/drawing-board/v1/`. Fallback: tldraw (also MIT, similar API surface). Custom canvas is last resort.

**Wire shape:** The drawing board artefact is served through `StaticArtefactFrame` like any other App. It must include the RPC helpers and complete the `ui/initialize` handshake. On share or idle-timer, emit:

```javascript
// Emitted: on explicit "share with tutor" button, or on a 30-second idle timer
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "drawing-board.update",
    svg: exportedSVGString,      // tutor uses multimodal model to describe it
    dataUrl: exportedPNGBase64,  // for session report display
    elementCount: 12             // rough complexity indicator
  }
});
```

**Agent-side handling:** The tutor skill config sets `workbench_type: drawing-board`. The InstructionProvider injects the SVG description into the agent context (via a multimodal model call to convert SVG → text description). The agent then asks questions about what it sees.

**Privacy:** SVG/PNG data stays in-session (BigQuery sink stores a hash, not the content, unless research consent is given). No export to third-party services.

**Estimated:** 2–3 days (Excalidraw self-hosting + parent wrapper + postMessage contract + agent multimodal path).

---

### Type 3: Experiment tool (phone sensor)

Apps that use real device sensors — GPS, microphone, accelerometer, light sensor — to collect live data during a physical experiment.

**jitt.dk examples:** GPS Fart (velocity from GPS), Klinometer (tilt angle), Sonar (acoustic distance), Akustisk Stopur (acoustic timing).

**Integration pattern:** These apps already exist on jitt.dk. The integration work is:
1. Test each for `sandbox="allow-scripts"` compatibility. **Sensor APIs (DeviceMotionEvent, Geolocation) may not work inside a sandboxed iframe without `allow-same-origin` — this is the primary unknow to resolve before implementation starts.**
2. If sensor APIs are blocked by the sandbox, wrap in a thin parent-frame mediator component that requests browser permissions, relays sensor data to the sandboxed iframe, and also forwards to `mcp_app_context`.
3. Add postMessage state emitter once sensor data is available.

**Wire shape (example — GPS Fart, once sensor access resolved):**

```javascript
// Same RPC helpers as all other artefacts; sensor data flows via rpcNotify
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "gps-fart.sensor-reading",
    sensor: "gps-velocity",
    speed_ms: 1.24,           // m/s
    heading: 273,             // degrees
    timestamp: Date.now()
  }
});
```

**Prerequisite investigation (before any Type 3 implementation):** Build a one-page sandbox test — request DeviceMotionEvent + Geolocation from within `sandbox="allow-scripts"` without `allow-same-origin`. Measure: does the permission prompt fire? If not, the parent-frame mediator pattern is required. Document the result and update this doc before implementation proceeds.

**Privacy:** GPS and motion data stays in-session (not uploaded to backend unless research consent). The permissions request must be explicit (browser-native prompt). No silent sensor access.

**Estimated:** 2–3 days per app once the sensor sandbox investigation is complete. Investigation itself: 0.5 days.

---

### Type 4: Video analysis

Frame-by-frame motion analysis from a video the student records or uploads. The student marks a reference scale, tracks an object across frames, and the app plots position vs time.

**Primary example:** Videoanalyse from jitt.dk.

**CoLA connection:** The CoLA architecture (ai-video-research-JB.pdf) uses video capture for collaboration assessment. For AIPLA v1, the use case is kinematics from video — students record a ball throw, analyse the trajectory, compare to the Boldkast simulator prediction.

**Wire shape:**

```javascript
rpcNotify("ui/update-model-context", {
  structuredContent: {
    kind: "videoanalyse.analysis-update",
    fps: 30,
    scaleFactor: 0.05,           // metres per pixel
    trackedPoints: [             // one per frame
      { frame: 0, x: 120, y: 450 },
      { frame: 1, x: 135, y: 448 },
    ],
    derivedVelocities: [...]     // computed from position differences
  }
});
```

**Privacy gate (required before implementation):** Video stays in-browser for v1. No auto-upload to any backend. If the research-consent flow (1.2 BigQuery sink + audio-capture consent) is extended to video, that extension must be a named, explicit decision — not an implicit consequence of building this type. Document the decision in the ADR-013 update before shipping.

**Estimated:** 2–3 days (Videoanalyse iframe compatibility test + postMessage wiring + privacy review + tutor prompt for trajectory interpretation).

---

### Type 5: Lab notebook

A structured text area where students record observations, hypotheses, results, and conclusions. Not a free-form notes field — the structure is defined in the activity config.

**Use case:** LED Planck + lab notebook together: the notebook prompts the student to record U₀ for each LED and write a conclusion about Planck's constant. The tutor reads incomplete fields and asks Socratic questions.

**Implementation:** A React component (`LabNotebookFrame`) with fields defined by the activity config YAML:

```yaml
workbench_type: lab-notebook
notebook_fields:
  - key: observation
    label: "Hvad observerede du?"
  - key: hypothesis
    label: "Hvad forventer du vil ske?"
  - key: results
    label: "Dine resultater"
  - key: conclusion
    label: "Din konklusion"
```

**State sharing:** Unlike Types 1–4, the lab notebook is a native React component (`LabNotebookFrame`) living in the host frontend — it is **not** an iframe artefact. It does not need the RPC helpers or `ui/initialize` handshake. State flows directly through the host's session state when the student edits a field:

```typescript
// LabNotebookFrame calls this on field change (debounced 800ms)
postSessionIframeContext(sessionId, {
  serverId: "lab-notebook",
  toolName: "fields",
  structuredContent: {
    kind: "lab-notebook.update",
    fields: {
      observation: "LED lyste ved ca. 2V",
      hypothesis: "Jeg tror tærsklen afhænger af farven",
      results: "Rød: 1.97V, Orange: 2.05V, ...",
      conclusion: ""    // not yet filled — tutor asks about this
    }
  }
});
```

**Estimated:** 1 day (React component + session state push + activity config field parser).

---

## Activity config extension

The activity config screen's **Parameters tab** ([teacher-ui.md](teacher-ui.md) Phase 3 / v1.1) needs a workbench type selector:

```yaml
# In skill template YAML
workbench_type: app       # 'app' | 'drawing-board' | 'experiment-tool' | 'video-analysis' | 'lab-notebook' | 'none'
workbench_artefact: pendul-v1   # only for type 'app' — references artefact library ID
notebook_fields: [...]          # only for type 'lab-notebook'
```

The InstructionProvider injection already reads `mcp_app_context.<artefact>.state`. Extend it to handle each type's state shape, inserting an appropriate description into the agent prompt:
- Type 1: existing artefact state injection
- Type 2: "The student's drawing shows: [multimodal description]"
- Type 3: "The sensor is reading: [sensor type] = [value] [unit]"
- Type 4: "The student's video analysis shows: [trajectory data summary]"
- Type 5: "The student's lab notebook: [field-by-field summary including any empty fields]"

## Implementation sequence

| Type | When | Prerequisite |
|---|---|---|
| Type 2 (drawing board) | v1.1, after pilot feedback | Excalidraw self-hosting decision; multimodal SVG-to-text path in agent |
| Type 5 (lab notebook) | v1.1, alongside drawing board | Activity config YAML schema extension |
| Type 3 (experiment tools) | v1.2 | Sensor sandbox investigation complete |
| Type 4 (video analysis) | v1.2 | Privacy review complete |

Type 1 (App) is already live and will expand via [jitt-dk-artefacts.md](jitt-dk-artefacts.md).
