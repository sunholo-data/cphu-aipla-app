# DRA activity framework — representational competence in AIPLA activities

**Status**: Framing decision; becomes a requirement for all new activities from 1.C onwards
**Priority**: P1 for design standards; P2 for tooling (map-as-YAML in activity config is v1.1)
**Estimated**: 0.5d to embed in design conventions; 1d for YAML schema + InstructionProvider injection; ongoing AR + JB per-activity authoring effort
**Scope**: Design standard (affects all activity docs + tutor system prompts); minor backend (skill config YAML schema); minor frontend (InstructionProvider context)
**Dependencies**: [led-planck-skill.md](led-planck-skill.md) and [kinebot-migration.md](kinebot-migration.md) as the first activities to carry a DRA map; [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) for the downstream analytics use
**Pedagogical source-of-truth:** [`notes/2026-05-26-representational-competence-framework.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-05-26-representational-competence-framework.md) — the Linder et al. 2024 paper summary (DOI: 10.1103/PhysRevPhysEducRes.20.010103). JB is a co-author. Full paper at UCPH library.
**Created**: 2026-05-27
**Last Updated**: 2026-05-27

## Background

Linder, Bruun, Pohl & Priemer (2024) studied 1368 students across 12 universities to understand how physics concept mastery depends on representational competence. The key finding: students must develop fluency across a *critical constellation* of semiotic modes (verbal, mathematical, graphical, schematic, pictorial) — not any single one. A tutor that only asks about what is directly visible in a simulation is insufficient.

The paper introduces two constructs that directly shape AIPLA activity design:

**Disciplinary-Relevant Aspects (DRAs):** The conceptual features a student must discern to understand a concept. Two kinds:
- **Present** — directly visible in the representation (e.g. the ball's parabolic path in Boldkast)
- **Appresent** — not directly observable but required for meaning (e.g. that the horizontal and vertical components are genuinely independent, not just separately displayed)

**Relevance structure:** What a student perceives as the relevant aspect of a representation. Two students can look at the same graph and parse it via different relevance structures — one sees the slope, the other sees the y-intercept. The MAMCR analysis in the paper found three modules among the 1368 students, corresponding to three distinct ways of grouping items: mostly-wrong (Module 1), transitional (Module 2), mostly-correct (Module 3).

## Problem Statement

AIPLA activity design has so far been informal about this. Boldkast's tutor prompt mentions vx/vy independence but doesn't systematically list which concept aspects are present vs appresent in the simulator, which representations are being used, or what Module-1/2 relevance structures a student might exhibit.

Without a DRA map:
- Tutor prompts may inadvertently only address what is directly visible (present DRAs), leaving appresent DRAs unaddressed.
- The teacher analytics chat (1.2 BigQuery + 2.5 session-analytics-rubric) has no vocabulary to say "this group hasn't encountered the appresent DRA for momentum conservation."
- Capability evaluation (1.5) can't test whether the tutor addresses all DRAs — it has no list to test against.
- JB's research outputs (the 3-year programme behind AIPLA) need DRA maps as research artefacts, not just as design inputs.

## Design standard: every activity ships with a DRA map

From 1.C (LED Planck) onwards, every activity's in-repo design doc must include a DRA map table:

```markdown
## DRA map

| ID | Label | Present / Appresent | Modes | Tutor question pattern |
|----|-------|---------------------|-------|------------------------|
| `threshold-voltage` | LED threshold voltage marks minimum photon energy | present | graphical, verbal | "What happens to the current as you approach 2V?" |
| `photon-energy-formula` | E = hf — energy proportional to frequency | appresent | mathematical, verbal | "If a blue LED requires more voltage than red, what does that imply about the photon?" |
```

The DRA map is the **responsibility of AR + JB** (physicist + PER researcher), not M (engineer). M writes the technical execution doc; AR + JB fill in the DRA map. The engineering task is to make the DRA map structurally present and machine-readable.

## Goals

**Primary goal:** Every AIPLA activity has a DRA map (even a stub) before the tutor system prompt is finalised. The map drives: (a) which Socratic questions the tutor asks, (b) which analytics dimensions the session-analytics-rubric tracks, (c) the capability-floor eval tests for that activity.

**Success metrics:**
- LED Planck (1.C) and KineBot (1.D) each have a DRA map table in their design docs (stubs accepted for beta; AR + JB sign-off before wide rollout).
- The tutor system prompt for each activity explicitly references the appresent DRAs — there is at least one question pattern listed for each appresent entry.
- The skill config YAML schema has a `dra_map` field (v1.1 — allows the InstructionProvider to mention which DRAs remain unexplored in the session).

**Non-goals:**
- Full MAMCR analysis of AIPLA student data in v1 (that's a 2.5 / Year-2 research output).
- Building a DRA-authoring UI for teachers (v2 / Year-2 tooling).
- Enforcing DRA completeness programmatically in v1 (convention + code review is sufficient).

## DRA map format

### In design docs (markdown)

Include a `## DRA map` section in every activity design doc, following this table format:

```markdown
| ID | Label | Present / Appresent | Modes | Notes |
|----|-------|---------------------|-------|-------|
| `<kebab-case-id>` | One-line concept description | present / appresent | graphical, mathematical, verbal, schematic | Brief note on what the workbench shows/hides |
```

Mark the DRA map status:
- **Stub** — exists but AR + JB have not reviewed; not authoritative
- **Reviewed** — AR + JB have signed off; authoritative for tutor prompt design
- **Locked** — reviewed + incorporated into the tutor system prompt + eval tests

### In skill config YAML (v1.1 target)

```yaml
skill_id: led-planck-tutor
dra_map:
  concept: "Planck's constant via LED threshold voltage"
  dras:
    - id: threshold-voltage-concept
      label: "LED threshold voltage marks minimum photon energy"
      type: present          # 'present' | 'appresent'
      modes: [graphical, verbal]
      tutor_question: "What happens to the current as the voltage approaches 2V?"
    - id: photon-energy-formula
      label: "E = hf — photon energy proportional to frequency"
      type: appresent
      modes: [mathematical, verbal]
      tutor_question: "If blue needs more voltage than red, what does that imply about photon energy?"
```

The InstructionProvider uses this to inject a session-level DRA coverage summary:

```
Unexplored DRAs this session: photon-energy-formula, h-derivation.
The student has not yet shown evidence of understanding these aspects.
```

This gives the Socratic tutor additional context to steer toward unexplored appresent DRAs.

## Connection to existing activity docs

### Boldkast (0.2)

The scoping-site representational-competence note mentions: "The Boldkast sim makes vx/vy independence **present** (separate sliders, separate graphs) but the *significance* of independence (appresent DRA: they are genuinely decoupled) must be surfaced by the tutor."

Add a DRA map section to [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md) — stub until AR reviews.

### LED Planck (1.C)

The led-planck-skill-brief in the scoping site has a 5-row DRA map stub (`threshold-voltage-concept`, `photon-energy-formula`, `h-derivation`, `measurement-uncertainty`, `model-limitation`). Copy it into the design doc and mark **status: stub — pending AR + JB review**.

### KineBot (1.D)

The kinebot-migration-brief has a 5-row DRA map stub for projectile motion. Copy into the design doc. **Pending DK input** — DK knows the NCERT curriculum and student prior knowledge. The remaining 10 NCERT topics need separate DRA maps (one per activity) before wide rollout.

## Connection to session analytics (2.5)

[session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) describes the analytics lenses AIPLA will apply to BigQuery chat logs. The DRA framework provides the **physics-understanding lens**:

- The PISA 2015 CPS rubric (from the CoLA paper) covers *collaboration*.
- The DRA / representational competence framework (Linder et al. 2024) covers *physics understanding*.

Together they form the two-lens starter stack the analytics rubric recommends. The session-analytics-rubric doc should be updated to reference this framework explicitly and note:
- "Tutor hasn't yet asked a question that activates the appresent DRA for {concept}" — a DRA-coverage gap
- "This group's responses suggest a Module 1 relevance structure — they describe the graph shape but not what it implies" — a relevance-structure signal

The DRA YAML in the skill config is the machine-readable form that makes this analytics language possible.

## Ownership

| Task | Owner | Gate |
|---|---|---|
| DRA map per activity (physics content) | AR | Before tutor prompt is finalised |
| DRA map review (PER framework alignment) | JB | Before wide student rollout |
| DRA map table in design doc | M | Before design doc is marked "Planned → In flight" |
| YAML schema extension + InstructionProvider injection | M | v1.1 sprint |
| MAMCR-style analysis of pilot data | AR + JB | Post-pilot (Year-2 research output) |

## Current DRA map status

| Activity | Map status | Notes |
|---|---|---|
| Boldkast | Stub (not yet in design doc) | Add to [boldkast-mcp-app.md](../v0.1.0-jutland/boldkast-mcp-app.md) |
| LED Planck | Stub in scoping-site brief | Copy to [led-planck-skill.md](led-planck-skill.md); AR + JB review pending |
| KineBot (projectile motion) | Stub in scoping-site brief | Copy to [kinebot-migration.md](kinebot-migration.md); DK + JB review pending; 10 further topics unstubbed |
| Pendul | Not started | AR writes on artefact onboarding |
| Kredsløb | Not started | AR writes on artefact onboarding |
