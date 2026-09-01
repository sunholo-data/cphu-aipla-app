# Design brief: Teacher analytics — representational competence framework

**Status:** Design — target v1.2 analytics chat  
**Depends on:** teacher-ui-brief.md (Screen 5), session-persistence.md, ADR-005 (chat log storage)  
**Framework source:** Linder, Bruun, Pohl & Priemer (2024) — `notes/2026-05-26-representational-competence-framework.md`  
**Target repo:** `sunholo-data/cphu-aipla-app`

---

## The question this doc answers

The session report and analytics chat currently surface behavioural metadata: how long, how many turns, which sim parameters, which checklist steps completed. That is *what students did*.

The representational competence framework asks a harder question: *what conceptual territory did they cover?*

Specifically:
- Which **disciplinary-relevant aspects (DRAs)** of the activity's target concept were activated in the session?
- Which were missed?
- Which **representational modes** did the group engage with — and which did they avoid?
- What does the **relevance structure** of their responses suggest about how they are thinking about the concept?

This doc defines: (a) what raw data we need to capture to answer these questions, (b) what the analytics pipeline adds, and (c) how it surfaces in the teacher UI.

---

## Current data capture vs framework needs

### What we already capture

| Data | Storage | Granularity |
|------|---------|-------------|
| Chat log (student + tutor turns) | BigQuery (ADR-005) | Per turn, timestamped |
| Workbench state events (`aipla:workbench`) | BigQuery | Per event: field, value, timestamp |
| Sim runs (Boldkast: angle, v0, height) | Workbench events | Per run |
| Teaching goal (`teacher_focus`) | Firestore activity config | Per session config |
| Session metadata (group_id, activity_id, duration) | Firestore session doc | Per session |
| Checklist steps completed | Chat log + tutor events | Via structured tutor output |

### What the framework needs and doesn't yet have

| Framework construct | What it needs | Gap |
|--------------------|--------------|-----|
| **DRA activation** | Evidence that a specific DRA was engaged (correctly or not) in student speech or workbench action | No DRA map per activity; no tagging of turns/events to DRAs |
| **Representational mode** | Which modes appeared in the session: graphical (sim), verbal (chat), mathematical (equations), pictorial (photos), gestural (sensor) | Mode is implicit in event source (workbench = graphical, chat = verbal/written) — not tagged |
| **Relevance structure** | Which conceptual stance is the student applying? (cf. Module 1/2/3 for refraction) | No structured response classification |
| **Appresent DRA engagement** | Did the tutor ask about what the sim *implies*, not just what it shows? | Not tracked — tutor turns are unstructured text |
| **DRA coverage score** | Fraction of the activity's DRAs that were touched in the session | Requires DRA map per activity |

---

## What we need to add

### 1. Per-activity DRA map (human-authored, not generated)

Before automated analytics can work, each activity needs a DRA specification. This is not generated at runtime — it is authored by AR and JB for each activity and stored in the activity config.

Format (`activity_config.dra_map`):

```json
{
  "activity_id": "boldkast-v1",
  "concept": "projectile motion",
  "dras": [
    {
      "id": "vx-vy-independence",
      "label": "Horizontal and vertical motion are independent",
      "type": "appresent",
      "present_in_modes": ["graphical"],
      "tutor_question_patterns": [
        "what happens to horizontal velocity when",
        "does the time in the air depend on",
        "if I only change the horizontal"
      ]
    },
    {
      "id": "angle-range-relationship",
      "label": "Range is maximised at 45° (for flat ground)",
      "type": "present",
      "present_in_modes": ["graphical", "mathematical"],
      "tutor_question_patterns": [
        "what angle gives the longest range",
        "what did you notice when you changed the angle"
      ]
    },
    {
      "id": "initial-conditions-effect",
      "label": "Range scales with initial speed squared",
      "type": "appresent",
      "present_in_modes": ["mathematical"],
      "tutor_question_patterns": [
        "if you doubled the launch speed",
        "what would happen to the range if"
      ]
    },
    {
      "id": "air-resistance-absence",
      "label": "Simulation assumes no air resistance (model limitation)",
      "type": "appresent",
      "present_in_modes": ["verbal"],
      "tutor_question_patterns": [
        "does a real ball follow this path",
        "what does the simulation leave out"
      ]
    }
  ]
}
```

