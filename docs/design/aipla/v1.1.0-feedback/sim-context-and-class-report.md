# What a sim tells the tutor, the student and the report — a declared sim record, quiet state, and a report that counts

**Status:** **M1–M3 implemented (2026-10-26), unreleased**; M0 and M4–M6 open — **1.1.155**. M1 also covers the card half of [1.1.154 M2](tutor-pacing-and-reactivity.md). Every sim mounted in the generic frame was checked: each one labels its deliberate commits (run/play/reading/commit/show_value/complete), so only state syncs, pause, stop, reset and open lose their cards.

**M2** adds `ArtefactRecord` (`db/models/artefact.py`, `extra="forbid"`, with event names checked against `eventVocabulary`), `kettle-efficiency.yaml`'s `record:`, and `tutorTurnOn` in `public()`. That is the only part of the record the client sees, and the frame honours it through `mapArtefactKindForTutorTurn`, so the kettle's Run no longer takes the proactive cooldown. **M3** adds `adk/sim_ledger.py`. It is appended in the same `state_delta` as the latest-value key (`protocols/iframe_context_routes.py:_ledger_delta`) and rendered by `iframe_context._format_block`, which also drops `_label` / `_pushedAt` for every sim. Since-last-reply comes from the session's last tutor TEXT event (`iframe_context.last_tutor_reply_at`). Tests: `test_sim_ledger.py`, `test_sim_ledger_reaches_the_tutor.py` (the F3 bug, through the real route), and `test_artefact_catalogue.py`.

**Deviations from the design:**
- The "every declared key is emitted" assertion lives in `test_artefact_catalogue.py` beside the commands cross-check, not in the node `sim-build-check`. It is still CI-gated, by `test-fast`.
- The ledger's language is the **activity's**, resolved once when the ledger is created. A student's own DA | EN switch does not reach it, because `wrap_with_iframe_context` is wired in `adk/agent.py` and receives no language.
- The "Now" line shows the declared settings and the last event kind, not a running/idle status, because the record does not declare which event ends a run.
- **Measured** (4 chars ≈ 1 token, the whole block including its ~260-token framing): 1 reading 440 → 333 tokens, 3 readings 443 → 380, at the 10-reading cap 444 → 531. Content alone is ~181 → ~268 at the cap. That is over the old block by ~90 tokens at the cap, in exchange for 10 visible readings instead of 1.
**Priority:** **P1** — students on 2026-10-22 saw the Elkedel sim "flood" settings at the AI, and the teacher-facing report told the teacher less than the student had done. The report is the evidence a teacher reads after a lesson, and the research programme reads the same rows. Un-gated
**Estimated:** ~3.5–4d phased (M0 evidence ~0.25d, M runs the SQL · M1 quiet state, no fallback trust cards ~0.25d · M2 the sim declares its record in the catalogue ~0.5d · M3 a per-session sim ledger, and a compact tutor block built from it ~1d · M4 a deterministic "sim work" section in the report ~1d · M5 count sim runs that are sim runs ~0.5d · M6 release + re-measure ~0.25d)
**Scope:** Frontend: `components/workspace/GenericArtefactFrame.tsx` (`cardLabel`). Backend: `artefacts/loader.py` + the 11 `backend/artefacts/*.yaml` (one optional `record:` block), `protocols/iframe_context_routes.py` (ledger append), a new `adk/sim_ledger.py`, `adk/iframe_context.py` (render the ledger instead of raw JSON for declared sims), `observability/chat_log.py` (`event_kind` on the workbench row), `reports/session_summary.py` + `reports/narrative.py`, `analytics/queries.py` (`sim_runs_per_skill`). Artefact: `kettle-efficiency/v1/index.html` (labels only). No new authoring surface, and no schema change to activities
**Dependencies:** [1.1.41 unified-sim-rendering](unified-sim-rendering.md) (the generic frame this changes); [workbench-state-debounce](../v1.0.0-pilot/implemented/workbench-state-debounce.md) (commit-on-submit, which the kettle already follows); [proactive-sim-reactive-tutor](implemented/proactive-sim-reactive-tutor.md) (the proactive gate); [1.1.4 session-report-summary-primary](session-report-summary-primary.md) (**shipped**, the narrative this grounds); [1.1.136 review-work-beside-the-transcript](review-work-beside-the-transcript.md) (the `label`/`logLabel` split M1 relies on); [1.1.133 tutor-controls-sims](../v2.1.0-extension/tutor-controls-sims.md) (**shipped**, the `control_sim` rows M4 must attribute to the tutor); [1.1.149 tutor-directs-to-workbench](tutor-directs-to-workbench.md) (the affordances block M3 sits beside)
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md) — M, as written: *"kettle simulation has too much of a flood of settings to AI agent."* · *"the simulation class report only reported the power W but not the time used appeared?"* · *"sim parameters explored was incomplete."* ("kettle" = the **Elkedel** sim, catalogue id `kettle-efficiency`.)

