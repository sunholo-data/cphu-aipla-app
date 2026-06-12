# Lesson-author transparency — resolved-prompt preview + trial session

**Status:** Planned (P1)
**Last Updated:** 2026-06-12
**Priority:** P1 — closes the "I can't see what the AI will do" gap teachers flagged, and gives teachers a real way to test a lesson before students see it
**Estimated:** ~1.5–2d (0.75d backend prompt-assembler + resolved-prompt endpoint, 0.5d trial-session endpoint + analytics exclusion, 0.5d frontend preview + trial button, 0.25d CLI)
**Scope:** Fullstack — extends [1.G `/teacher/activities/[id]`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx) with a read-only resolved-prompt preview + a "Try this lesson" trial session; backend prompt-assembly contract + `is_trial` analytics exclusion; CLI `activity inspect`

> ## ⚠ Re-scoped 2026-06-12 — narrowed from four capabilities to two
>
> This doc was drafted **2026-06-05**, before the 9-June teacher check-in batch.
> Three of its original four capabilities have since been **built or designed under
> their own canonical rows**, so they are removed here and cross-referenced rather
> than duplicated:
>
> | Original capability | Now lives in |
> |---|---|
> | **Bounded knobs** (verbosity / language / Socratic depth / hint depth) | **[1.1.20 tutor-personas](tutor-personas.md)** `interaction_style` (SHIPPED) — socratic / concise / rigorous / warm; finer-grained per-knob tuning is the post-pilot **[2.3 teacher-artefact-parameters](../post-pilot/teacher-artefact-parameters.md)** renderer |
> | **Teacher curriculum upload** (paperclip → AILANG Parse → inline injection) | **[1.1.25 curriculum-library](curriculum-library.md)** (SHIPPED M1–M5) — Vertex RAG corpus + AILANG-Parse ingest + cited-materials grounding + builder Materials picker |
> | **`concept-dialogue` chat-only skill template** (absorbed parent SEQUENCE 1.9) | **[1.1.19 teacher-activity-authoring](teacher-activity-authoring.md)** — the `none`/chat-only workbench activity type, with the Socratic preset from 1.1.20 |
>
> **What remains net-new and uncovered — the entirety of this row:**
> 1. **Resolved-prompt preview** — a read-only, source-attributed view of the
>    system prompt that will actually run when a student joins.
> 2. **Trial session** — "Try this lesson": a teacher-as-student session marked
>    `is_trial` and excluded from class analytics + research aggregation.
>
> The preview is *more* valuable now than at first draft: there are now more
> hidden prompt contributors to surface — **persona** ([1.1.12](tutor-personas.md)),
> **interaction_style** ([1.1.20](tutor-personas.md)), and **cited curriculum
> materials** ([1.1.25](curriculum-library.md)) — none of which a teacher can
> currently see. The preview is the one screen that makes all of them legible.

