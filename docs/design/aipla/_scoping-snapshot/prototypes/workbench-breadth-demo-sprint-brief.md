# Sprint brief: Workbench-breadth demo — show platform flexibility

**Status:** Build-ready sprint · **thin end-to-end probes, not polish**
**Source:** JB steer, 16 June 2026 — *demo workbench **breadth**, not the Boldkast sim* (see
`notes/2026-06-16-demo-feedback.md`, JB follow-up). Operationalises `workbench-types.md`.
**Target repo:** `sunholo-data/cphu-aipla-app`
**Companion docs:** `workbench-types.md` (the type design doc this executes), `strands.qmd` (workbench-type
expansion; breadth-over-depth posture), `june-16-feedback-sprint-brief.md` (item D — computational tool)

---

## Goal

Demonstrate that **the workbench is not just a simulator.** Ship a *range* of workbench feature types as
**thin, end-to-end, demo-ready** activities — breadth over depth — so the next demo can tour several
distinct workbench surfaces, each paired with a tutor. This is the platform-flexibility story JB asked
for, and it reinforces the [breadth-over-depth](../../strands.qmd) Year-1 posture.

**Not** about polishing Boldkast or any single sim. Each item is a minimal working probe: one activity,
one paired tutor, renders at phone + desktop widths, tutor reads the workbench state. Polish only if
time remains.

---

## The breadth set — build these four

Selected from the `workbench-types.md` **v1.1 tier** (the achievable ones) plus the new computational
tool. Four maximally distinct surfaces:

### 1. Computational tool (calculator + code execution) — NEW

Per `june-16-feedback-sprint-brief.md` item D, **scope = both** [M, 16 June]:
- **Student-facing** calculator / compute surface on the workbench;
- **AI-side** sandboxed maths/code-execution tool the tutor calls to check a student's working.

**Demo value:** the most generic surface, visibly *not* a physics sim, supports any maths topic; pairs
with any tutor. **Sandboxing** per [ADR-013](../../architecture.qmd). **Acceptance:** student computes on
the workbench; the tutor verifies a student's calculation via the AI-side tool.

### 2. Drawing board (Excalidraw / tldraw) — `workbench-types.md` Type 2

Student sketches a free-body diagram or a v–t graph; on "share" it exports SVG; the tutor reads it
(multimodal) and asks about it. **Demo value:** maximal visual contrast to a sim; ties to representational
competence and the image-on-workbench placement (16 June). **Acceptance:** student draws; tutor describes
/ questions the sketch. Use the self-hostable Excalidraw embed first (simplest per the design doc).

### 3. Lab notebook (structured fields) — `workbench-types.md` Type 5

Structured observation / hypothesis / method / results / conclusion form (fields defined in the activity
config); the tutor reads incomplete fields and prompts. Non-sim. **Demo value:** the workbench as
*structured data entry*; pairs with the LED Planck lab and the offline-lab pattern (9 June).
**Acceptance:** student fills fields; tutor prompts on the empty conclusion.

### 4. jitt.dk app embed (Pendul) — `workbench-types.md` Type 1, external

Onboard one existing Danish physics app — **Pendul** (no sensors, likely self-contained, top of the
design doc's priority list) — via the jitt.dk integration checklist. **Demo value:** shows the library
ingests existing **teacher-vetted Danish apps** cheaply (23 available at jitt.dk); breadth at low cost.
**Acceptance:** Pendul renders in a `sandbox="allow-scripts"` iframe, emits `postMessage` state, paired
tutor references its UI.

> **Stretch / not this sprint:** Experiment tool (phone sensors) and Video analysis are v1.2 in the
> design doc — sensor-permission and privacy blockers. A **quiz / chat-only** activity is a trivial fifth
> surface if one more breadth point is wanted on the day.

---

## Shared requirements (every item)

- **sim-core pattern** — sandboxed iframe core + React host panels. Scaffold the host triad with
  `new-workbench-skill.sh`.
- **Paired tutor** — each workbench ships with a tutor skill that references its specific UI (the
  paired-unit pattern; do not ship a bare workbench).
- **State → chat** — the standard `aipla:workbench` `postMessage` harness; human tool-use cards come for
  free.
- **Axiom 11 USABLE BY DESIGN** — render at phone + desktop widths before calling it done.
- **ADR-013** — new artefacts pass the content-review scan.
- **Seeded activities** — seed each as a ready activity for the demo. The teacher-facing workbench-type
  selector (Parameters tab, per `workbench-types.md`) is the productised path but is **not** required for
  this demo — pre-seeded activities are fine.

---

## Demo narrative

One activity per type, so the demo can tour the surfaces:

> "The workbench is a **sim** (Boldkast) … and a **calculator** … and a **drawing board** … and a **lab
> notebook** … and an **existing Danish physics app** (Pendul)."

— each with a tutor reading the surface. That sequence *is* the flexibility story.

---

## Sequence

Each item is independent — **parallelisable**. Thin first; polish only if time.

1. **Computational tool** — already specced (item D); most demo leverage; generic.
2. **Drawing board** — highest visual contrast; v1.1.
3. **Lab notebook** — structured; reuses the LED Planck context.
4. **jitt.dk Pendul** — cheap external onboarding; validates the artefact-onboarding runbook (N=3 → N=4).

---

## Out of scope

- Sensor-based experiment tool + video analysis (v1.2; blockers per `workbench-types.md`).
- Polishing existing sims (Boldkast / LED Planck / KineBot).
- The teacher-facing workbench-type selector UI — productised path; the demo uses seeded activities.
