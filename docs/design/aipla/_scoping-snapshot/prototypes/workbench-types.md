# Design brief: Expanded workbench types

**Status:** Framing decision — implement types incrementally  
**Source:** 2026-05-26 JB feedback: *"the workbench might include other stuff than apps: Like a drawing board or things related to doing experiments or…"*  
**Target repo:** `sunholo-data/cphu-aipla-app`

---

## Current state

The workbench is a single type: a sandboxed HTML artefact (MCP App) in an iframe. The Boldkast simulator is the only live example. The LED Planck lab and KineBot are the next two.

---

## Expanded type system

A workbench artefact is anything interactive that:
- Produces state the tutor can read (via `postMessage` or direct state injection)
- Lives in the right panel of the multi-surface UI
- Is paired with a specific tutor skill in an activity config

Five types, in order of implementation complexity:

---

### Type 1: App (current — live)

An HTML/JS simulation or virtual lab in an iframe.

- State interface: `postMessage` events (`aipla:workbench`)
- Examples: Boldkast simulator, LED Planck lab, KineBot simulations, jitt.dk apps
- Sandbox: `sandbox="allow-scripts"` only
- **jitt.dk as an immediate source:** 23 Danish physics apps available free. Kartoffelkanon, Pendul, Centripetal, Kredsløb, Frekvensanalysator etc. can each become a workbench artefact once tested for iframe compatibility.

---

### Type 2: Drawing board

A collaborative whiteboard surface where students sketch free-body diagrams, graphs, ray diagrams, circuit sketches.

**Use cases:**
- Student draws a force diagram; tutor asks "what direction is the net force?"
- Student sketches a velocity-time graph; tutor asks "what does the slope represent?"
- Student annotates a photo of their experiment

**Implementation options (in order of simplicity):**
1. Embed [Excalidraw](https://excalidraw.com) — open-source, MIT-licensed, iframe-embeddable. No external network calls once hosted self-contained. Exports SVG.
2. Embed [tldraw](https://tldraw.dev) — similarly open-source.
3. Custom canvas element (most control, most effort).

**State interface:** On a timer or on explicit "share" button, the drawing board exports its current SVG/PNG and posts it to the parent frame:

```javascript
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'drawing-update',
  svg: exportedSVGString,        // for tutor to describe/analyse
  dataUrl: exportedPNG           // for display in session report
}, '*');
```

The tutor skill receives the SVG and can use a multimodal model to describe it, ask questions about it, or flag errors.

---

### Type 3: Experiment tool (phone sensor)

Apps that use real device sensors — GPS, microphone, accelerometer, light sensor — to collect live data during a physical experiment.

**jitt.dk examples:**
- **GPS Fart** — velocity from GPS; students walk/run and measure speed
- **Klinometer** — measure angles using device tilt
- **Sonar** — distance measurement via sound
- **Akustisk Stopur** — acoustic timing via microphone

**Integration pattern:** These apps already exist on jitt.dk. The integration work is:
1. Test each for `sandbox="allow-scripts"` compatibility (sensor APIs work within sandboxed iframes in modern browsers if the parent page grants permissions)
2. Add `postMessage` state events (or wrap in a thin adapter iframe that relays sensor output)
3. Tutor reads live sensor data: "Your GPS shows you're moving at 1.2 m/s — what does that tell you about the force on you?"

**Privacy note:** Sensor access (GPS, microphone) requires explicit browser permission. The opt-in prompt from the audio-capture brief covers the microphone case. GPS requires a separate permissions request. No data is sent to any external service — sensor readings stay in-browser, relayed only to the AIPLA parent frame.

---

### Type 4: Video analysis

Frame-by-frame motion analysis from a video the student records or uploads.

**jitt.dk example:** Videoanalyse — students load a video, mark a reference scale, click to track an object frame-by-frame, and the app plots position vs time.

**CoLA connection:** The CoLA architecture (ai-video-research-JB.pdf) uses video capture for collaboration assessment. For AIPLA, the more immediate use case is kinematics from video (the Tracker approach): students record a ball throw, analyse the trajectory, compare to the Boldkast simulator prediction.

**State interface:**
```javascript
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'video-analysis-update',
  data: {
    trackedPoints: [...],     // x,y per frame
    fps: 30,
    scaleFactor: 0.05,        // metres per pixel
    derivedVelocities: [...]  // computed from position differences
  }
}, '*');
```

**Privacy:** Video recorded or uploaded by the student stays in-browser unless they explicitly share it (via the session report opt-in). Do not auto-upload video to any backend without consent.

---

### Type 5: Lab notebook

A structured text area where students record observations, hypotheses, results, and conclusions — the written side of experimental work.

**Not a free-form notes field.** A structured form tied to the activity's experiment procedure:

```
Observation: _______________
Hypothesis: _______________
Method: _______________
Results: _______________
Conclusion: _______________
```

The structure is defined in the activity config. Each field is readable by the tutor:

```javascript
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'notebook-update',
  fields: {
    observation: "The LED lit up when voltage reached about 2V",
    hypothesis: "I think the threshold depends on the colour",
    results: "Red: 1.97V, Orange: 2.05V, ...",
    conclusion: ""   // not yet filled
  }
}, '*');
```

Tutor reads incomplete fields and asks questions to help students fill them in. The completed notebook becomes the student's artefact for the session report.

---

## Activity config extension

The activity config screen's **Parameters tab** (v1.1 target) needs a workbench type selector:

```
Workbench type:
  ● App (iframe)     — [select from library ▾]
  ○ Drawing board    — [Excalidraw / tldraw ▾]
  ○ Experiment tool  — [jitt.dk app ▾]
  ○ Video analysis   — [Videoanalyse / upload]
  ○ Lab notebook     — [configure fields ▾]
  ○ None (chat only)
```

Each type has its own set of sub-parameters. The tutor skill config also records the workbench type so the system prompt can reference the right UI affordances.

---

## jitt.dk integration checklist

For each jitt.dk app to be added to the artefact library:

- [ ] Load in `sandbox="allow-scripts"` iframe — does it render?
- [ ] Does it need network calls? (check for external fetches)
- [ ] Does it use sensors? If so, does the permission work inside a sandboxed iframe?
- [ ] Add `postMessage` state emitter (thin wrapper or embedded)
- [ ] Write a paired tutor system prompt referencing its specific UI
- [ ] Pass ADR-013 content review pipeline scan
- [ ] Add to activity library in teacher UI

**Priority order** (by curriculum match + low integration effort):
1. Pendul (pendulum) — planned as activity 4, no sensors, likely self-contained
2. Kredsløb (circuit) — complements LED Planck
3. Videoanalyse — unique capability, high research value
4. GPS Fart — new workbench type, phone-native
5. Frekvensanalysator — waves/sound curriculum

---

## Implementation priority

| Type | Target | Blocker |
|---|---|---|
| App (jitt.dk) | v1.1 | iframe compatibility test per app |
| Drawing board | v1.1 | Choose Excalidraw vs tldraw; self-host |
| Experiment tool | v1.2 | Sensor permissions in sandboxed iframe |
| Video analysis | v1.2 | Privacy review (even for in-browser video) |
| Lab notebook | v1.1 | Activity config fields spec |