**Dependencies:**
- [1.G teacher-ui](../v1.0.0-pilot/implemented/teacher-ui.md) shipped — `/teacher/activities/[id]` exists; consolidated onto primitives by [1.1.26](teacher-ui-consolidation.md)
- [1.1.20 tutor-personas](tutor-personas.md) shipped — `interaction_style` is a prompt source the preview must attribute
- [1.1.25 curriculum-library](curriculum-library.md) shipped — cited materials are a prompt source the preview must attribute
- [1.1.12 personas](tutor-personas.md) shipped — persona resolution (avatar/name/voice/style) is a prompt source the preview must attribute
- **JB sign-off** on what the prompt-preview reveals (M's reading: must stay defensible on the "teachers don't write prompts" axiom — read-only display, never editing)
**Cross-link:** [Product Axioms](../../../product-axioms.md) — strong EARNED TRUST touchpoint

## Relationship to existing items

| Existing item | Relationship |
|---|---|
| **[1.G teacher-ui](../v1.0.0-pilot/implemented/teacher-ui.md)** shipped — chose "teaching-goal-as-input, not system-prompt-as-input" with **EARNED TRUST +1** | **Honoured, not overridden.** This design preserves the no-prompt-engineering boundary: the prompt is **read-only**. The visibility gap closes via display, not editing. |
| **[1.1.20 tutor-personas](tutor-personas.md)** — `interaction_style` presets | **Consumed.** The preview renders the interaction_style modifier as a `style` source badge — a teacher who picked "rigorous" sees exactly what that injected. |
| **[1.1.25 curriculum-library](curriculum-library.md)** — cited materials grounding | **Consumed.** Cited materials appear in the preview as a `curriculum` source badge so teachers see what grounding their lesson carries. |
| **[1.1.19 teacher-activity-authoring](teacher-activity-authoring.md)** — non-sim/chat activity types | **Sibling.** 1.1.19 builds the chat-only activity (absorbing parent 1.9); this row adds the transparency + trial layer on top of any activity type, sim or chat. |
| **[2.3 teacher-artefact-parameters](../post-pilot/teacher-artefact-parameters.md)** (post-pilot) | **Future.** If/when per-knob bounded parameters land, each parameter becomes another attributed source in this same preview. The preview is forward-compatible. |

## Problem

Teachers configure an activity by typing a free-text *teaching goal*, picking a
persona, and (now) an interaction style and cited materials. All of that gets
composed into a system prompt the teacher **cannot see**. Two concrete gaps
remain after the 9-June batch:

1. **No visibility into what the lesson will actually do.** The teaching goal,
   persona, interaction_style, and cited materials all feed a system prompt that
   is invisible to the teacher. With persona + style + curriculum now
   contributing, the "what will the AI actually do?" gap is *wider* than at first
   draft, not narrower. Without seeing the resolved prompt, iteration is *guess →
   wait for a student session → read the transcript → guess again* — a multi-hour
   loop.
2. **No way to try the lesson.** Teachers can't run a session as themselves to
   validate behaviour before deploying to students. The first "real run" is also
   the first student exposure — raising the cost of iteration and discouraging
   tuning.

The user (2026-06-05) framed it: *"more control and knowledge of what the
lessons will do, such as system prompts"* — clarified as *"I don't mean they
directly create a system prompt, but the ability to at least see it"*, plus a way
to *try the lesson out*.

## Goals

**Primary goal:** A teacher can open any lesson, see exactly what the system
prompt will be when a student joins — with each segment attributed to its source
(skill template / teaching goal / persona / interaction_style / curriculum) — and
run a private trial session to test the behaviour, all without writing prompt
engineering and without polluting class analytics.

**Success metrics:**
- Teacher iteration loop (edit → trial → re-edit) shrinks from "hours" (wait for
  a student session) to "minutes" (trial session is real-time)
- ≥3 of 10 pilot teachers run at least one trial session before exposing a lesson
  to students
- Pilot teachers can correctly describe what their lesson will do (week-13
  baseline vs week-17), measured via a 1-question exit survey on the screen

**Non-goals (explicitly deferred):**
- **Raw prompt editing** — teachers see the resolved prompt; they never edit its
  template. Tuning happens through the bounded controls that already exist
  (persona, interaction_style — [1.1.20](tutor-personas.md)) and post-pilot
  [2.3](../post-pilot/teacher-artefact-parameters.md).
- **Per-knob bounded parameters** — that renderer is 2.3 post-pilot; this row
  surfaces whatever sources exist today.
- **Curriculum upload** — owned by [1.1.25](curriculum-library.md); this row only
  *displays* cited materials as a prompt source.
- **Mixing trial-session and student-session data in analytics** — trial sessions
  are explicitly excluded from class analytics, teacher reports, and BigQuery
  research aggregation. They exist for teacher iteration only.
- **Knob/style editing during a student session** — fixed at session-start;
  changes take effect for new sessions only (the agent loop relies on an
  immutable per-session system prompt).

## Axiom alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net score must be ≥ +4. Max 2 conflicts (-1) allowed.

| # | Axiom | Score | Notes |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | Trial session uses the same agent loop / streaming a student session does — same TTFT. Preview fetch is read-only, debounced; no latency-path change. |
| 2 | EARNED TRUST | **+1** | Closes the visibility gap the 1.G note flagged ("teachers don't know what the AI will do") while preserving "teachers don't write prompts." Read-only, source-attributed prompt = teachers see and understand without engineering. The gap is *wider* post-9-June (persona + style + curriculum all hidden), so this win is larger than at first draft. |
| 3 | SKILLS, NOT FEATURES | 0 | No new skill (the chat-only skill moved to [1.1.19](teacher-activity-authoring.md)); this is a cross-skill transparency surface that works for any activity type. Neutral. |
| 5 | GRACEFUL DEGRADATION | **+1** | Preview degrades to "preview unavailable" if the resolver errors — never blocks save. Trial session degrades to a normal-but-flagged session if `is_trial` isn't honoured downstream — worst case an extra row clearly marked. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Prompt assembly reuses the existing ADK skill-template + session-start composition; the preview is just an HTTP endpoint returning the assembled string. No new format or protocol. |
| 7 | API FIRST | **+1** | `GET /api/activities/{id}/resolved-prompt` returns the exact string the runtime uses; the frontend renders what the API returns; CLI `aiplatform activity inspect --resolved-prompt` is a thin wrapper over the same endpoint. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Trial sessions are *deliberately* excluded from class analytics + research aggregation (`is_trial=true` at OTel attribute time) — intentional, not a gap. They still emit traces in the trusted-zone observability surface; they just don't aggregate into pilot data. Neutral. |
| 9 | SECURE BY CONSTRUCTION | **+1** | The preview is render-only — there is no write path from the preview to the prompt. The only way values reach the system prompt remains the existing bounded controls (persona/style) + cited materials, each schema-validated on save. The preview cannot be used to inject content. |
| 10 | THIN CLIENT, FAT PROTOCOL | **+1** | All composition logic stays on the backend: prompt assembly, source attribution, trial-session marker. The frontend is a preview pane + a button; it does not assemble the prompt client-side. |
| | **Net Score** | **+6** | Threshold ≥ +4 ✅; zero conflicts ✅; EARNED TRUST +1 ✅ (hard-fail rule passed — user-facing data); SECURE BY CONSTRUCTION +1 ✅ (hard-fail rule passed — new teacher-author data-access pattern, render-only); USABLE BY DESIGN bypassed (teacher-facing only; the iteration loop IS the UX). |

**Conflict justifications:** none required (zero -1 scores).

## Design

### Overview

[`/teacher/activities/[id]`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx) (already exists, consolidated by [1.1.26](teacher-ui-consolidation.md)) gains two affordances:

1. **Resolved system prompt** (read-only, annotated by source)
2. **Try this lesson** (button that opens a trial session)

Both read the same `ActivityConfig` (+ resolved persona/style/materials) the
runtime uses. The runtime composes the system prompt at session-start; the
preview renders the same composition via `GET /api/activities/{id}/resolved-prompt`.

```
              ┌──────────────────────────────────────────────────────┐
              │  /teacher/activities/[id]                            │
              │  (existing config controls: goal, persona,           │
              │   interaction_style, cited materials)                │
              │                                                      │
              │  ┌────────────────────────────────────────────────┐ │
              │  │ Resolved prompt (read-only)                     │ │
              │  │  You are a Socratic tutor…   ◐ skill           │ │
              │  │  for {teaching goal}          ▲ goal           │ │
              │  │  Be rigorous and precise…     ◆ style (1.1.20) │ │
              │  │  Speak as Astrid…             ☻ persona(1.1.12)│ │
              │  │  Grounding: newton.pdf §3     ■ curriculum     │ │
              │  │                                  (1.1.25)       │ │
              │  └────────────────────────────────────────────────┘ │
              │  [ Try this lesson ]  → trial session (is_trial)    │
              └──────────────────────────────────────────────────────┘
```

### Prompt assembly contract

The runtime assembles the system prompt at session-start by concatenating its
sources in a fixed order. The **same** assembler drives the preview endpoint, so
what teachers see is what the agent gets.

```
SystemPrompt =
    SkillTemplate                       (1) backend/skills/templates/<name>/SKILL.md
  + InteractionStyleModifier            (2) from 1.1.20 interaction_style
  + PersonaModifier                     (3) from 1.1.12 resolved persona
  + TeachingGoal                        (4) from 1.G free-text input
  + CitedCurriculum                     (5) from 1.1.25 cited-materials grounding
```

Each source contributes a labelled segment; the preview tags each with a badge
(◐ skill / ◆ style / ☻ persona / ▲ goal / ■ curriculum) so teachers can see
exactly which control produced which part of the prompt.

> **Note on existing code:** session-start composition already exists across the
> agent chain (interaction_style override injection from 1.1.20, persona
> resolution from 1.1.12, curriculum grounding hook from 1.1.25). This row's
> backend work is to **factor that into a single `assemble_prompt()` with a
> provenance map** and call it from both the runtime and the new endpoint — not to
> re-implement composition. Verify the existing call sites before refactoring
> (per repo guidance: trust committed working code over comments).

### Backend changes

#### Prompt assembler (refactor existing composition into one path)

New module `backend/skills/prompt_assembler.py`:

```python
class AssembledPrompt(BaseModel):
    """The resolved system prompt + provenance map."""
    text: str
    sources: list[PromptSegment]  # for the annotated preview

class PromptSegment(BaseModel):
    source: Literal["skill", "style", "persona", "goal", "curriculum"]
    label: str          # human-readable, e.g. "Style: rigorous (interaction_style)"
    text: str
    line_start: int
    line_end: int

def assemble_prompt(activity_config, resolved_persona, cited_materials, skill_template) -> AssembledPrompt:
    ...
```

Used by **both**:
- the agent loop at session-start (existing composition call sites converge here)
- `GET /api/activities/{id}/resolved-prompt`
- CLI `aiplatform activity inspect --resolved-prompt`

This is the single source of truth for prompt assembly. Tests verify all call
sites get byte-identical output for the same inputs.

#### Resolved-prompt endpoint

```
GET /api/activities/{id}/resolved-prompt
  Auth: teacher must own the activity's class (existing 1.A guard)
  Response: AssembledPrompt (text + sources for annotated preview)
```

Read-only, stateless. The frontend re-fetches on config change, debounced to 300ms.

#### Trial session

```
POST /api/activities/{id}/trial-session
  Auth: teacher owns the activity's class
  Effect:
    1. Mint a session with the teacher's UID as the "student" identity
    2. Set session.metadata.is_trial = true
    3. Set session.metadata.trial_teacher_uid = <teacher uid>
    4. Return the session join URL — teacher navigates as if they were a student
```

Analytics exclusion happens at the OTel span-attribute level:
`tutor.session.is_trial = true` becomes a partition key in the BigQuery sink and
the [analytics-chat skill](../v1.0.0-pilot/implemented/analytics-chat-tools.md)
gets a `WHERE is_trial = false` default filter. The
[session-report endpoint](../v1.0.0-pilot/implemented/teacher-insights-dashboard.md)
filters by `class_id`; trial sessions are class-attached but reported under a
separate "Your trial sessions" view, never aggregated with student sessions.

**Identity:** the teacher's Firebase UID flows through as the session's user
identity (not a group code). The session is fully real — same agent loop, same
model, same observability — it just carries a flag that excludes it from
class-aggregation. No "preview mode," no synthetic responses, no fake students.

### Frontend changes

**Modified component:** [`frontend/src/app/teacher/activities/[id]/page.tsx`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx) — adds the preview pane + trial button using the [1.1.26](teacher-ui-consolidation.md) teacher primitives.

**New components:**
- `src/components/teacher/lesson-author/ResolvedPromptPreview.tsx` — renders the `AssembledPrompt`, badging each segment from `sources[]`
- `src/components/teacher/lesson-author/TryLessonButton.tsx` — POST to trial-session endpoint + open join URL in a new tab

**UX:**
- Preview re-fetches on every config change, debounced at 300ms; degrades to "preview unavailable" on resolver error (never blocks)
- "Try this lesson" is disabled until at least a teaching goal is set (mirrors the existing save-button gating)
- Trial session opens in a new tab; teacher iterates by returning to the author tab

### CLI surface

Per the CLAUDE.md Automation Principle, add a subcommand so ops can introspect a
lesson without the browser (turns a "the AI didn't do what I expected" complaint
into one command instead of "log in as them, navigate, screenshot"):

```
aiplatform activity inspect <activity-id>
  --resolved-prompt   Show the assembled system prompt + provenance
```

Implementation: ~0.25d (Click subcommand + httpx call to the endpoint + a unit
test). Same pattern as `aiplatform class get` / `aiplatform curriculum list`.

## API changes

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/activities/{id}/resolved-prompt` | GET | Returns `AssembledPrompt` (text + provenance) | Teacher owns activity's class |
| `/api/activities/{id}/trial-session` | POST | Spawn a teacher-as-student trial session | Teacher owns activity's class |

Both use the existing [1.A teacher-permission-model](../v1.0.0-pilot/implemented/teacher-permission-model.md) class-ownership guard — no new auth surface.

## Migration / rollout

- **No Firestore migration** — reads existing `ActivityConfig` + resolved persona/style/materials; trial sessions add an `is_trial` metadata flag (absent ⇒ false ⇒ today's behaviour).
- **Feature flag** — ship the preview + trial button behind a `lesson_author_v1` frontend flag for the first 48h.
- **Rollback** — frontend-only revert removes both affordances; the prompt-assembler refactor is behaviour-preserving (byte-identical output, verified by test) so it can stay even on rollback.

## Testing strategy

**Backend (`backend/tests/`):**
- `tests/unit/skills/test_prompt_assembler.py` — `assemble_prompt()` over each source combination; provenance map correctness; **byte-identical output between the runtime call site and the endpoint**
- `tests/unit/api/test_resolved_prompt.py` — endpoint returns identical bytes to the agent loop's session-start prompt; auth guard
- `tests/unit/api/test_trial_session.py` — `is_trial` flag flows to OTel + session metadata; trial sessions absent from class-aggregation queries

**Frontend (`frontend/src/`):**
- `__tests__/lesson-author/ResolvedPromptPreview.test.tsx` — renders the API response, badges segments (skill/style/persona/goal/curriculum), loading + error states
- `__tests__/lesson-author/TryLessonButton.test.tsx` — POSTs to trial-session, opens join URL in new tab, disabled-until-goal gating

**Integration / E2E (manual, LOCAL_MODE):** teacher logs in, opens an activity with a persona + rigorous style + a cited material, sees all three attributed in the preview, clicks "Try this lesson", joins, sends a message, confirms the AI behaves as the prompt says.

## Implementation Plan

| Step | Description | Est | Day |
|---|---|---|---|
| 1 | Backend: factor existing composition into `assemble_prompt()` + provenance map; converge runtime call sites + tests | 0.5d | Mon |
| 2 | Backend: `GET /api/activities/{id}/resolved-prompt` + tests | 0.25d | Mon |
| 3 | Backend: `POST /api/activities/{id}/trial-session` + `is_trial` OTel attribute + analytics-exclusion filter + tests | 0.5d | Tue |
| 4 | Frontend: `ResolvedPromptPreview` + `TryLessonButton` + page wiring + tests | 0.5d | Tue |
| 5 | CLI: `aiplatform activity inspect --resolved-prompt` + test | 0.25d | Wed |
| 6 | Manual E2E in LOCAL_MODE + edge-case fixes; mark row shipped | 0.25d | Wed |

**Total:** ~1.75d engineering + buffer ≈ **2d**.

## Success criteria

- [ ] Teacher opens an activity, sees the resolved system prompt with source badges (skill / style / persona / goal / curriculum)
- [ ] Editing the persona or interaction_style updates the preview within the debounce window
- [ ] Cited curriculum materials appear in the preview as a `curriculum` source
- [ ] Teacher clicks "Try this lesson", joins as themselves, has a normal-feeling session
- [ ] Trial session emits OTel spans with `is_trial=true`; does NOT appear in the class report
- [ ] `aiplatform activity inspect <id> --resolved-prompt` returns the same string the runtime uses
- [ ] `assemble_prompt()` output is byte-identical between runtime and endpoint (regression-guarded test)
- [ ] All backend + frontend tests pass (existing suites + new cases)
- [ ] `make security-check` passes

## Open questions

1. **What does the preview reveal — JB sign-off.** The full resolved prompt
   includes the skill template's own instructions. Is showing the verbatim
   template acceptable, or should the skill-template segment be summarised while
   the teacher-controlled segments (goal/style/persona/curriculum) are verbatim?
   M's reading: show it all read-only; JB to confirm.
2. **Trial-session cost accounting.** Trial sessions consume model tokens. Roll
   into the teacher's class budget (simplest; teachers self-limit) or free-tier?
   Default v1: charge to class budget; revisit if it discourages iteration.

## Related documents

- [Product Axioms](../../../product-axioms.md) — the EARNED TRUST / SECURE BY CONSTRUCTION scoring framework
- [v1.0.0-pilot/implemented/teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — 1.G; the screen this extends + the EARNED TRUST framing it preserves
- [v1.1.0-feedback/tutor-personas.md](tutor-personas.md) — 1.1.12 + 1.1.20; persona + interaction_style are prompt sources the preview attributes
- [v1.1.0-feedback/curriculum-library.md](curriculum-library.md) — 1.1.25; cited materials are a prompt source the preview attributes
- [v1.1.0-feedback/teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; the chat-only activity type that absorbed parent 1.9
- [post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) — 2.3; future per-knob parameters become additional attributed sources in this preview
- [parent SEQUENCE.md](../SEQUENCE.md) — row 1.9 (chat-only Socratic) folded into 1.1.19; this row is the transparency + trial layer
- [v1.1.0-feedback/SEQUENCE.md](SEQUENCE.md) — this row registered as 1.1.27
- [docs/design/v6.1.0/local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — `aiplatform activity inspect` follows these CLI conventions
