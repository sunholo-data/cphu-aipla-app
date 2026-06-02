# Event vocabulary — examples from the three exemplar sims

When an artefact emits `ui/update-model-context` it must include a `structuredContent.kind` string that the host's `handleStructuredContent` reducer can dispatch on. This is the artefact's pedagogical event vocabulary — the design surface where you decide *what the agent will see*.

Examples below are extracted from the three live sims as of 2026-06-02. Use them as the shape reference when designing a new artefact's events. The naming convention is **`<artefact-id>.<event-kind>`** (kebab-case on both halves) — server prefix prevents collisions across mounted sims.

## Boldkast (projectile motion)

```json
// Student opened the sim — silent push, no chat card.
{ "kind": "boldkast.open" }

// Slider settled on a new value. `changed` lists the field(s) that
// just changed; `state` is the full current snapshot so the agent
// always sees coherent values. `triggeredBy` distinguishes user
// exploration ("slider") from a commit signal ("chat-submit").
{
  "kind": "boldkast.state-change",
  "changed": ["theta"],
  "state": { "v0": 15, "theta": 40, "g": 9.8 },
  "triggeredBy": "slider"
}

// Student revealed a labelled value on the visualisation.
{
  "kind": "boldkast.show_value",
  "marker": "max-height",
  "revealed": true
}
```

## LED Planck (procedural virtual lab)

```json
// Student advanced to a new step in the lab procedure.
{
  "kind": "led-planck.step-change",
  "step": 3,
  "stepName": "measure-voltage"
}

// A measurement was recorded (one row of the data table).
{
  "kind": "led-planck.reading-added",
  "reading": {
    "color": "red",
    "voltageV": 1.78,
    "wavelengthNm": 660
  }
}

// Student opened a hint / explanation modal.
{
  "kind": "led-planck.hint-opened",
  "step": 3
}
```

## KineBot (kinematics)

```json
// Student switched to a different physics topic.
{
  "kind": "kinebot.set-topic",
  "topic": "projectile-motion"
}

// Sim ran with these parameters (silent push — the params matter,
// not the click).
{
  "kind": "kinebot.sim-run",
  "simType": "projectile",
  "params": { "v": 20, "theta": 45 }
}

// Student switched which graph is on screen.
{
  "kind": "kinebot.graph-change",
  "graphType": "velocity-time"
}

// Student answered a quiz question — `answeredCorrectly` drives the
// silent-vs-card decision (correct = card, incorrect = silent).
{
  "kind": "kinebot.quiz-attempt",
  "topic": "kinematics-1d",
  "questionId": "q-acc-1",
  "answeredCorrectly": true
}
```

## Designing for a new sim — checklist

When you choose your event kinds:

1. **Prefix every kind with your server id.** `pendul.*`, `kredslob.*`, never bare `state-change`.
2. **Cover the silent vs card decision in the kind itself.** Boldkast's `boldkast.show_value` separates "revealed something" from generic state changes so the reducer can dispatch a card only when it's pedagogically interesting.
3. **Carry the full snapshot when the field set is small** (Boldkast: 3 fields per state-change). Carry just the delta when the snapshot is large (LED Planck: each `reading-added` carries one reading, not the whole table).
4. **Use `triggeredBy` for commit-vs-exploration** if the artefact has debounce + commit-on-submit. Phase 2 commit gating relies on this.
5. **Keep the JSON ≤ 4 KB.** The backend `iframe_context_routes.py` enforces this; structuredContent over the cap returns 413.
6. **Never echo back what the host pushed via `<artefact>.set-*` notifications.** No-mirror rule.
