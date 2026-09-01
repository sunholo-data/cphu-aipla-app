# Migration brief: KineBot v2 → AIPLA skill 2

**Status:** Ready to plan; implement after LED Planck (skill 3) is live  
**Migration type:** Existing AI-powered artefact → AIPLA-compliant activity  
**Curriculum:** NCERT/CBSE Class 11 Physics — kinematics (11 topics)  
**Beta cohort:** DK's students (Indian, ~100s of students available)  
**Source file:** `sources/kinebot_v2 (3).html` (~1707 lines)  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Purpose as migration example:** Stress-test the AIPLA dev skill at taking an external AI artefact and producing a compliant activity — a reusable migration pattern for future onboarding.

---

## What KineBot does (as-shipped)

Full kinematics tutoring system combining four modes in one HTML file:

| Mode | What it is |
|---|---|
| **Chat tutor** | Claude (claude-sonnet-4-20250514) via direct browser API call. Warm Socratic persona, 11 kinematics topics, quick-prompt buttons. |
| **7 simulations** | Canvas-based: 1D uniform motion, uniformly accelerated motion, free fall, projectile motion, circular motion, vector addition, relative velocity. Sliders for velocity/acceleration/angle with live readouts. |
| **Motion graph plotter** | x-t, v-t, a-t graphs plus projectile range-vs-angle and max-height curves. |
| **Adaptive quiz** | AI-generated MCQs (Claude call) filtered by current topic. |
| **Formula reference** | Static lookup by topic. |

**What the as-shipped version does that AIPLA must replace:**
- Direct `fetch('https://api.anthropic.com/v1/messages', ...)` with `anthropic-dangerous-direct-browser-access: true` header — lines ~1056, 1120, 1558
- Student must supply their own Anthropic API key — stored in `sessionStorage`
- No log capture; chat goes browser → Anthropic directly, bypasses AIPLA's BigQuery sink
- Quiz generation is also a direct API call (line ~1558)

---

## DRA map

**Status: stub — needs AR + DK input before analytics pipeline can run.**

