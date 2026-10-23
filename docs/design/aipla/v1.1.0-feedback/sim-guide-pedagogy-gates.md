# Pedagogy gates for simulations: what a sim must declare, what a machine checks, and what a person still has to check

**Status:** **Proposed (2026-10-22)**, not started. **1.1.157**
**Priority:** **P2**. This is the preventive half of today's sim feedback. The cures for the sims we already have belong to the sibling docs. This doc makes sure the *next* sim (built-in, or published by a teacher from the Sim workshop) cannot ship with the same defects. Un-gated
**Estimated:** ~4d, phased: M0 evidence and hand survey ~0.25d · M1 catalogue declarations ~0.5d · M2 tier P static gates plus a broken fixture per gate ~1d · M3 the declarations cross-checked against the page (tier C) ~0.5d · M4 `verify_sim.mjs --drive` pacing and flood measures ~0.5d · M5 guide, prompt and pre-ship checklist, plus the cold re-test ~0.75d · M6 publish-path policy and release ~0.5d
**Scope:** Backend: `sim_gates/` (a new `pedagogy.py`, more checks in `crossfile.py`, a new line in `report.py`'s `NOT_CHECKED`), `db/models/artefact.py` (three optional fields), `tests/unit/test_sim_gates.py` (fixtures, `KNOWN_GAPS`), `sim_authoring/publish.py` (tier selection). Scripts: `.claude/skills/mcp-app-artefact/scripts/verify_sim.mjs`. Content: `.claude/skills/mcp-app-artefact/resources/{authoring-prompt,pre-ship-checklist,catalogue-entry}.md` (then `make sim-prompt`), `frontend/content/guides/r2-propose-a-simulation.md`. **No change to any existing sim's behaviour.** Retrofits are routed to the sibling docs
**Dependencies:** [sim-verify-mcp.md](../v2.1.0-extension/sim-verify-mcp.md) (**shipped**: tiers A–D, one implementation for every caller); [in-app-sim-authoring.md](../v2.1.0-extension/in-app-sim-authoring.md) (**shipped**: the teacher publish path that runs these gates); [1.1.133 tutor-controls-sims](../v2.1.0-extension/tutor-controls-sims.md) (**shipped**: `commands` on the catalogue, the precedent for declaring a sim's surface in YAML and cross-checking it against the HTML). Written in parallel today, and **not redesigned here**: [1.1.154 tutor-pacing-and-reactivity](tutor-pacing-and-reactivity.md) (stream pacing and the notification flood) · [1.1.155 sim-context-and-class-report](sim-context-and-class-report.md) (what the Elkedel sim sends the tutor; what the class report shows) · [1.1.156 tutor-points-at-the-screen](../v2.1.0-extension/tutor-points-at-the-screen.md) (the pointing mechanism). This doc only adds the **declarations and gates** those three need from a sim
**Created:** 2026-10-22
**Source:** [notes-2026-10-22.md](../../../notes-2026-10-22.md). M, as written: *"The simulations guide could have the gates for pedagogy."* The same notes supply the gates' content: *"graphs moving too fast"*, *"kettle simulation has too much of a flood of settings to AI agent"*, *"the simulation class report only reported the power W but not the time used"*, *"sim parameters explored was incomplete"*, *"everyone's first question is 'What do I do?'"*, and *"can we have a UI for the AI tutor 'to point a finger'"*.

## Problem Statement

A sim reaches students through gates that check whether it is **safe and well
formed**: size, no external fetches, the bridge, labelled events, a self-test,
the page and its YAML agreeing, the derived quantity staying hidden. Today a sim
that passed every one of them was:

- too fast to follow;
- sending the tutor more than the tutor could use;
- missing measurements from the class report;
- not telling the student what to do first.

None of these are bugs the gates missed. **The gates never asked about them.**
The current verdict says so in its own words: `NOT_CHECKED` lists *"whether a
student can tell what to do first"* (`backend/sim_gates/report.py:19`).

Each of these defects is a property of **how the sim was built**, so each one is
inherited by every activity that attaches it, and it recurs in every new sim
unless the build path asks. That makes the build path the right place to fix
them. The Sim workshop now lets teachers publish their own sims
([in-app-sim-authoring.md](../v2.1.0-extension/in-app-sim-authoring.md)), so the
build path is no longer a single reviewer who knows the history.

The aim of this doc is **not** to automate pedagogical judgement. No regex can
judge whether a sentence orients a 16-year-old. The aim is to split the job
three ways:

1. **Declarations:** what a sim must state about itself in its catalogue entry.
2. **Machine gates:** what can then be checked mechanically, and where.
3. **A checklist:** what remains a person's judgement, made explicit in the
   guide so that it is asked every time.

## Findings

Every finding below is **verified against code** on 2026-10-22 unless marked
*hypothesis*. None is verified against data from the session the notes describe.

### F1. Every existing gate is about form or safety; pedagogy appears only in prose

- `sim_gates/__init__.py:12-16`: four tiers. **A** safe and well-formed. **B**
  what the authoring prompt asks for. **C** the page and its YAML agree. **D**
  the derived quantity stays hidden.
- Tier B (`conformance.py:49-104`) checks the bridge body and guard,
  `ARTEFACT_NAME`, the `strings` object, a labelled `emit()`, a waking verb, and
  the self-test. Tier C (`crossfile.py:25-85`) checks YAML validity, the id, the
  event vocabulary and the reference block.
- Tier D is the only pedagogical gate there is. It checks a *negative*: what the
  student must not be shown. Nothing checks what the student needs in order to
  start, to follow, or to be reported on accurately.
- The authoring prompt has a `FIRST CONTACT` section
  (`authoring-prompt.md:203-215`): one orienting line, every disabled control says
  what enables it, designed empty states, a visually primary action. The prompt's
  self-check repeats it as item 12 (`:486-489`). **The model checks this item on
  its own output, and nothing else checks it afterwards.** Its `PEDAGOGY` section
  (`:364-386`) is entirely about hiding the derived value and choosing defaults.
- The pre-ship checklist's `Usability` and `Pedagogy` sections
  (`pre-ship-checklist.md:72-85`) are manual tick-boxes. They cover first contact,
  empty states, 390px, the trust card, defaults, revealing answers, and a physics
  reviewer. **They do not cover pace, the tutor's context budget, or the report.**

### F2. Nothing constrains how fast a sim runs, and two sims run at 30–40× with no speed control

- Elkedel: `const TIME_SCALE = 30; // simulated seconds per real second`
  (`artefacts/kettle-efficiency/v1/index.html:798`), applied in the
  `requestAnimationFrame` loop (`:899`). The only controls are start and stop
  (`:922-951`). There is no pause and no speed control.
- Faseovergange: `TIME_SCALE = 40` (`artefacts/phase-change/v1/index.html:816`),
  drawing a live heating curve on a canvas (`:299-301`, `:955`). It has a Pause
  button (`:290`) but no speed control.
- `verify_sim.mjs --drive` has a motion check (`:297-344`), but it checks only the
  opposite failure. It fails a sim when **nothing** moved in 1.7 s (≥0.05% of
  pixels). No gate anywhere asks whether a student can follow what moves.
- A first grep sweep across the eleven live sims (*approximate*: it matches
  identifiers, so M0 confirms by hand) found the following. Nine animate with
  `requestAnimationFrame`. Only `sol-jord-maane` has a recognisable playback-speed
  control. Two (`otto-engine`, `sol-jord-maane`) honour `prefers-reduced-motion`.
  Two (`boldkast`, `phase-change`) have a pause control.
- *Hypothesis:* "graphs moving too fast" is one of these two curves (Elkedel has
  no graph; Faseovergange does). The notes do not say which sim. M0 finds out.

### F3. A sim declares its event verbs, but not its parameters, so nothing can check what reaches the tutor or the report

- The catalogue model (`db/models/artefact.py:133-183`) declares
  `eventVocabulary`, `tutorBlock`, `commands`, `assessment` and
  `minViewportPx`. **It has no list of the sim's parameters**: which values the
  student sets, which values the apparatus reads out, or their units.
  `C.vocabulary_matches` (`crossfile.py:56-73`) can cross-check verbs only
  because verbs are declared.
- Elkedel's `simState()` (`kettle index.html:828-839`) sends eight keys,
  including `elapsed_s`. Its `state-change` emit carries only the `changed` keys,
  meaning the controls the student moved (`:841-846`). The logger joins those
  keys into the `field` column (`observability/chat_log.py:228-235`), and the
  report's narrative prompt is built from `field=value` lines
  (`reports/narrative.py:72`). It is told to *"use ONLY the parameters listed"*
  (`:49-51`).
- *Hypothesis, owned by 1.1.155:* that is why the class report showed power but
  not time. Time is a **reading**, not a control, so it is never in `changed`. If
  that holds, it is a missing declaration as much as a report bug. The report has
  no way to know that `elapsed_s` is a measured quantity it should mention.
- The model's `model_config` is `ConfigDict(populate_by_name=True)`
  (`artefact.py:185`) with pydantic's default `extra="ignore"`. **A YAML field
  the model does not know is dropped silently.** An author who adds
  `parameters:` before M1 lands, or misspells it as `paramters:`, gets a green
  `C.yaml_validates` and no effect. `ArtefactCommand` already uses
  `extra="forbid"` (`:59`). Whether `ArtefactMeta` should is open question O4.

### F4. Nothing checks how much a sim tells the tutor, which is the "flood"

- The only size limit is the 4 KB cap on each payload. `verify_sim.mjs` checks it
  (`:466-472`, `MAX_STRUCTURED_CONTENT_BYTES` at `:62`), and so does the 413 on
  the route. That cap is about transport. **A sim can stay under 4 KB on every
  push and still flood the tutor**, either by sending many waking events per
  student action, or by sending a state with many keys of which the tutor needs
  two.
- The `--drive` sweep records every event (`:435-438`) and classifies each one as
  proactive, noise or inert (`:440-449`). **It does not count events per action**,
  so "three waking events for one click" passes.
- What Elkedel actually sent in the session is for 1.1.155 to establish (its M0).
  This doc needs only the measure.

### F5. There is nothing a tutor could point at

- No sim has stable, declared targets: named regions such as "the kWh meter" or
  "the power slider" that something outside the iframe could refer to. Elements
  have ids for the sim's own code (`startBtn`, `powerSlider`, `meterScreen` in
  Elkedel). Those ids are implementation names, they are not declared anywhere,
  and they are free to change.
- 1.1.156 designs the pointing. Whatever it chooses, it will need each sim to
  **declare** its targets and the page to **carry** them. That is a declaration
  plus a tier-C cross-check of the same shape as `commands` (1.1.133:
  `test_artefact_catalogue.py` cross-checks a declared command against a
  registered `cmd-<name>` in the HTML).

### F6. The teacher publish path runs exactly tiers A–C (D when terms are given) and refuses on anything that is not ok

- `sim_authoring/publish.py:103-105`:
  `tiers = ("A", "B", "C", "D") if terms else ("A", "B", "C")`, then
  `if not report.ok:` → `NotPublishable`. `report.ok` accepts `warning`
  (`report.py:44`).
- So **a new tier that fails blocks a teacher from publishing**, and a new tier
  that only warns is shown and ignored. Which of the two each new gate should do
  on the teacher path is the main policy decision in this doc (M6, O1).
- Built-in sims are held by `test_sim_gates.py:95-103`. `KNOWN_GAPS` names each
  existing sim's known failures with a reason, so that **a new gap fails CI**.
  The new gates use the same mechanism: the eleven existing sims get named gaps,
  and the twelfth must pass.

### F7. The guide a physicist reads asks the measurement question, but none of today's ones

- `frontend/content/guides/r2-propose-a-simulation.md:48-62` asks *"What does the
  student measure, and what do they work out from it?"* That is the right first
  question. *"What happens to your draft"* (`:136-150`) lists the security, size,
  layout and phone-width gates. *"Two things we will ask you"* (`:154+`) is
  physics sign-off and reference values.
- Nothing asks the proposer about the four things in today's notes:
  - how a student would know what to do first;
  - how fast the thing should run in real time;
  - what the tutor needs to hear and when;
  - which readings a teacher would expect to see in the class report.
- A physicist is the right person to answer all four, and often the only one.

## Design

### D1. Three declarations in the catalogue entry

All three are optional in the model, so no existing YAML breaks. A new sim must
supply them, because the M2/M3 gates require them and the existing sims sit in
`KNOWN_GAPS`. Field names below are proposals. The final shape of `targets` is
1.1.156's to settle.

```yaml
parameters:              # what the student sets, and what the bench reads out
  - key: power_W         # a key of the state object the sim emits
    kind: control        # control (the student sets it) | reading (the apparatus shows it)
    label: { da: "Effekt", en: "Power" }
    unit: W
  - key: elapsed_s
    kind: reading
    label: { da: "Tid", en: "Time" }
    unit: s
pacing:
  realtime: false        # true = one simulated second per real second
  timeScale: 30          # simulated s per real s, when not realtime
  controls: [pause]      # what the student can do about it: pause | speed | step
  runSeconds: 25         # real seconds a typical run takes, start to the end state
targets:                 # (shape owned by 1.1.156) regions the tutor may point at
  - id: meter
    label: { da: "kWh-måleren", en: "the kWh meter" }
```

What each declaration buys:

- **`parameters`** gives the report a list of what to mention, controls and
  readings both (1.1.155's input). It gives the tutor's context a declared,
  bounded set of named quantities. It lets the gates check that the page actually
  emits them.
- **`pacing`** turns "too fast" from a feeling into a number that can be read in
  review. It lets the gates require a means of control whenever the sim is not
  real time.
- **`targets`** is the contract 1.1.156 needs.

### D2. The gates: which ones are machine-checked, and where

| Gate | Checks | Where | Machine? |
|---|---|---|---|
| **P.orientation** | a `strings` key named `orient` exists in both locales, is ≤160 characters, and is bound by a `data-t="orient"` element visible before any interaction | `sim_gates/pedagogy.py` (new tier **P**, static) | **Yes, for presence only.** Whether it orients is the checklist |
| **P.pace_control** | if the page runs a `requestAnimationFrame` or `setInterval` loop, `pacing` is declared, and either `realtime: true` or `controls` contains at least `pause`; the page has the declared controls (a `pause` / `speed` key in `strings`, bound in markup) | tier P (static) plus tier C (declaration ↔ page) | **Yes** |
| **P.reduced_motion** | an animating page has a `prefers-reduced-motion` branch | tier P | **Warning only.** Accessibility, not a blocker |
| **C.parameters_declared** | every `parameters[].key` appears as a key of the emitted `state` object; every `kind: control` maps to a control element; there are no duplicates | `crossfile.py` | **Yes** (static; `--drive` confirms with real payloads) |
| **C.targets_declared** | every declared target id is carried by the page in the attribute 1.1.156 chooses, and no carried target is undeclared | `crossfile.py` | **Yes**, once 1.1.156 fixes the attribute |
| **drive.waking_per_action** | in the `--drive` sweep, each driven click produces **at most one** waking (proactive) event and at most one labelled event | `verify_sim.mjs` | **Yes** (runtime) |
| **drive.state_keys** | the emitted `state` has at most ~12 top-level keys and contains every declared parameter | `verify_sim.mjs` | **Yes.** Warning above the budget, fail on a missing declared key |
| **drive.run_duration** | from the start control to the declared end state, the real time is within ±50% of `pacing.runSeconds` | `verify_sim.mjs` | **Yes**, a check of honesty: it catches a declaration that lies |
| **Pace is followable** | a 16-year-old can read the curve or the clock while it moves | pre-ship checklist plus the guide | **No.** A person drives it at 700px |
| **Orientation orients** | the `orient` line says what the apparatus is for; the first action is obvious | checklist | **No** (the existing `Usability` item, now with a gate in front of it) |
| **The report reads true** | after a driven session, the class report names the declared readings, including time | checklist (the `make verify-chat-logs` end-to-end half) | **No**, until 1.1.155 ships; then possibly yes |
| **What the tutor gets is what it needs** | the `tutorBlock` says which parameters matter, and when | checklist | **No** |
| **Physics is right** | unchanged | checklist (ADR-013 sign-off) | **No** |

Rules carried over from the existing gates, deliberately:

- A gate that could not read its subject is `skipped`, never `pass`
  (`report.py:3-6`). A sim without `pacing` that animates is a **fail**, not a
  skip: the absence is the defect.
- **Each new gate gets a broken fixture that fails exactly that gate**
  (`test_sim_gates.py:6-10`). A regex that matches nothing is how
  `audit_artefact.sh`'s gate 1 passed for its whole life.
- `NOT_CHECKED` changes from *"whether a student can tell what to do first"* to
  *"whether the orienting line actually orients, and whether the pace can be
  followed"*. The gate checks presence, and the report must not imply more.

**Usability first (Axiom 11).** These gates exist to put the first-contact
design *before* the build. That is why the declarations go in the brief (D3) as
well as the YAML: `runSeconds` and the orienting line are decided when the sim is
proposed, not discovered at review.

### D3. The guide, the prompt and the checklist ask the same four questions

- **`r2-propose-a-simulation.md`** gets a section, *"Four more things to decide
  before it is built"*, placed after *"The one question worth getting right"*:
  1. **What does a student do first?** Write the one orienting line.
  2. **How long should a run take in real time?** Is the student watching a curve
     or reading a clock, and do they need to pause it?
  3. **What should the tutor hear, and when?** Which one action is the moment
     worth speaking at? Name the readings that matter, not every value on screen.
  4. **What should the teacher see in the class report?** Which readings, with
     units.

  Each question maps onto one declaration, so the proposer's answers *are* the
  YAML. The guide has no `.da.md` twin today. Adding the section does not create
  one, but O5 asks whether this edit is the moment.
- **The authoring prompt** gets the declarations in its YAML template, and three
  new self-check items (15 to 17: orientation key, pacing declared with controls,
  parameters declared and emitted). Then `make sim-prompt` regenerates
  `/project/build-a-simulation`. **The prompt's own rule applies: re-run the cold
  test after editing it, and ask the agent what it had to guess**
  (`authoring-prompt.md` §Validation). The prompt changes only in M5, and only
  together with the re-test.
- **`pre-ship-checklist.md`** gets a `Pace and context` section. Its rows are the
  "No" rows of D2.

### D4. Built-in sims fail CI on a new gap; teacher sims are a policy choice

- **Built-in:** the eleven existing sims enter `KNOWN_GAPS` with their P and C
  failures, each with a reason. That makes the size of the retrofit backlog
  visible. **The retrofits themselves are not this doc's work.** Elkedel and
  Faseovergange go to 1.1.155 / 1.1.154. The rest come off `KNOWN_GAPS` one by
  one as their sims are next touched.
- **Teacher (Sim workshop):** `publish.py` selects which tiers block. The
  proposal: **P runs, with its failures downgraded to warnings for the first
  release.** The teacher sees them in the verify verdict, and the sim-author agent
  reads them and is asked to fix them. **The new C gates (parameters, targets)
  block** as soon as a declaration exists, because a declaration that lies is
  worse than none. After one release of measuring how often P fires on real
  teacher drafts, decide whether P blocks. That decision is O1.

## Milestones

Each one can ship on its own.

- **M0, evidence (~0.25d, M runs anything that needs prod).** Which sim had the
  fast graph? Which session and class does the report complaint refer to? Hand-
  confirm the F2 survey per sim: animates? pause? speed? reduced motion? orienting
  line? Record the results as the first draft of the `KNOWN_GAPS` reasons. No
  prod reads are needed for the survey itself.
- **M1, declarations (~0.5d).** `ArtefactParameter`, `ArtefactPacing` and a
  placeholder `ArtefactTarget` go on `ArtefactMeta`, each `extra="forbid"`. The
  public view exposes `parameters` labels and `pacing`, so a teacher choosing a
  sim sees how fast it runs. `catalogue-entry.md` documents them. Add the
  declarations to Elkedel's YAML only, as the worked example. They are honest
  values, and they do not change its behaviour.
- **M2, tier P (~1d).** `sim_gates/pedagogy.py` with `P.orientation`,
  `P.pace_control` and `P.reduced_motion`, plus a broken fixture per gate.
  `TIERS` becomes `("A","B","C","D","P")`. `KNOWN_GAPS` is extended for the
  eleven sims. `audit_artefact.sh` picks P up through `python -m sim_gates` with
  no change of its own.
- **M3, cross-file (~0.5d).** `C.parameters_declared`; `C.targets_declared`
  behind 1.1.156's attribute, skipped with a clear reason until that lands. One
  fixture each.
- **M4, `--drive` (~0.5d).** `waking_per_action`, `state_keys`, `run_duration`.
  The output gains a per-action table, so the "flood" can be read off directly.
- **M5, words (~0.75d).** The guide section, the prompt's YAML template and its
  self-check items 15 to 17, `make sim-prompt`, the pre-ship checklist, then
  **the cold re-test** with one fresh brief. Record what the agent guessed in
  the prompt's §Validation.
- **M6, policy and release (~0.5d).** `publish.py` tier policy per D4, the
  `NOT_CHECKED` wording, and a `make sim-screenshots` / `make smoke-sim` pass so
  that nothing live regressed. Then the release through the normal
  `v*` tag → `make promote`.

## Non-goals

- **Fixing Elkedel's flood or report, or Faseovergange's speed.** Owned by
  1.1.155 and 1.1.154. This doc gives them the declarations and a gate that keeps
  the fix fixed.
- **The pointing mechanism.** Owned by 1.1.156.
- **Judging pedagogy automatically.** No model-graded "is this orienting line
  good". A gate that pretends to judge is worse than a checklist that admits it
  cannot.
- **Activity-level scaffolding** (the lesson introduction, "what do I do" at the
  *activity* level). This doc covers only the sim's own first state. The activity
  opening is a separate item in the 10-22 notes.

## Open questions

- **O1.** On the teacher publish path, should tier P **block** a publish, **warn**
  for one release first (the proposal), or warn permanently? Blocking protects
  students. It also refuses a teacher's sim over a heuristic, and the teacher has
  no reviewer to appeal to.
- **O2.** Is a **pause** enough for any non-real-time sim, or must a sim above
  some speed (say 10×) also offer a **speed** control? And is `runSeconds` a
  number the guide should recommend (for example "a run a student watches should
  take 20–60 s"), or something only a physics reviewer sets case by case?
- **O3.** The state-key budget (~12) and "one waking event per action" are guesses
  from Elkedel's shape. Should 1.1.155's M0 data set them instead? If so, M4 waits
  for it.
- **O4.** Should `ArtefactMeta` become `extra="forbid"`? That would turn a
  misspelt field into a load failure. It is the right default, but it also means
  any unknown key in the eleven live YAMLs (and in published teacher sims, stored
  in Firestore) must be found and removed first.
- **O5.** The R2 guide has no Danish twin. Should this edit be the moment it gets
  one, given that the proposers are Danish physics staff?
