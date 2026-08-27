# Teacher artefact parameters — bounded knobs without code

**Status:** Roadmap signal — **not committed to build**. Stub for feedback collection from M / JB / AR.
**Target:** v1.1 (post-pilot iteration), tentatively 2026-09-15 onward. *(Revised 2026-08-27: "end of contract" was 2026-09-15 when this was written; the engagement now runs to at least April 2027 at 2.5 days/week, so this is in-window rather than a Year-2 carry-over.)*
**Audience:** AIPLA contract leadership + the 2026-08-14 pilot teacher cohort.
**Scope question:** *"Can teachers tune Boldkast / LED Planck / future artefacts without us writing new code each time?"*
**Created:** 2026-05-25
**Last Updated:** 2026-05-25

## Why this exists as a doc, not as code

The 2026-05-25 conversation (M ↔ Voightkampff) crystallised a contract-level concern: AIPLA's research thesis is *"a platform teachers run, not an end-user app."* If every parameter tweak (angle range, vector display, language) requires a developer commit, AIPLA becomes a bottleneck instead of a platform. The pilot has 10 teachers × 5 lessons × N iterations ahead of it — that's a substantial drag at the dev throughput we have.

This doc captures the **mid-tier** of teacher control: above the free-text teaching goal (v1, shipped), below code-level editing (v2 / Year-2, [teacher-artefact-authoring.md](teacher-artefact-authoring.md)).

## What "parameters" means concretely

Each first-party artefact (Boldkast, LED Planck, future sims) declares a **parameter schema** — a JSON manifest of bounded knobs the teacher can tune. The host (AIPLA frontend) renders a form from the schema; the artefact reads the chosen values via the existing MCP App context channel.

Example schema for Boldkast (illustrative — not committed):

```json
{
  "artefactId": "boldkast",
  "version": "v1",
  "parameters": [
    {
      "id": "angleRange",
      "label": "Initial angle range",
      "type": "number-range",
      "min": 0, "max": 90, "unit": "deg",
      "default": [20, 75]
    },
    {
      "id": "showVelocityVectors",
      "label": "Show velocity vectors during flight",
      "type": "boolean",
      "default": true
    },
    {
      "id": "labelsLanguage",
      "label": "Artefact labels language",
      "type": "enum",
      "options": ["da", "en"],
      "default": "da"
    }
  ]
}
```

The teacher's UI lives at `/teacher/activities/[id]` under the "Parameters" tab (today: a wireframe; v1.1: live). The values get persisted as a new `ActivityConfig.parameters: dict[str, Any]` field — same Firestore doc the teaching-goal lives in.

The artefact reads them via the same `mcp_app_context.*` channel the iframe-context route already supports, plus an `aipla:parameters` artefact contract similar to the `aipla:restore` contract that ships with 1.F.

## Why this is **not v1.0.0-pilot**

The pilot ships 2026-08-14. Three blockers:

1. **Schema authoring** — every first-party artefact needs its parameter schema designed. That's pedagogical work (which knobs make sense?), not engineering. JB + AR own that input.
2. **Backend storage** — `ActivityConfig.parameters` is straightforward but needs the existing CRUD extended + the `teacher_focus` injection path generalised to a parameter-binding step.
3. **Validation** — server-side schema validation, default-clamping, drift handling when an artefact version bumps and the saved parameters don't match the new schema.

None of these are hard individually; together they're ~3-4 days that v1.0.0-pilot doesn't have. v1.1 is the right home.

## Open questions (for the feedback loop)

These are the questions I'd want answers to before committing this to a build:

1. **Per-class vs per-teacher scope.** If a teacher tunes Boldkast for their 7B class, does 8B inherit it? Or does the teacher tune per `(class, activity)` pair as Phase 2's `ActivityConfig` does today? Per-class is more flexible; per-teacher is one fewer concept.
2. **Discoverability.** How does a teacher know what knobs exist on a given artefact? The schema itself is the source of truth, but does the UI surface *why* each parameter exists (helper text)? Who writes that helper text — JB, the artefact author, or the teacher's onboarding doc?
3. **Pedagogical drift control.** If teacher A sets angle range to 30°–60° and teacher B sets 0°–90°, their cohorts have measurably different experiences. Research design needs to capture this. Do we lock parameters for research-cohort sessions? Do we make the chosen parameters part of the session report?
4. **Reset / inheritance.** Should there be a "reset to defaults" button? Should "defaults" be artefact-author defaults, school-wide defaults, or class-level defaults?
5. **Validation framing.** When a teacher picks an angle range that crosses the line into "this isn't physically meaningful any more" (e.g. negative angles), is that a hard reject, a warning, or a teachable moment?
6. **Which artefacts get this first?** Boldkast is the obvious candidate. LED Planck has a richer parameter space (which LEDs, which voltage range, accuracy notes vs `H_TRUE` — see scoping site brief). KineBot is migrated AI content — does the teacher even have parameters there or is the AI the parameter?

## Pros

- **Bounded blast radius.** Teachers can't break the artefact — only choose between schema-validated values.
- **Server-side enforceable.** Size, type, range — all checkable before the artefact loads.
- **Schema doubles as documentation.** Each parameter has a label and helper text; the schema *is* the spec.
- **Versioning is mechanical.** Schema version bumps → migrate saved parameters → fall back to defaults for new fields.
- **Reusable across artefacts.** Same form-from-schema renderer handles Boldkast and LED Planck and Pendulum and whatever ships next.
- **Aligns with the research-thesis.** Teachers iterate on what they teach; AIPLA team doesn't bottleneck.

## Cons

- **Adds a concept (the schema)** that has to be maintained alongside artefact code. If they drift, the form lies.
- **Schema design is real work.** Each artefact needs ~30-60 minutes of pedagogical thought to decide *which* knobs make sense. Multiplied across the v1 artefact set, that's a day of JB+AR time.
- **Cohort comparability suffers** if every teacher tunes differently. Research design has to account for it (see open question #3).
- **"Parameters" sounds like "settings"** — risk that teachers ignore the teaching goal and just twiddle knobs, missing the actual pedagogical lever.
- **Doesn't solve the "fix a bug in Boldkast" problem.** That's what [teacher-artefact-authoring.md](teacher-artefact-authoring.md) (v2 / Year-2) covers. Parameters and code editing are *complementary*, not alternatives — Year-2 ships both.

## Decision criteria — when would we commit?

Build this if **any two of three** are true after the 2026-08-14 pilot starts:

1. **Pilot feedback shows teachers want it.** Specifically: teachers asking *"can I change X"* about a knob that's plausibly schema-shaped (not a code-level fix).
2. **The teaching-goal lever isn't sufficient.** Sessions where teaching goal is well-set but the artefact still doesn't fit the lesson — those imply parameter-shaped configurability is the gap.
3. **AIPLA team capacity allows.** *(Was "before 2026-09-15 handover"; revised 2026-08-27 — capacity is now 2.5 days/week to at least April 2027, so the constraint is competing priorities, not a cliff.)* If the pilot consumes the team, v1.1 slides.

Skip this if **either**:
- **Code-level editing wins outright** as the path forward (v2 jumps to T3 directly; parameters become a special case of code editing).
- **Pilot reveals a different bottleneck.** E.g. teachers want session-summary tooling more than artefact knobs.

## Out of scope (for this doc; covered elsewhere)

- Teacher edits artefact source code → [teacher-artefact-authoring.md](teacher-artefact-authoring.md) (v2)
- Student-as-creator (Strand B) → covered in the scoping site + Phase 2 of the top-level SEQUENCE
- Per-class budget gates on parameter writes → handled by the existing budget infrastructure, not this doc

## Related

- [v1.0.0-pilot/implemented/teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — Phase 2's `ActivityConfig` is the parent surface
- [teacher-artefact-authoring.md](teacher-artefact-authoring.md) — the v2 / Year-2 follow-up
- [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the authoring runbook for first-party artefacts
- ADR-013 (artefact security gates) in the scoping site
- Mockup: `/teacher/activities/[id]` → "Parameters" tab in [activity config page](../../../../frontend/src/app/teacher/activities/%5Bid%5D/page.tsx) — wireframe today, schema-backed in v1.1