KineBot covers 11 NCERT kinematics topics. Each topic is a separate activity in AIPLA — each needs its own DRA map. The map below covers the core projectile motion topic (the most likely first activity for DK's beta cohort), as it overlaps with the Boldkast DRA map and allows cross-curriculum comparison.

**Concept:** Projectile motion (NCERT Class 11, Chapter 4)

| ID | Label | Present/Appresent | Modes | Notes |
|----|-------|------------------|-------|-------|
| `vx-vy-independence` | Horizontal and vertical motion are independent | present | graphical | Visible in sim (separate v sliders), but independence is still appresent |
| `parabolic-path` | Trajectory is parabolic under constant gravity | present | graphical, mathematical | Shown in canvas — students can see the shape |
| `range-angle-relationship` | Range maximised at 45° for flat ground | present | graphical, mathematical | Discoverable by varying angle slider |
| `time-of-flight-vertical-only` | Time of flight depends only on vertical component | appresent | mathematical, verbal | Not visible in sim; tutor must elicit it |
| `ncert-formula-connection` | Connecting sims to NCERT standard equations | appresent | mathematical | DK's students need to map sim behaviour to textbook formulas |

> **For AR + DK to review:** DK knows the NCERT curriculum and student prior knowledge — DRA map should be validated against what students typically struggle with in Class 11. Remaining 10 topics (1D uniform motion, free fall, circular motion, etc.) need separate DRA maps.

---

## Migration goal: AIPLA-compliant activity

The target is a activity pair:
- **Skill (tutor):** KineBot's system prompt and behaviour, reconfigured as an AIPLA skill that routes through the AIPLA backend (not direct to Anthropic)
- **Workbench artefact (MCP App):** The 7 simulations + graph plotter as a sandboxed iframe, with postMessage state events so the tutor can read what the student is doing

The quiz and formula-reference modes stay inside the artefact. The *chat* moves outside to the AIPLA chat surface.

---

## What needs to change

### Critical (blocking student deployment)

**1. Remove all direct API calls**

Delete or stub three fetch calls:
- Line ~1056: chat message send
- Line ~1120: streaming response handler  
- Line ~1558: quiz generation

Replace chat with: postMessage to parent frame → AIPLA backend → Claude → parent frame → postMessage back to iframe (or just remove the embedded chat panel entirely and let the AIPLA chat surface handle it).

Replace quiz generation with: either a static pre-generated quiz bank (simpler, faster) or route through AIPLA backend via postMessage.

**2. Remove API key input UI**

The modal/input that asks the student for an Anthropic key (search for `apiKey`, `sessionStorage.setItem`) — remove entirely. AIPLA handles auth.

**3. Wire simulation state to parent frame**

Add postMessage events so the tutor (in the AIPLA chat surface) can read what the student is doing on the workbench. Minimum viable set:

```javascript
// When student changes topic in sidebar
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'topic-change',
  topic: currentTopic  // e.g. 'projectile-motion', 'free-fall'
}, '*');

// When student runs a simulation
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'sim-run',
  simType: activeSim,          // e.g. 'projectile'
  params: {
    velocity: sliderVelocity,
    angle: sliderAngle,        // if applicable
    acceleration: sliderAccel
  }
}, '*');

// When student changes a graph type
window.parent.postMessage({
  type: 'aipla:workbench',
  event: 'graph-change',
  graphType: activeGraph  // 'x-t' | 'v-t' | 'a-t' | 'range-angle' | 'max-height'
}, '*');
```

### Important (for AIPLA compliance, not blocking beta)

**4. Extract system prompt as skill config**

The existing system prompt is hardcoded around line 1030 as `SYSTEM_PROMPT`. Extract to AIPLA skill config YAML. The prompt is well-written — keep it, just move it out of the HTML.

**5. Serialize student progress state**

KineBot tracks: `xp`, `visitedTopics` (set), `currentTopic`, `quizScore`, `quizAttempts`. For AIPLA, persist to `localStorage` keyed by group ID so state survives page refresh within a session. (Cross-session persistence is a stretch goal.)

**6. Replace Google Fonts CDN with local or system fonts**

Three font families load from `fonts.googleapis.com`. For `sandbox="allow-scripts"` this is fine (CSS is not blocked by allow-scripts), but for stricter CSP environments it will break. Self-host or use system font stack fallback.

### Stretch (post-beta)

- Accessibility: current base font is `.7rem` — increase to 1rem minimum, WCAG AA contrast check
- Quiz bank: current AI-generated quiz is unpredictable. Pre-generate and vet a bank of 30+ questions per topic
- Hint system: add structured scaffolding hints for struggling students rather than relying entirely on chat

---

## Skill configuration (after migration)

```yaml
skill_id: kinebot-kinematics-tutor
display_name: "Kinematics Tutor"
language: en
curriculum: ncert-cbse-class11
paired_workbench: kinebot-simulations
reads_workbench_state: true
system_prompt: |
  # Extract from SYSTEM_PROMPT constant in source, lines ~1030–1200
  # Keep as-is; it is well-designed for Socratic kinematics teaching
  ...
```

---

## Migration as a pattern test

This migration exercises the full AIPLA onboarding workflow for an externally-built AI artefact. Document as a runbook as you go:

1. **Audit** — what the artefact does, what violates AIPLA constraints (done above)
2. **Strip** — remove direct API calls, remove key input UI
3. **Wire** — add postMessage state events
4. **Extract** — move system prompt to skill config
5. **Package** — ADR-013 pipeline scan, sandbox test
6. **Pair** — create activity config linking skill + workbench
7. **Test** — group-ID join → load activity → tutor reads workbench state → confirms values in chat

Steps 3–7 should become the standard AIPLA migration checklist for any future onboarding of externally-built AI artefacts.

---

## Checklist before beta with DK's students

- [ ] Direct API calls removed (lines ~1056, 1120, 1558)
- [ ] API key UI removed
- [ ] postMessage: topic-change event fires on sidebar click
- [ ] postMessage: sim-run event fires with correct params
- [ ] postMessage: graph-change event fires
- [ ] System prompt extracted to skill config YAML
- [ ] ADR-013 pipeline scan passes
- [ ] Sandbox test: runs in `sandbox="allow-scripts"` iframe
- [ ] Group-ID join flow: student joins → activity loads → workbench visible
- [ ] Tutor reads topic + sim state: references them in chat response
- [ ] DK confirms curriculum coverage and quiz quality before wide rollout
- [ ] Log capture: chat messages reach BigQuery sink (ADR-005)
