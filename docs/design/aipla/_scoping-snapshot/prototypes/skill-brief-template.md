# Skill brief: [Activity name] (skill N)

**Status:** Draft / Ready to implement  
**Artefact class:** Phenomenon sim / Procedural virtual lab / Hybrid AI platform  
**Curriculum:** [Danish stx physics-A topic] / [NCERT Class N topic]  
**Source file:** `sources/...` or `assets/examples/...`  
**Target repo:** `sunholo-data/cphu-aipla-app`  
**Depends on:** ADR-013 (artefact review pipeline), ADR-015 (multi-surface UI)

---

## What this activity teaches

[1–2 sentences: what the student does and what the pedagogical goal is. What must they understand — not just discover by clicking — by the end?]

---

## DRA map

**Required before implementing the analytics pipeline.** Fill in with AR (physics) + JB (PER). Each DRA is one disciplinary-relevant aspect of the target concept.

**Concept:** [e.g. projectile motion, photon energy model]

| ID | Label | Present/Appresent | Accessible via modes | Notes |
|----|-------|------------------|---------------------|-------|
| `[slug]` | [One-line description of the aspect] | present / appresent | graphical, verbal, mathematical, schematic, experimental | [Optional: why this is easy/hard to activate] |

**Present** = directly visible in the simulation or artefact.  
**Appresent** = implied but not shown — the tutor must ask questions to activate it.  
**Modes:** graphical (sim visuals), verbal (chat), mathematical (equations), schematic (diagrams), experimental (sensor/physical data).

**Tutor question patterns** — phrases that activate each DRA (used by the post-session tagging job):

```yaml
dras:
  - id: [slug]
    label: "[Label]"
    type: present | appresent
    present_in_modes: [graphical, verbal, ...]
    tutor_question_patterns:
      - "[phrase the tutor uses to target this DRA]"
      - "[another phrase]"
```

> **Note for AR/JB:** the `tutor_question_patterns` list does not have to be exhaustive — 3–5 phrases per DRA is enough for the fuzzy-match tagging pass. Add more over time as you see what the tutor actually says in sessions.

---

## Workbench artefact

[Brief description of the HTML file: what it does, how many steps/modes, key UI controls.]

### postMessage events emitted

```javascript
// On [event]:
window.parent.postMessage({
  type: 'aipla:workbench',
  event: '[event-name]',
  data: { /* fields */ }
}, '*');
```

| Event | When | Key fields |
|-------|------|-----------|
| `[event-name]` | [Trigger] | `field: type` |

### postMessage events received

```javascript
// Parent → iframe on session restore:
{ type: 'aipla:restore', state: { /* last known workbench state */ } }
```

---

## Tutor system prompt

[Include the full system prompt, or a link to it if it's in the activity config YAML.]

Key constraints:
- Language: [Danish / English / bilingual]
- Socratic: never state answers directly
- Scope: stay within [topic]; redirect off-topic questions
- DRA priority: surface appresent DRAs first (they are what the sim cannot show)

---

## Activity config YAML

```yaml
activity_id: [slug]-v1
title: "[Display name]"
curriculum:
  - "[Danish stx topic]"
  # and/or:
  - "[NCERT Class N chapter]"
workbench: [artefact-filename]-v1
language: da | en
dra_map_version: "0.1"
```

---

## Deployment checklist

- [ ] DRA map authored by AR + JB (required before analytics)
- [ ] postMessage events implemented in artefact HTML
- [ ] System prompt written and tested in isolation
- [ ] `{teacher_focus}` injection confirmed working end-to-end
- [ ] ADR-013 content review pipeline scan passed
- [ ] Added to activity library in teacher UI
- [ ] Session summary job: DRA tagging pass enabled for this activity
- [ ] Workbench state debounce: 800ms on all slider inputs (see `workbench-state-debounce.md`)