## Problem Statement

Three complaints from one lesson, all about the same pipe: what the Elkedel sim
emits, and what each of its three readers (the student's chat, the tutor's prompt,
the teacher's report) makes of it. This document traces that pipe end to end from
the code. The finding is that **the tutor is not flooded. The student is, and the
tutor has the opposite problem.** The student's chat fills with raw `key=value`
cards. The tutor's prompt holds only the latest event, so earlier readings are
gone. The report asks an LLM for "parameters varied", and that question has no
place for time, because in this sim time is not a setting.

None of it is Elkedel-specific in mechanism. Elkedel is simply the sim whose
event shape triggers all three.

## Findings

Every finding below is **verified against code** on 2026-10-22 unless marked
*hypothesis*. None is verified against the lesson's data: reading prod was not
permitted when this was written, which is what M0 is for.

### F1. What Elkedel emits, and how often (not a flood at source)

The sim emits six kinds, all on a student action. Nothing is emitted per
animation frame: `tick()` only renders
(`infrastructure/mcp-sandbox/artefacts/kettle-efficiency/v1/index.html:893-916`).

| Kind | When | Carries `state`? | Carries `label`? | Line |
|---|---|---|---|---|
| `open` | page load | yes, all 8 fields | **no** | `:1042` |
| `state-change` | a slider move, committed on Run or chat-send (`flushPendingChanges`) | yes + `changed` | **no** | `:844`, `:932`, `:1064` |
| `run` | Start | yes | yes ("Tændte kedlen: 2000 W, 1,4 L") | `:937-942` |
| `stop` | Stop | yes | **no** | `:950` |
| `reading` | Capture | yes + `reading` | yes ("Registrerede aflæsning: 67,3 °C efter 95,0 s") | `:996-1002` |
| `reset` | Reset | yes | no (filtered as noise by the host) | `:972` |

`simState()` (`:828-839`) is eight fields: `power_W, volume_L, mass_kg,
temperature_C, elapsed_s, meter_kWh, boiling, readings_captured`. It does **not**
include the `readings` array, only its length.

**One measurement cycle** (change power, start, stop, capture) is therefore four
emits: `state-change`, `run`, `stop`, `reading`. Loading the sim adds `open`.

### F2. The flood is in the student's chat: a label-less emit with `state` becomes a `key=value` card

`GenericArtefactFrame.cardLabel` (`frontend/src/components/workspace/GenericArtefactFrame.tsx:84-95`)
uses `sc.label` when present. **Otherwise it builds a label from every scalar in
`sc.state`**: `power_W=2000, volume_L=1.4, mass_kg=1.4, temperature_C=20,
elapsed_s=0, meter_kWh=0, readings_captured=0` (booleans are filtered out). A
non-null label dispatches a "shared with the AI" trust card (`:239`). The fallback
is deliberate and pinned by a test (`__tests__/GenericArtefactFrame.test.tsx:223`,
*"falls back to a generic key=value label when the artefact emits none"*). It
dates from when sims had not yet adopted `label`.

So per measurement cycle, the student sees **four cards**: two labelled ones (Run,
Capture) and two seven-field dumps of raw variable names (`state-change`, `stop`).
`open` adds a third dump before the student has touched anything. That is,
literally, *"a flood of settings to the AI agent"*. It is what a teacher looking
over a student's shoulder would see.

This contradicts the sim authoring contract. The `mcp-app-artefact` skill says a
trust card renders *"only when the payload carries `label`"* and that *"unlabelled
emits are silent state"* (`.claude/skills/mcp-app-artefact/SKILL.md:53,225`). The
`_template` sim meets that contract by accident: its unlabelled emits carry no
`state` object. **10 of the 11 catalogue sims pass a `state` object in at least one
emit.** That figure comes from a line grep of each artefact, not a per-emit audit.
Any of those emits without a `label` gets a fallback card. Only `boldkast` and the
template pass no `state`.

**General, not Elkedel-specific.**

### F3. The tutor sees only the latest event, and earlier readings are gone

Every generic-frame push is written to **one** session-state key,
`mcp_app_context.kettle-efficiency.state`. `useSimSnapshotPush` defaults
`toolName = "state"` (`frontend/src/hooks/useSimSnapshotPush.ts:92`), and the route
builds `f"{namespace}.{server_id}.{tool_name}"`
(`backend/protocols/iframe_context_routes.py:296`). Each push **replaces** the
previous one. `iframe_context._format_block` pretty-prints that one value into the
prompt on every turn (`backend/adk/iframe_context.py:84-120`).

Measured with the real renderer on a `reading` payload, the block is **~1,770
chars (~440 tokens)**. The catalogue `tutorBlock` (via `teacher_focus.py:327`)
adds ~1,360 chars (~340 tokens). So the sim costs about **~0.8k tokens per turn,
constant**. That is not a flood. But:

- After Capture → `state-change` (next slider commit) → Run, the `reading` payload
  is overwritten. **The tutor can no longer see the reading the student just took**,
  and it never sees the readings list at all (F1: only `readings_captured`). The
  tutorBlock tells the tutor to probe the student's efficiency arithmetic, but the
  tutor cannot hold the numbers to check it against unless the student retypes them.
- The block also prints the internal `_label` and a raw epoch-float `_pushedAt`.
  Both are stored inside the state value (`iframe_context_routes.py:302-306`), and
  `_format_block` dumps the whole value. That is noise in every prompt.
- The block is JSON with internal names (`power_W`, `t_end_C`). The tutor then
  echoes those names back. *Hypothesis:* this is part of why the conversation
  "feels like settings".

**General:** every generic-frame sim has one latest-value key.

### F4. The report is asked for "parameters varied", and time is not a parameter in this sim

The teacher's session report is the group report at
`/teacher/reports/groups/[groupId]`. Its narrative is an LLM call (`analysis_model`)
over `build_narrative_prompt` (`backend/reports/narrative.py:68-87`). That prompt's
section is literally **"Sim parameters explored"**: *"which workbench parameters the
group actually varied. Use ONLY the parameters listed in the data below"*
(`:49-51`).

The data is one line per workbench event, `server.tool field=value` (`:72`), where
`emit_workbench_event` sets:

- `field` = `sc.changed` if present, otherwise the tool name. So `state-change`
  logs `field="power_W,volume_L"`, and **every other kettle event logs
  `field="state"`** (`iframe_context_routes.py:386`; list-join at
  `observability/chat_log.py:231-236`).
- `value` = the **entire** `structuredContent` as JSON (`iframe_context_routes.py:387`,
  `chat_log.py:226`).

Elkedel's independent variables are **power, water amount, and heating time**.
Power and water amount are sliders, so they show up in `changed`. **Time is set by
pressing Stop.** That is an action, not a setting, so no `changed` field ever names
it (`pendingChanges` is only ever written with `power_W` / `volume_L`, `:1014`,
`:1021`). The durations do exist, but only buried inside JSON blobs on lines whose
`field` is `state`. An LLM asked "which parameters did they vary" reports power. That
matches *"only reported the power W but not the time"* exactly.

Nothing tells the report which quantities matter for **this** sim. The catalogue
entry declares an `eventVocabulary` and a `tutorBlock`
(`backend/artefacts/kettle-efficiency.yaml:19-49`), but no parameters, measurements
or records. So "incomplete" is the expected output, not a model failure.
**General:** the prompt is the same for every sim.

Three more ways the same section goes wrong:

- **Defaults counted as exploration.** `open` logs the default 2000 W / 1.4 L, so a
  group that never touched a slider still has a "power 2000 W" event in its data.
- **The tutor's moves counted as the group's.** `control_sim` writes rows to the same
  table with the sim id as `server` (`backend/adk/sim_control_tools.py:326-344`).
  `NOT_STUDENT_WORK_TOOLS` excludes only `record_assessment`
  (`reports/session_summary.py:38`). A setting the **tutor** changed is narrated as
  one "the group varied". (Elkedel declares no commands, so this does not affect it
  today. It does affect sims that declare commands.)
- **The live path has no sim data at all.** When BigQuery has no turn rows yet (an
  in-flight lesson, or sink lag), `resolve_session_summary` falls back to
  `summarize_session` (`session_summary.py:172-227`). That path never fills
  `workbench_events`, so the narrative omits the section. A teacher who opens the
  report **during** the lesson gets no sim section.

### F5. "Sim runs" is wrong in both directions

- **Group report:** `sim_runs = len(workbench_events)` (`session_summary.py:325`).
  This counts **every** row: `open`, `stop`, `state-change`, `reading`, table and
  calculator commits, document page-turns (`server="documents"`,
  `iframe_context_routes.py:468-476`) and tutor `control_sim` rows. One kettle cycle
  counts as four "sim runs".
- **Class insights:** `sim_runs_per_skill` filters `jsonPayload.tool = 'sim_run'`
  (`backend/analytics/queries.py:154-156`, and the named query at `:274`). **No
  current writer emits `tool = 'sim_run'`.** The generic frame always sends
  `tool = "state"`, and the other writers send `control_sim`, `record_assessment`
  or a document kind (grep of `emit_workbench_event(` and of `useSimSnapshotPush(`
  call sites, 2026-10-22). Unless M0 finds rows from an old frame, **the class
  insights sim-run KPI reads 0 for every sim**.

### F6. The proactive cooldown is spent on the less important event

`run` maps to `sim_run` and `reading` maps to `measurement_commit`
(`frontend/src/lib/proactiveEventCheck.ts:60,68-76`). Both can fire a tutor turn,
subject to a **30 s** session cooldown (`PROACTIVE_COOLDOWN_SECONDS = 30.0`,
`backend/protocols/proactive_routes.py:86`; nearby comments still say 90 s, which
is stale).

At `TIME_SCALE = 30` (`:798`), heating 1.4 L from 20 °C to 100 °C at 2000 W takes
~272 simulated seconds, which is **~9 s real**. Run → Stop → Capture therefore
usually fits inside one cooldown. If the `run` turn fires, the `reading` turn is
suppressed. But the catalogue says `reading` is *"the moment to ask what they intend
to do with it"* (`kettle-efficiency.yaml:38-39`). The tutor speaks at the start of
the run, when there is nothing to discuss, and stays silent at the capture, when
there is.

Elkedel-specific in effect, general in mechanism. Any sim whose "run" and "commit"
fall within 30 s has the same problem. *(The pacing of tutor turns overall,
"a flood of notifications", is a sibling doc's scope. This doc only proposes the
per-sim choice of which event deserves the turn.)*

## Design

One principle: **a sim declares what its experiment is made of, and every reader
works from that declaration instead of guessing from raw JSON.**

### D1. The sim declares its record (catalogue)

An optional `record:` block in `backend/artefacts/<id>.yaml`, parsed by
`artefacts/loader.py`:

```yaml
record:
  settings:            # what the student chooses before a run
    - { key: power_W,  label: { da: "Effekt", en: "Power" },  unit: W }
    - { key: volume_L, label: { da: "Vandmængde", en: "Water" }, unit: L }
  controlled_by_action:  # chosen by WHEN the student acts, not by a control
    - { key: duration_s, label: { da: "Opvarmningstid", en: "Heating time" }, unit: s, from: reading }
  measurements:        # what a captured record holds
    event: reading
    path: reading
    fields: [power_W, mass_kg, t_start_C, t_end_C, duration_s, meter_kWh]
  run_event: run       # the kind that counts as a sim run
  tutor_turn_on: reading   # which meaningful event deserves the proactive turn (F6)
```

Every field is optional. A sim without `record:` keeps today's behaviour (raw
latest-value block, LLM-only report section). That makes the change additive
across the 11 sims, and M2 fills in Elkedel first. `sim-build-check` gains one
assertion: every declared key appears in at least one emit of the artefact.