**Who authors this:** AR (physics) + JB (PER) for each activity. Target: Boldkast DRA map before 3 June check-in. LED Planck and KineBot after.

---

### 2. Session-level DRA activation tagging

After a session ends, the session summary job (currently: pull log → call analytics skill → store summary) gains a second pass:

```
DRA tagging pass:
  For each DRA in the activity's dra_map:
    Scan chat log for tutor_question_patterns (fuzzy match)
    Scan student turns for DRA-related responses
    Tag DRA as: activated | partially_activated | not_reached
    If activated: note first turn index and mode
```

This produces a per-session DRA coverage record stored alongside the summary:

```json
{
  "session_id": "bold-kazoo-87/boldkast-v1/2026-05-25T14:12",
  "dra_coverage": {
    "vx-vy-independence":      { "status": "activated",         "first_turn": 14, "modes": ["verbal"] },
    "angle-range-relationship": { "status": "activated",         "first_turn": 7,  "modes": ["graphical", "verbal"] },
    "initial-conditions-effect":{ "status": "not_reached",       "first_turn": null },
    "air-resistance-absence":   { "status": "partially_activated","first_turn": 28, "modes": ["verbal"] }
  }
}
```

**Implementation note:** The tagging pass is a lightweight LLM call with the DRA map + session log as context. It does not require additional instrumentation in the student-facing app — it runs post-session on existing BigQuery data.

---

### 3. Mode tagging (already implicit — make explicit)

We already know which surface each event came from. Tag explicitly at event write time:

| Event source | Mode |
|-------------|------|
| Workbench state event (slider, graph, sim run) | `graphical` |
| Chat turn (student or tutor) | `verbal` / `written` |
| Drawing board SVG export | `schematic` |
| Experiment tool (sensor reading) | `experimental` |
| Lab notebook field update | `written` |

No new capture needed — add `mode` field to event schema in BigQuery. One migration.

---

### 4. Relevance structure signal (research-track, not v1.2)

The paper's Module 1/2/3 structure is refraction-specific — each concept needs its own relevance structure analysis, which requires collecting enough student responses to run MAMCR. This is a **research output**, not a real-time feature.

What AIPLA can do now: flag *anomalous response patterns* that the analytics chat can surface to the teacher:
- Student repeatedly returns to the same incorrect prediction despite tutor correction → possible coherent wrong relevance structure
- Student answers correctly on graphical items but incorrectly on verbal/written formulations → mode-dependent relevance structure

These are soft signals from the chat log, not structured MAMCR analysis. Label them "possible understanding gaps" in the UI, not "Module 1 structure."

---

## Teacher UI: what changes

### Session report — add DRA panel

New section between "What the group did" and the conversation log:

```
┌─────────────────────────────────────────────────────┐
│  ← 7B Physics A  /  bold-kazoo-87  /  Report        │
│  Activity: Boldkast   Session: 2026-05-25 14:12      │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Session summary                                     │
│  Duration: 22 min   Messages: 34   Sim runs: 8       │
│                                                      │
│  Concepts covered                          [?]       │
│  ┌────────────────────────────────────────────────┐  │
│  │ ✓ Angle ↔ range relationship        graphical  │  │
│  │ ✓ vx/vy independence (appresent)    verbal     │  │
│  │ △ Air resistance absence            verbal     │  │ ← partially: raised but not resolved
│  │ ✗ Speed² ↔ range scaling            —          │  │ ← not reached
│  └────────────────────────────────────────────────┘  │
│  3 of 4 concepts reached. 1 appresent concept        │
│  activated (vx/vy independence).                     │
│                                                      │
│  What the group did                                  │
│  ...                                                 │
└─────────────────────────────────────────────────────┘
```

**Tooltip on [?]:** "Concepts listed here are the disciplinary-relevant aspects (DRAs) for this activity, as defined by your physics curriculum. ✓ = activated in session, △ = raised but not resolved, ✗ = not covered."

