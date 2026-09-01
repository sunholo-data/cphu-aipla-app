# Skill brief: Boldkast projectile simulator (skill 1)

**Status:** Live in v0.1  
**Artefact class:** Phenomenon sim  
**Curriculum:** Danish stx physics-A — kastebevægelse (projectile motion)  
**Source file:** `assets/examples/projectile-motion.html`  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Depends on:** ADR-013 (artefact review pipeline), ADR-015 (multi-surface UI)

---

## What this activity teaches

Students explore how launch angle, initial speed, and height affect the range and trajectory of a projectile. The pedagogical goal is that students understand *why* the motion is parabolic — specifically that horizontal and vertical components are independent — not just that 45° maximises range.

---

## DRA map

**Status: draft — needs AR + JB review before analytics pipeline can run.**

**Concept:** Projectile motion (kastebevægelse)

| ID | Label | Present/Appresent | Modes | Notes |
|----|-------|------------------|-------|-------|
| `angle-range-relationship` | Range is maximised at 45° for flat ground | present | graphical | Directly discoverable by varying angle slider |
| `vx-vy-independence` | Horizontal and vertical motion are independent | appresent | graphical, verbal | Slider separation hints at it; physical meaning is appresent — tutor must elicit |
| `parabolic-path` | Trajectory shape is parabolic under constant gravity | present | graphical, mathematical | Visible in canvas; connection to quadratic equation is appresent |
| `time-of-flight-vertical-only` | Time in the air depends only on vertical component (and g) | appresent | mathematical, verbal | Not directly visible; requires tutor question to activate |
| `speed-squared-range-scaling` | Range scales with initial speed squared | appresent | mathematical | Requires algebraic reasoning beyond what the sim shows directly |
| `air-resistance-absence` | Sim assumes no air resistance — real trajectories differ | appresent | verbal | Model limitation; important for connecting to real-world experience |

**Tutor question patterns** (for post-session DRA tagging pass):

```yaml
dras:
  - id: angle-range-relationship
    label: "Range is maximised at 45° for flat ground"
    type: present
    present_in_modes: [graphical, mathematical]
    tutor_question_patterns:
      - "hvad sker der med rækkevidden når du ændrer vinklen"
      - "which angle gives the longest range"
      - "prøv at finde den vinkel der giver"
      - "what did you notice when you changed the angle"

  - id: vx-vy-independence
    label: "Horizontal and vertical motion are independent"
    type: appresent
    present_in_modes: [graphical, verbal]
    tutor_question_patterns:
      - "hvad sker der med den vandrette hastighed"
      - "what happens to the horizontal velocity when"
      - "does the time in the air depend on the horizontal"
      - "if I only changed the horizontal speed"
      - "er den vandrette og lodrette bevægelse uafhængige"

  - id: time-of-flight-vertical-only
    label: "Time of flight depends only on vertical component"
    type: appresent
    present_in_modes: [mathematical, verbal]
    tutor_question_patterns:
      - "hvad bestemmer hvor lang tid bolden er i luften"
      - "what determines how long the ball is in the air"
      - "if I doubled the horizontal speed but kept everything else the same"
      - "hvad ville ske med flyvetiden hvis"

  - id: speed-squared-range-scaling
    label: "Range scales with initial speed squared"
    type: appresent
    present_in_modes: [mathematical]
    tutor_question_patterns:
      - "if you doubled the launch speed what would happen to the range"
      - "hvad sker der med rækkevidden hvis du fordobler starthastigheden"
      - "how does range depend on speed"

  - id: air-resistance-absence
    label: "Sim assumes no air resistance"
    type: appresent
    present_in_modes: [verbal]
    tutor_question_patterns:
      - "does a real ball follow this path"
      - "what does the simulation leave out"
      - "hvad tager simuleringen ikke højde for"
      - "ville en rigtig bold følge denne bane"
```

> **For AR + JB:** are these 6 DRAs the right set? Which is highest priority for stx physics-A assessment? The `vx-vy-independence` DRA is the one identified in the teacher analytics example as most frequently missed — confirm this matches AR's classroom experience.

---

## Workbench artefact

Single-page HTML/canvas simulator. Controls: angle slider (0°–90°), initial speed slider, launch height toggle. Canvas shows real-time trajectory arc; outputs range, max height, time of flight.

### postMessage events emitted

```javascript
// On sim run (fire button):
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'sim-run',
  data: {
    angle: 45,          // degrees
    speed: 20,          // m/s
    height: 0,          // m (launch height above ground)
    range: 40.8,        // m (computed)
    max_height: 10.2,   // m
    time_of_flight: 2.9 // s
  }
}, '*');

// On slider change (debounced 800ms):
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'changed',
  data: { field: 'angle', value: 45 }
}, '*');
```

### postMessage events received

```javascript
{ type: 'aipla:restore', state: { angle: 45, speed: 20, height: 0 } }
```

---

## Tutor system prompt

See `strand-a-pedagogical-bot/architecture/boldkast-system-prompt.md` (or inline in activity config YAML).

Key constraints:
- Language: Danish (students) with English fallback
- Socratic: never state the answer; ask questions that lead toward the DRA
- DRA priority: surface appresent DRAs (`vx-vy-independence`, `time-of-flight-vertical-only`) after the student has discovered the angle-range relationship graphically
- Scope: projectile motion only; redirect off-topic (e.g. air resistance tangents should be brief)

---

## Activity config YAML

```yaml
activity_id: boldkast-v1
title: "Boldkast — kastebevægelse"
curriculum:
  - "Danish stx physics-A: kastebevægelse"
workbench: boldkast-simulator-v1
language: da
dra_map_version: "0.1-draft"
```

---

## Deployment checklist

- [x] Workbench artefact live in `assets/examples/projectile-motion.html`
- [x] Activity page live on public site (`examples.qmd`)
- [x] `{teacher_focus}` injection confirmed working end-to-end (2026-05-26)
- [ ] DRA map reviewed by AR + JB
- [ ] `tutor_question_patterns` confirmed against real session transcripts
- [ ] postMessage events implemented (sim-run event)
- [ ] Workbench state debounce: 800ms on angle/speed sliders
- [ ] ADR-013 content review pipeline scan passed
- [ ] Session summary job: DRA tagging pass enabled for `boldkast-v1`