### D2. Quiet state, loud commits (student's chat)

Remove the `state`-derived fallback in `cardLabel`. **A card renders only for an
emit carrying `label`**, as the skill already documents. An unlabelled push still
reaches the tutor and is still logged. It takes the 1.1.136 `logLabel` path, which
already exists for "not a card moment" pushes. The trust-card principle holds:
cards mark the student's deliberate shares (Run, Capture), not every state sync.
Elkedel's own copy improves with this alone: one card per Run, one per Capture.

### D3. A per-session sim ledger, rendered compactly (tutor's prompt)

On each push for a sim that declares `record:`, the iframe-context route also
appends to a bounded `mcp_app_ledger.<id>` state key, next to the latest-value key.
The latest-value key is unchanged, so nothing that reads it breaks. The ledger
keeps:

- the current settings;
- runs: `{settings, duration_s}` from the declared `run_event` and its `stop`;
- records: the declared `measurements.fields`, **last 10** (cap configurable);
- `since_last_tutor_turn`: the events after the tutor's last reply, collapsed (three
  power changes become "power 1000 → 2200 W").

`adk/sim_ledger.py` renders it as **plain localised prose using the declared
labels**, not JSON:

> Elkedel. Now: 2200 W, 1.0 L, idle. Since your last reply: changed the power
> 2000 → 2200 W, ran 6.8 s, captured reading #3. Readings so far: #1 2000 W ·
> 1.4 kg · 20.0 → 67.3 °C · 95.0 s · 0.0528 kWh; #2 …; #3 ….

