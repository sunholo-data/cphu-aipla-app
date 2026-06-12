# Lesson-author surface — teacher visibility, knobs, uploaded curriculum, trial session

**Status:** Planned (P1)
**Last Updated:** 2026-06-05
**Priority:** P1 — closes the visibility gap teachers flagged informally, makes the platform usable for chat-only lessons (no sim required), and lays the renderer foundation for post-pilot 2.3 bounded-params
**Estimated:** ~3d (0.5d skill template, 0.5d backend prompt-assembly + ActivityConfig schema, 1d frontend surface, 0.5d teacher document upload pipeline, 0.5d trial-session wiring + analytics gate)
**Scope:** Fullstack — frontend lesson-author screen (extends [1.G `/teacher/activities/[id]`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx)), backend prompt-assembly contract + ActivityConfig schema extension + AILANG Parse wiring + trial-session marker, new `concept-dialogue-config` skill template
**Dependencies:**
- [1.G teacher-ui](../v1.0.0-pilot/implemented/teacher-ui.md) shipped — `/teacher/activities/[id]` exists with the free-text teaching goal
- [ADR-004 AILANG Parse](file:///Users/voightkampff/dev/sunholo-data/aipla/architecture.qmd) ready — used for the teacher document upload
- [1.1.7 student-multimodal-upload](student-multimodal-upload.md) — independent surface; ships in the same sprint
- **JB sign-off** on the "bounded enough" question: which knobs are exposed, what the prompt-preview reveals (M's reading: this should be defensible to JB on the "teachers don't write prompts" axiom — see below)
**Cross-link:** [Product Axioms](../../../product-axioms.md) — strong EARNED TRUST + USABLE BY DESIGN touchpoints

## Relationship to existing planned items

| Existing item | What changes |
|---|---|
| **1.9 `concept-dialogue-config`** (parent [SEQUENCE.md](../SEQUENCE.md) row) — "standalone Socratic conceptual-exploration tutor for a topic. A2UI config form. ~1.5d" | **Absorbed into this surface.** Becomes the *activity type* the lesson-author screen configures when teachers pick "no sim, just chat". The A2UI config form 1.9 envisioned IS this surface. Mark 1.9 as superseded by 1.1.17 in the parent SEQUENCE. |
| **1.8 `problem-set-helper-config`** — "configures a tutor for a specific topic / problem set, pointing at one or more RAG-ingested documents. ~2d" | **Still deferred to v1.2.** The RAG-grounded variant needs [1.3 rag-pgvector](../v1.0.0-pilot/SEQUENCE.md) which is in v1.0 critical path. This doc's *inline-injection* approach to teacher curriculum is the v1.1 alternative for single-doc lessons; multi-doc RAG-backed lessons wait for 1.3 → 1.8. |
| **[2.3 teacher-artefact-parameters](../post-pilot/teacher-artefact-parameters.md)** (post-pilot, signal) — "bounded knobs without code" for first-party artefacts | **This doc is the precursor renderer.** The knob schema introduced here for skill templates is the same schema 2.3 would extend to MCP App artefacts. Lesson-author surface reuses the same form-renderer code when 2.3 commits post-pilot. |
| **[1.G teacher-ui](../v1.0.0-pilot/implemented/teacher-ui.md)** shipped — chose "teaching-goal-as-input, not system-prompt-as-input" with **EARNED TRUST +1** | **Honoured, not overridden.** This design preserves the no-prompt-engineering boundary by making the prompt **read-only** and the knobs **bounded**. The visibility gap closes via display, not editing. See axiom scoring below for the explicit treatment. |
| **[1.1.7 student-multimodal-upload](student-multimodal-upload.md)** — student paperclip + Gemini multimodal call | **Independent.** That doc covers per-message attachments at the student-chat boundary. This doc covers per-lesson curriculum at the teacher-author boundary. Same AILANG Parse + ADR-008 building blocks; different UX surfaces. |

## Problem

Teachers configure an activity by typing a free-text *teaching goal* into the [1.G activity-config screen](../v1.0.0-pilot/implemented/teacher-ui.md). They then hand a group code to students, students start a session, and the teacher reads the report afterwards. Three concrete gaps surfaced:

1. **No visibility into what the lesson will do.** The teaching goal gets injected into a system prompt the teacher cannot see. Teachers report this as "I'm not sure what the AI is actually going to do with my goal." Without seeing the resolved prompt, iteration is *guess → wait for a student session → read the transcript → guess again* — a multi-hour loop.
2. **No way to try the lesson.** Teachers can't run a session as themselves to validate behaviour before deploying to students. The first "real run" is also the first student exposure — which raises the cost of iteration and discourages tuning.
3. **No path to a lesson without a sim.** All three live activities (Boldkast / LED Planck / KineBot) are sim-grounded. Teachers asked: *"can I just configure a chat-only Socratic lesson around topic X?"* The answer today is "1.9 is planned" — but 1.9 was scoped as a thin A2UI form for a hardcoded skill, not as the broader visibility-and-iteration surface teachers actually want.

The user (2026-06-05) reframed the brief: *"more control and knowledge of what the lessons will do, such as system prompts, and have the student upload document features... that way the platform gets usable even without simulations."*

Decoded: visibility into the prompt + bounded knobs + uploaded lesson material + a way to try the lesson out — composed on one screen. NOT raw prompt editing (the user clarified: *"I don't mean they directly create a system prompt, but the ability to at least see it"*).

## Goals

**Primary goal:** A teacher can open a lesson, see exactly what the system prompt will be when a student joins, tune the bounded knobs they care about (verbosity, language, Socratic depth), upload their own curriculum material as the lesson's context, and run a private trial session to test the behaviour — all without writing prompt engineering and without polluting class analytics.

**Success metrics:**
- Teacher iteration loop: lesson-edit → trial → re-edit shrinks from "hours" (current: wait for a student session) to "minutes" (trial session is real-time)
- ≥80% of pilot teachers (target: 8 of 10) configure at least one lesson with a custom knob value (not just teaching-goal defaults)
- ≥3 of 10 pilot teachers run a no-sim chat-only lesson successfully — validates the platform-is-usable-without-sims goal
- Zero teacher-uploaded curriculum exceeds the inline-injection token budget (or, if exceeded, surfaces a clear "use shorter material, or wait for 1.8/1.3 RAG" message — graceful degradation)
- Pilot teachers correctly describe what their lesson will do at the start of the pilot (week 13 baseline) and improve at the end (week 17) — measured via a 1-question exit survey on the lesson-author screen

**Non-goals (explicitly deferred):**
- **Raw prompt editing** — teachers see the resolved prompt; they do not edit its template. Tunable dimensions are bounded knobs only.
- **Multi-document curriculum** — v1 supports one uploaded doc per activity. Multi-doc + retrieval is 1.8 (RAG-track, v1.2).
- **Vector retrieval / chunked search** — pgvector is deferred; this doc uses *inline injection* into the prompt, capped at a token budget.
- **Mixing trial-session and student-session data in analytics** — trial sessions are explicitly excluded from class analytics, teacher reports, and the BigQuery research aggregation. They exist for teacher iteration only.
- **Multi-teacher concurrent editing of the same activity** — last-write-wins on `ActivityConfig`. Real-time collaboration is out of scope (and unlikely to come up; teachers own their own classes per the [1.A permission model](../v1.0.0-pilot/implemented/teacher-permission-model.md)).
- **Knob editing during a student session** — knobs are fixed at session-start. Changes take effect for new sessions only. (Live-update would require breaking the "system prompt is immutable per session" assumption ADK and the agent loop currently rely on.)

## Axiom alignment

Score each axiom per [Product Axioms](../../../product-axioms.md). Net score must be ≥ +4. Max 2 conflicts (-1) allowed.

| # | Axiom | Score | Notes |
|---|---|---|---|
| 1 | INSTANT FEEL | 0 | Trial session uses the same agent loop / streaming the student session does — same TTFT. The lesson-author screen itself is form-driven; save-and-toast is <500ms. No latency-path changes. |
| 2 | EARNED TRUST | **+1** | Closes the visibility gap the 1.G shipping note flagged ("teachers don't know what the AI will actually do") while preserving the prior decision that teachers don't write prompts. Read-only prompt + bounded knobs = teachers see and understand without being asked to engineer. This is the *exact* trust gap 1.G's +1 was earned against; this doc widens the win. |
| 3 | SKILLS, NOT FEATURES | **+1** | Net-new `concept-dialogue-config` skill template; same lesson-author surface configures it, Boldkast, LED Planck, KineBot. Activity type = skill name; lesson config = skill-instance config. Doesn't introduce a "non-skill" lesson path. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Knob: response language can hint the routing layer (Danish → favour a model with stronger Danish), but routing decisions still live in [1.4 model-router-aipla-config](../v1.0.0-pilot/SEQUENCE.md) and are not changed by this doc. No new model-selection logic here. |
| 5 | GRACEFUL DEGRADATION | **+1** | Trial session degrades to a normal session if `is_trial` flag isn't honoured anywhere downstream — worst case, an extra row in analytics that's clearly marked. Uploaded curriculum oversized → falls back to "please shorten or use [1.8 RAG-track](../v1.0.0-pilot/SEQUENCE.md) when available" with the same teacher-author surface. Prompt-preview degrades to "preview unavailable" if the template-resolver errors, never blocks save. |
| 6 | PROTOCOL OVER CUSTOM | **+1** | Skill template = existing ADK [`load_skill_from_dir()`](../../../../backend/skills/) pattern, no new format. Knob schema = JSON Schema (standard), stored on existing `ActivityConfig` Firestore doc. Document parsing = AILANG Parse per [ADR-004](file:///Users/voightkampff/dev/sunholo-data/aipla/architecture.qmd) — already adopted. Prompt-preview = an HTTP endpoint that returns the assembled prompt string; no new protocol. |
| 7 | API FIRST | **+1** | New endpoint `GET /api/activities/{id}/resolved-prompt` returns the assembled system prompt — the same string the runtime would use. CLI `aiplatform activity inspect <id> --resolved-prompt` is a 0.1d wrapper. The frontend just renders what the API returns. No frontend-only logic computing the prompt. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Trial sessions are *deliberately* excluded from class analytics + BigQuery research aggregation (`is_trial: true` filters them out at OTel attribute time). This is intentional, not an observability gap — trial-session iteration would pollute teacher reports otherwise. They still emit traces in the trusted-zone observability surface; they just don't aggregate into pilot data. Net: neutral. |
| 9 | SECURE BY CONSTRUCTION | **+1** | Bounded knobs are *architecturally* enforced (JSON Schema validation on save; render-only on display), not "developer discipline." Teacher cannot escape the schema to inject arbitrary prompt content — the prompt-assembly contract is the only path values reach the system prompt. Uploaded curriculum goes through AILANG Parse's deterministic-XML normalisation per [ADR-004](file:///Users/voightkampff/dev/sunholo-data/aipla/architecture.qmd) before injection, which strips active content. |
| 10 | THIN CLIENT, FAT PROTOCOL | **+1** | All composition logic lives on the backend: prompt assembly, knob → modifier mapping, curriculum injection, trial-session marker. The frontend is a form + a preview pane; it does not assemble the prompt client-side. The lesson-author screen is purely "render what the API returns, send what the user typed back to the API." |
| | **Net Score** | **+7** | Threshold ≥ +4 ✅; max 2 conflicts ✅ (zero conflicts); EARNED TRUST +1 ✅ (hard-fail rule passed — feature involves user-facing data); SECURE BY CONSTRUCTION +1 ✅ (hard-fail rule passed — feature introduces a new teacher-author data-access pattern); USABLE BY DESIGN bypassed (no student-facing surface; teacher-facing only and the iteration loop IS the UX). |

**Conflict justifications:** none required (zero -1 scores).

## Design

### Overview

One screen ([`/teacher/activities/[id]`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx) — already exists, extended) becomes the **lesson author**. It has four panels:

1. **Resolved system prompt** (read-only, annotated by source)
2. **Bounded knobs** (form fields, schema-driven)
3. **Curriculum** (file upload + parsed-preview)
4. **Try this lesson** (button that opens a trial session)

All four surface the same `ActivityConfig` Firestore doc through an extended schema. The runtime composes the system prompt at session-start from the doc; the lesson-author screen renders the same composition via a new `GET /api/activities/{id}/resolved-prompt` endpoint.

```
                  ┌─────────────────────────────────────────────────────┐
                  │  /teacher/activities/[id] — lesson author           │
                  │                                                      │
                  │  ┌───────────────────┐   ┌────────────────────────┐│
                  │  │ Activity type     │   │ Resolved prompt        ││
                  │  │ ▾ Concept dialogue│   │ ┌────────────────────┐ ││
                  │  └───────────────────┘   │ │ # System           │ ││
                  │  ┌───────────────────┐   │ │ You are a Socratic │ ││
                  │  │ Teaching goal     │   │ │   ◐ from skill     │ ││
                  │  │ (free text)       │   │ │ tutor for          │ ││
                  │  └───────────────────┘   │ │   ▲ from teaching  │ ││
                  │  ┌───────────────────┐   │ │ ## Tone            │ ││
                  │  │ Knobs (form)      │   │ │   Be brief         │ ││
                  │  │  Verbosity   [3]  │   │ │   ● from knob      │ ││
                  │  │  Language    DA   │   │ │ ## Curriculum      │ ││
                  │  │  Socratic    [4]  │   │ │ <xml>...</xml>     │ ││
                  │  │  Hint depth  med  │   │ │   ■ from upload    │ ││
                  │  └───────────────────┘   │ └────────────────────┘ ││
                  │  ┌───────────────────┐   └────────────────────────┘│
                  │  │ Curriculum        │   ┌────────────────────────┐│
                  │  │ 📎 newton.pdf     │   │ [Try this lesson]      ││
                  │  │   1,847 tokens    │   │ (opens trial session)  ││
                  │  └───────────────────┘   └────────────────────────┘│
                  └─────────────────────────────────────────────────────┘
```

### Prompt assembly contract

The runtime assembles the system prompt at session-start by concatenating four sources in a fixed order. The same contract drives both the runtime and the preview endpoint, so what teachers see is what the agent gets.

```
SystemPrompt =
    SkillTemplate                                            (1) from backend/skills/templates/<name>/SKILL.md
  + KnobModifiers(ActivityConfig.knobs)                      (2) from schema → modifier strings
  + TeachingGoal(ActivityConfig.teaching_goal)               (3) from 1.G's free-text input
  + Curriculum(ActivityConfig.curriculum.normalised_xml)     (4) from AILANG Parse output
```

Each source contributes a labelled segment. The preview UI tags each line with a small badge: ◐ skill / ● knob / ▲ goal / ■ upload — so teachers can see exactly which knob caused which change in the assembled prompt.

**Order matters:** skill template defines the role + capabilities; knobs adjust tone + constraints; teaching goal scopes the topic; curriculum supplies content. The order is fixed so prompt-preview output is deterministic and reviewable.

**Token budget:** total assembled prompt is capped (target: 8k tokens; tunable per skill). The curriculum slot is the largest variable. If the uploaded doc parses to >6k tokens, save succeeds but the surface warns the teacher: *"This document is too long to fit in a single lesson. Shorten it, or use 1.8 RAG-track (v1.2) when available."* The teacher can still save and ship — the runtime truncates at session-start with a logged warning — but the visibility is the point.

### Backend changes

#### Prompt assembler

New module `backend/skills/prompt_assembler.py`:

```python
class AssembledPrompt(BaseModel):
    """The resolved system prompt + provenance map."""
    text: str
    sources: list[PromptSegment]  # for the annotated preview

class PromptSegment(BaseModel):
    source: Literal["skill", "knob", "goal", "curriculum"]
    label: str  # human-readable, e.g. "Tone: brief (verbosity=3)"
    text: str
    line_start: int  # offset in the final text
    line_end: int

def assemble_prompt(activity_config: ActivityConfig, skill_template: str) -> AssembledPrompt:
    ...
```

The same `assemble_prompt()` call is used by:
- The agent loop at session-start (existing call site shifts from "raw skill template + teaching goal" to "AssembledPrompt.text")
- The new `GET /api/activities/{id}/resolved-prompt` endpoint
- The CLI `aiplatform activity inspect --resolved-prompt`

This is the single source of truth for prompt assembly. Tests verify all three call sites get byte-identical output for the same `ActivityConfig`.

#### ActivityConfig schema extension

```python
class ActivityConfig(BaseModel):
    # Existing (1.G)
    id: str
    class_id: str
    skill_name: str
    teaching_goal: str
    created_at: datetime
    updated_at: datetime

    # NEW — knobs
    knobs: dict[str, Any] = Field(default_factory=dict)  # validated against skill's knob schema

    # NEW — curriculum
    curriculum: Curriculum | None = None

class Curriculum(BaseModel):
    """Teacher-uploaded lesson material, AILANG-Parse-normalised."""
    filename: str
    mime_type: str
    upload_id: str  # GCS path
    parsed_xml: str  # AILANG Parse output
    token_count: int  # for budget enforcement
    parsed_at: datetime
```

#### Knob schema per skill

Each skill template declares its knobs in a sibling `knobs.yaml`:

```yaml
# backend/skills/templates/concept-dialogue/knobs.yaml
verbosity:
  type: integer
  min: 1
  max: 5
  default: 3
  modifier: |
    Aim for approximately {verbosity} sentences per response, except when
    the student explicitly asks for more detail.

language:
  type: enum
  values: ["DA", "EN"]
  default: "DA"
  modifier: |
    Respond exclusively in {language_name}. Use the student's vocabulary
    level where possible.

socratic_depth:
  type: integer
  min: 1
  max: 5
  default: 3
  modifier: |
    Lean {socratic_depth}/5 toward question-driven Socratic prompts vs
    direct explanation. 1 = mostly explain; 5 = almost always ask.

hint_depth:
  type: enum
  values: ["light", "medium", "deep"]
  default: "medium"
  modifier: |
    When the student is stuck, give a {hint_depth} hint — light = a
    nudge, medium = a guided question, deep = a worked-step example.
```

The schema is loaded with the skill template, validated by Pydantic, and persisted on `ActivityConfig.knobs`. The frontend renders the form from the schema (same renderer that 2.3 will reuse).

#### Curriculum upload pipeline

New endpoint:

```
POST /api/activities/{id}/curriculum
  Body: multipart/form-data with file field
  Validation: AILANG Parse-supported MIME (per ADR-004: PDF, DOCX, ODT, MD, TXT, ...) — 13 deterministic formats + 2 AI formats
  Size cap: 10 MB at upload, ~6k tokens post-parse for inline-injection
  Processing:
    1. Stream to short-lived GCS blob
    2. AILANG Parse to deterministic XML
    3. Token-count the XML (tiktoken)
    4. Persist Curriculum on ActivityConfig
  Response: { token_count, parsed_preview_url, warnings: [] }
```

Per [ADR-004](file:///Users/voightkampff/dev/sunholo-data/aipla/architecture.qmd) the parsing stays inside the GCP trust zone — uploaded curriculum is not sent to a third-party SaaS. The parsed XML is what reaches the model as context, not the raw bytes; same egress posture as the rest of the platform.

#### Resolved-prompt endpoint

```
GET /api/activities/{id}/resolved-prompt
  Auth: teacher must own the activity's class (existing 1.A guard)
  Response: AssembledPrompt (text + sources for annotated preview)
```

Read-only. Stateless. The frontend calls this on every change to keep the preview live; debounced to 300ms to avoid spamming.

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

Analytics exclusion happens at the OTel span attribute level: `tutor.session.is_trial = true` becomes a partition key in the BigQuery sink and the [analytics-chat skill](../v1.0.0-pilot/implemented/analytics-chat-tools.md) gets a `WHERE is_trial = false` filter by default. The [session-report endpoint](../v1.0.0-pilot/implemented/teacher-insights-dashboard.md) and the rolling teacher dashboard already filter by `class_id`; the trial session is class-attached but reported under a separate "Your trial sessions" view (not aggregated with student sessions).

**Identity**: the teacher's Firebase UID flows through as the session's user identity (not a group code). The session is fully real — same agent loop, same model, same observability — it just gets a flag that excludes it from class-aggregation. No "preview mode," no synthetic responses, no fake students.

### Frontend changes

**Modified component:** [`frontend/src/app/teacher/activities/[id]/page.tsx`](../../../../frontend/src/app/teacher/activities/[id]/page.tsx) — extends with the four new panels per the ASCII layout above.

**New components:**

- `src/components/teacher/lesson-author/ResolvedPromptPreview.tsx` — renders the `AssembledPrompt` from the API, annotating each segment with a coloured badge from `sources[]`
- `src/components/teacher/lesson-author/KnobForm.tsx` — generic schema-driven form renderer; same component will serve 2.3 post-pilot
- `src/components/teacher/lesson-author/CurriculumPanel.tsx` — paperclip + parsed-preview + token-budget warning
- `src/components/teacher/lesson-author/TryLessonButton.tsx` — POST to trial-session endpoint + redirect to join URL

**State management:** form state lives in the page component, debounced PUT to `/api/activities/{id}` on change; the resolved-prompt preview re-fetches on every change debounced at 300ms.

**UX:**

- Activity-type dropdown ("Concept dialogue" / "Boldkast" / "LED Planck" / "KineBot") drives which knobs render — schema is per-skill
- "Try this lesson" button is disabled until at least teaching goal is set (mirroring the existing save button's gating)
- The trial session opens in a new tab — teacher can iterate by going back to the lesson-author tab and editing
- Token-budget warning ("This document is too long to fit...") is a soft inline message, not a hard block

### `concept-dialogue-config` skill template

New skill at `backend/skills/templates/concept-dialogue/`:

```
backend/skills/templates/concept-dialogue/
  SKILL.md             # The system prompt template
  knobs.yaml           # Knob schema (verbosity / language / socratic_depth / hint_depth)
  config.yaml          # Skill registration (mirrors Boldkast / LED Planck shape)
```

Per [the existing skill convention](../../../../backend/skills/templates/) (`load_skill_from_dir()` from ADK):

```markdown
# concept-dialogue

You are a Socratic tutor for {teaching_goal}.

## Approach
Ask questions; do not lecture. When the student is wrong, do not correct
them directly — ask the question that surfaces the gap in their reasoning.

## Tone
{knob_modifiers}

## Curriculum
{curriculum_xml}

## Boundaries
Stay on topic. If the student asks about something unrelated to the
lesson, politely steer back. Never pretend to know facts you don't.
```

The `{knob_modifiers}` slot expands to the assembled knob-modifier block; `{curriculum_xml}` expands to the AILANG Parse output (or empty string if no upload). The same template-resolver the existing skills use is reused; no new templating engine.

Skill registration mirrors [Boldkast](../../../../backend/skills/templates/) — the seeder picks it up on next deploy + adds it to the `public` access-control tier by default. Teachers see it in the activity-type dropdown on next reload.

### CLI surface

Per the CLAUDE.md Automation Principle, add a small subcommand so ops can introspect a lesson without the browser:

```
aiplatform activity inspect <activity-id>
  --resolved-prompt      Show the assembled system prompt + provenance
  --knobs                Show the knob values as JSON
  --curriculum           Show the parsed curriculum XML (first 200 lines)
```

Implementation: ~0.25d (Click subcommand + httpx call to the three new endpoints + a unit test). Same pattern as the existing `aiplatform class get` and `aiplatform group list` commands.

This keeps the "any local workflow that takes more than one manual step must have a script or make target" rule satisfied — debugging a teacher-reported "the AI didn't do what I expected" complaint becomes a one-command CLI call instead of "log in as them, navigate to the screen, screenshot the preview."

## API changes

| Endpoint | Method | Description | Auth |
|---|---|---|---|
| `/api/activities/{id}/resolved-prompt` | GET | Returns `AssembledPrompt` (text + provenance) | Teacher owns activity's class |
| `/api/activities/{id}/curriculum` | POST | Upload + parse curriculum | Teacher owns activity's class |
| `/api/activities/{id}/curriculum` | DELETE | Remove uploaded curriculum | Teacher owns activity's class |
| `/api/activities/{id}/trial-session` | POST | Spawn a teacher-as-student trial session | Teacher owns activity's class |
| `/api/activities/{id}` | PATCH (extends existing) | Now accepts `knobs: dict` and `curriculum: Curriculum` fields | Teacher owns activity's class |

All new endpoints use the existing [1.A teacher-permission-model](../v1.0.0-pilot/implemented/teacher-permission-model.md) class-ownership guard — no new auth surface.

## Migration / rollout

- **No Firestore migration needed** — `ActivityConfig.knobs` and `ActivityConfig.curriculum` are optional fields; existing activities without them resolve to default knob values + no curriculum (i.e., today's behaviour).
- **No skill-registration migration** — `concept-dialogue-config` is a new entry the seeder writes; existing skills are untouched.
- **Feature flag:** ship the lesson-author panels behind a `lesson_author_v1` flag in the frontend config for the first 48h, so the panels can be hidden if anything surprising surfaces in dev. Removed once stable.
- **Rollback plan:** revert the page-component change → frontend falls back to the 1.G activity-config screen with just the teaching-goal field. Knobs + curriculum on the backend keep working (just not editable from the UI); trial sessions still work via direct API. Worst-case rollback is a frontend-only revert.

## Testing strategy

**Backend (`backend/tests/`):**
- `tests/unit/skills/test_prompt_assembler.py` — assemble_prompt() with each combination of (skill / knobs / goal / curriculum), test the source-attribution map, test the token-budget warning behaviour
- `tests/unit/skills/test_concept_dialogue.py` — skill loads cleanly, knob schema validates, modifier strings expand correctly
- `tests/unit/api/test_resolved_prompt.py` — endpoint returns identical bytes to what the agent loop's session-start gets
- `tests/unit/api/test_curriculum_upload.py` — AILANG Parse wiring works for each accepted MIME, oversized doc returns the warning + still saves
- `tests/unit/api/test_trial_session.py` — `is_trial` flag flows through to OTel + session metadata; trial sessions absent from class-aggregation queries

**Frontend (`frontend/src/`):**
- `__tests__/lesson-author/ResolvedPromptPreview.test.tsx` — renders the API response, badges segments correctly, handles loading + error states
- `__tests__/lesson-author/KnobForm.test.tsx` — schema-driven form renders the four knob types (integer-range, enum, slider), validates on submit, debounces save
- `__tests__/lesson-author/CurriculumPanel.test.tsx` — upload flow, parsed-preview, token-budget warning rendering
- `__tests__/lesson-author/TryLessonButton.test.tsx` — POSTs to trial-session, opens join URL in new tab

**Integration / E2E:**
- Manual: teacher logs in (LOCAL_MODE), creates a concept-dialogue activity, sets a teaching goal, sees the resolved-prompt preview update, edits knobs and sees the preview change, uploads `newton.pdf`, sees the curriculum injected, clicks "Try this lesson", joins, sends a message, sees the AI behave as the prompt says.
- CI smoke (`make smoke-lesson-author` — new make target wrapping the CLI): create activity → set knobs via CLI → fetch resolved prompt via CLI → assert non-empty and well-formed.

## Implementation Plan

| Step | Description | Owner | Est | Day |
|---|---|---|---|---|
| 1 | Author `concept-dialogue` skill template (`SKILL.md` + `knobs.yaml` + `config.yaml`) | exec | 0.5d | Mon |
| 2 | Backend: `assemble_prompt()` + `ActivityConfig` schema extension + Pydantic models | exec | 0.5d | Mon |
| 3 | Backend: `GET /api/activities/{id}/resolved-prompt` endpoint + tests | exec | 0.25d | Tue |
| 4 | Backend: `POST /api/activities/{id}/curriculum` + AILANG Parse wiring + tests | exec | 0.5d | Tue |
| 5 | Backend: `POST /api/activities/{id}/trial-session` + `is_trial` OTel attribute + analytics-exclusion filter update | exec | 0.5d | Tue |
| 6 | Frontend: extend `[id]/page.tsx` layout to 4-panel composition + state plumbing | exec | 0.5d | Wed |
| 7 | Frontend: `ResolvedPromptPreview` + `KnobForm` + `CurriculumPanel` + `TryLessonButton` components + tests | exec | 1d | Wed–Thu |
| 8 | CLI: `aiplatform activity inspect` subcommand + tests | exec | 0.25d | Thu |
| 9 | Manual E2E in LOCAL_MODE + edge-case fixes | exec | 0.5d | Fri |
| 10 | Update parent SEQUENCE: mark 1.9 superseded; mark this row shipped on completion | exec | 0.1d | Fri |

**Total:** ~3.5d engineering + ~0.5d for review/iteration buffer = **4d**.

## Success criteria

- [ ] Teacher opens an activity, sees the resolved system prompt with source badges
- [ ] Teacher edits a knob, preview updates within 500ms (debounce window)
- [ ] Teacher uploads `newton.pdf`, sees the parsed curriculum injected with source badge
- [ ] Teacher clicks "Try this lesson", joins as themselves, has a normal-feeling session
- [ ] Trial session emits OTel spans with `is_trial=true`; does NOT appear in the class report
- [ ] `aiplatform activity inspect <id> --resolved-prompt` returns the same string the runtime uses
- [ ] `concept-dialogue-config` is selectable as an activity type; chat-only lesson works end-to-end
- [ ] Token-budget warning shows for oversized curriculum without blocking save
- [ ] All backend tests pass: 1761 + new cases
- [ ] All frontend tests pass: 911 + new cases
- [ ] `make security-check` passes (no new dep CVEs from AILANG Parse wiring)

## Open questions

1. **Default knob values for `concept-dialogue` — JB sign-off.** What are the right defaults for the four knobs? M's starting position is verbosity=3, language=DA, socratic_depth=3, hint_depth=medium, but JB should sign off on the pedagogical defaults before shipping.
2. **Token budget value.** 6k tokens (curriculum slot) is a starting estimate. Once we see what teachers actually upload (problem sets, lab handouts, chapter excerpts), tune the cap. The warning UX is the safety valve — it surfaces the problem rather than failing silently.
3. **"Try this lesson" cost accounting.** Trial sessions consume model tokens like any other session. Should they roll into the teacher's class budget, or be free-tier? Default for v1: charge to class budget (simplest; teachers self-limit). Revisit if it discourages iteration.
4. **Activity-type dropdown ordering.** Sim-grounded skills (Boldkast / LED Planck / KineBot) vs chat-only (`concept-dialogue`). Default: alphabetical by display name. Teachers may want a "favourites" or "recently used" sort — defer to feedback.

## Related documents

- [Product Axioms](../../../product-axioms.md) — the EARNED TRUST / SECURE BY CONSTRUCTION / USABLE BY DESIGN scoring framework this doc applies
- [v1.0.0-pilot/implemented/teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — 1.G shipped doc; the activity-config screen this extends + the EARNED TRUST +1 framing this preserves
- [v1.1.0-feedback/student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7, sibling sprint; shares AILANG Parse + ADR-008 wiring
- [post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) — 2.3 signal; this doc's knob-renderer is its precursor
- [parent SEQUENCE.md](../SEQUENCE.md) — rows 1.8 (deferred to v1.2 / RAG-track) and 1.9 (absorbed into this row)
- [v1.1.0-feedback/SEQUENCE.md](SEQUENCE.md) — this row registered as 1.1.17
- [v1.1.0-feedback/security-monitoring-pipeline.md](security-monitoring-pipeline.md) — 1.1.16 just shipped; `make security-check` is now the gate this doc commits to passing
- AILANG Parse via ADR-004 in the scoping site: [file:///Users/voightkampff/dev/sunholo-data/aipla/architecture.qmd](file:///Users/voightkampff/dev/sunholo-data/aipla/architecture.qmd)
- [.claude/skills/aipla-security-checkup/SKILL.md](../../../../.claude/skills/aipla-security-checkup/SKILL.md) — invoke if AILANG Parse dep updates introduce CVEs (Python audit surface)
- [.claude/skills/mcp-app-artefact/SKILL.md](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — when 2.3 commits post-pilot, the same knob-form renderer extends to MCP App artefact parameters
- [docs/design/v6.1.0/local-dev-cli.md](../../v6.1.0/local-dev-cli.md) — the `aiplatform activity inspect` subcommand follows the conventions documented here