**Appresent badge:** DRAs tagged `appresent` in the map get a small badge — these are the concepts the simulation cannot show directly, so the tutor must do the work. If an appresent DRA is `not_reached`, that is the most actionable gap.

---

### Analytics chat — richer vocabulary

The analytics chat skill system prompt gains the DRA map and per-session DRA coverage records as context. This enables a qualitatively better class-level view.

**Current analytics chat (placeholder):**
> "The most common sticking point was the independence of vx and vy (4 of 6 groups did not complete checklist step 3)."

**Post-DRA analytics chat:**
> "Across 6 sessions of Boldkast this week, 5 of 6 groups activated the angle-range relationship — mostly through the simulator (graphical mode). Only 2 of 6 activated vx/vy independence, and in both cases it emerged through conversation rather than the sim. The speed-squared scaling DRA was not reached by any group."
>
> "The pattern suggests students are engaging with what the simulator shows directly, but the appresent DRAs — the ones the sim can't make visible — are not being activated. You may want to add a prompt or worksheet question that explicitly asks students to predict what would happen if they doubled the launch speed without running the sim first."

**Example teacher queries the analytics chat can answer:**

| Query | What the chat accesses |
|-------|----------------------|
| "Which groups haven't covered vx/vy independence?" | DRA coverage records, filtered by `not_reached` |
| "What did groups do in the first 5 minutes?" | Chat log turns 0–300s per session |
| "Are students engaging with the mathematical DRAs or just the graphical ones?" | Mode tags on DRA activation events |
| "Which group made the most progress on the hardest concepts?" | DRA coverage, sorted by appresent DRA activation count |
| "What questions did students ask that the tutor couldn't answer?" | Chat log flagged turns (tutor redirect pattern) |

**Queries the chat cannot answer (be explicit):**
- "Are students actually understanding this?" — DRA activation ≠ understanding; relevance structure analysis requires more data
- "Which representation style worked best?" — need controlled variation across groups, not yet designed into activities
- "How does this class compare to last year?" — no longitudinal data yet

---

## Data model summary

### New fields (additions to existing schema)

**BigQuery: `aipla_events` table**

```sql
ALTER TABLE aipla_events ADD COLUMN mode STRING;
-- values: 'graphical' | 'verbal' | 'written' | 'schematic' | 'experimental'
```

**Firestore: `activity_configs/{activity_id}`**

```
+ dra_map: array of DRA objects (see format above)
+ dra_map_version: string (semver, for change tracking)
+ dra_map_authored_by: string (initials)
+ dra_map_updated_at: timestamp
```

**BigQuery: `aipla_session_summaries` table**

```
+ dra_coverage: JSON (per-DRA status, first_turn, modes)
+ mode_summary: JSON ({graphical: N_events, verbal: N_turns, ...})
+ appresent_dras_activated: integer
+ appresent_dras_total: integer
```

---

## Implementation order

| Step | What | Dependency | Target |
|------|------|-----------|--------|
| 1 | Author Boldkast DRA map | AR + JB input | Before 3 June |
| 2 | Add `mode` field to event schema | BigQuery migration | v1.1 |
| 3 | DRA tagging post-session job | Boldkast DRA map | v1.2 |
| 4 | DRA panel in session report UI | DRA coverage records | v1.2 |
| 5 | Analytics chat with DRA context | DRA coverage records | v1.2 |
| 6 | LED Planck + KineBot DRA maps | AR input | v1.2 |
| 7 | Relevance structure flagging (soft signals) | Chat log analysis | v1.3 / research |

---

## Open questions for AR + JB

1. **DRA map for Boldkast** — is the 4-DRA list above correct? What's missing or wrong?
2. **Appresent DRA priority** — which appresent DRA is the most important for this course's learning goals? The analytics chat should highlight gaps there first.
3. **"Not reached" threshold** — if a DRA is only touched in 1 of 10 turns, is that "activated" or "partially activated"? AR should set the threshold.
4. **Research track** — is per-activity MAMCR analysis on AIPLA response data a research goal? If yes, the response classification schema needs to be designed now (before data is collected), not retro-fitted.