For a declared sim, `iframe_context._format_block` uses this rendering in place of
the raw dump, and drops `_label` / `_pushedAt` for every sim. Budget: ≤ ~300 tokens
at the 10-reading cap, against ~440 today, and the tutor can now see every reading.
**The hidden-answer rule is untouched.** The ledger only holds fields the sim
emits, and `HIDDEN_EFF` is never emitted (`:797`).

### D4. A report section built from the ledger, not guessed (teacher's report)

`summarize_session_bq` already has every row. For a declared sim it computes a
deterministic **`SimWork`** object: values used per setting (distinct values and
range, with the defaults from `open` **marked as untouched** when no change
followed), durations from `controlled_by_action`, the records table, the run count
from `run_event`, and tutor-set values from `control_sim` rows, **attributed to the
tutor**. The report page renders it as a small table ("Sim work") above the
narrative. The narrative prompt receives the same facts as a table, and its
instruction changes from "parameters varied" to *"summarise the sim work table; do
not add values not in it"*.

The live-path fallback (`summarize_session`) builds `SimWork` from the
`mcp_app_ledger.*` keys in session state, which closes the "no sim section during
the lesson" gap from F4.

### D5. Count runs that are runs

`emit_workbench_event` gains an `event_kind` field (the push's `lastEvent`, e.g.
`kettle-efficiency.run`), read with `JSON_VALUE(TO_JSON_STRING(jsonPayload),
'$.event_kind')` (1.1.92's rule for sink fields that may be absent on old rows).
The group report counts `run_event` kinds (or `mapArtefactKindToMeaningful`'s
`sim_run` for undeclared sims) and never counts document, element, tutor or
assessment rows. `sim_runs_per_skill` stops filtering on `tool = 'sim_run'` and
filters on kind instead, with `JSON_VALUE(jsonPayload.value, '$.kind')` as the
fallback for rows written before the field existed.

## Milestones

Each milestone ships on its own.

- **M0 — evidence (~0.25d, M runs the SQL; read-only).** Run these against the
  environment the 2026-10-22 lesson used (`chat_logs` dataset):
  1. Event mix per kettle session, and how many rows would have carded:
     ```sql
     SELECT jsonPayload.session_id AS s,
            JSON_VALUE(jsonPayload.value, '$.kind') AS kind,
            COUNTIF(jsonPayload.label IS NULL) AS unlabelled, COUNT(*) AS n
     FROM `aipla-prod-2026.chat_logs.aipla_workbench_event`
     WHERE jsonPayload.server = 'kettle-efficiency' AND DATE(timestamp) = '2026-10-22'
     GROUP BY s, kind ORDER BY s, kind
     ```
  2. Has `tool = 'sim_run'` **ever** been written (F5)?
     `SELECT MIN(timestamp), MAX(timestamp), COUNT(*) FROM … aipla_workbench_event WHERE jsonPayload.tool = 'sim_run'`
  3. For one kettle session, the report's `simRunCount` against the number of
     `kettle-efficiency.run` rows from query 1.
  4. Proactive turns per kettle session, by kind: student-role rows in
     `aipla_chat_turn` with `content LIKE '[event_reactive:%'`. If the sentinel is
     not logged there, use Cloud Logging under `service_name="aipla-v01-frontend"`.
     This tests F6: how many `measurement_commit` turns fired against how many
     `reading` events.
  5. Save one group's report narrative and its "Sim parameters explored" bullets
     next to query 1's rows. That pair is the before-picture M6 re-measures against.
- **M1 — quiet state (~0.25d).** *(Shared with [1.1.154 M2](tutor-pacing-and-reactivity.md),
  which owns the card coalescing; the fallback removal ships once, here.)* Remove the `cardLabel` fallback, invert the
  `GenericArtefactFrame.test.tsx:223` test (no `label` → no card, push still sent,
  `logLabel` still set), and run `make audit-trust-cards`. Update the skill's
  table row if its wording changes.
- **M2 — declare Elkedel's record (~0.5d).** Loader + schema, `record:` for
  `kettle-efficiency`, and the `sim-build-check` assertion. Elkedel's
  `tutor_turn_on: reading` is honoured in `mapArtefactKindToMeaningful` (the
  catalogue entry reaches the frame), so `run` no longer takes the cooldown slot.
- **M3 — ledger + compact tutor block (~1d).** `adk/sim_ledger.py` (pure; unit
  tests on append, collapse, the cap, and prose in both languages), the route
  append, and `_format_block` switching for declared sims. One test drives the
  **real route** for a cycle of state-change → run → stop → reading → state-change
  and asserts that the tutor instruction still contains reading #1. That is the F3
  bug, and today it fails.
- **M4 — "Sim work" in the report (~1d).** `SimWork` on both summary paths, the
  report table, and the narrative prompt change. Tests: defaults shown as untouched;
  `control_sim` attributed to the tutor; **duration appears for Elkedel** (the
  2026-10-22 complaint, as a test); the live path has a section.
- **M5 — run counts (~0.5d).** `event_kind` on the row; both counters. One test
  seeds a kettle cycle, a document page-turn and a table commit, and asserts a run
  count of 1 on both the group report and class insights.
- **M6 — release + re-measure (~0.25d).** Seed (the catalogue is template data),
  promote, then re-run M0 queries 1, 3 and 4 against the next kettle lesson, and
  compare its report with M0.5.

**Then the other 10 sims**, ~0.25d each for a `record:` block. Order them by use
in M0 query 1 run without the `server` filter. This is not costed above.

## Open questions

- **O1. Is the "flood" the cards (F2), the tutor talking at every event (F6), or
  both?** The code says the tutor prompt is not large (F3). M should confirm what
  was actually seen. If it was the tutor's chatter, M1 alone will not answer the
  complaint.
- **O2. Is "the simulation class report" the group report** (`/teacher/reports/groups/…`,
  whose narrative has the "Sim parameters explored" section)? This doc assumes so.
  The class-level surfaces (insights, the live summary) have no parameter section,
  only the sim-run KPI from F5.
- **O3. How many readings should the tutor see?** 10 is a guess. A whole-class
  data pooling activity would want all of them, and a token budget wants fewer.
- **O4. Should "Sim work" be teacher-only, or also shown to researchers in the
  review timeline (1.1.136)?** It is derived only from rows they can already read.
- **O5. Does removing fallback cards break the student's ability to see what the
  AI knows?** The state still reaches the tutor without a card. D2 argues that the
  Run and Capture cards are the meaningful shares, but a student could still ask
  "how did it know I had 2200 W?". The alternative is one collapsed, debounced
  "settings" card per run. That costs more UI and is not proposed unless O1 says the
  cards were not the problem.
- **O6. A tutor-side "flood" outside this doc's scope:** pacing of all proactive
  turns and notifications belongs to the sibling pacing doc from the same notes.
  D1's `tutor_turn_on` is the only per-sim hook this doc adds to that system.
