# Tutor interaction personas — per-activity teaching-style presets

**Status:** Planned (P1)
**Last Updated:** 2026-06-09
**Priority:** **P1** — direct ask from the 9 June teacher check-in. Resolves the apparent conflict between "be Socratic, end every turn with a question" (1.1.1) and the teacher request for a terse, directive "just try this" voice. The interaction style is a **teacher choice per activity**, not a platform-wide law.
**Estimated:** ~1d (config field + prompt variants + composer + builder picker). Prompt content gated on **AR sign-off** per preset.
**Scope:** Fullstack — `ActivityConfig`/`SkillConfig` field + InstructionProvider preamble composer (backend) + activity-builder picker (frontend). Stretch: student-facing in-session switcher.
**Dependencies:** [tutor-verbosity-fix.md](implemented/tutor-verbosity-fix.md) (1.1.1 — the Socratic preset *is* the verbosity-constrained block this doc generalizes); [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — the `persona`/style field rides the same activity-config surface); [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (1.G — builder host)
**Source brief:** [`june-09-feedback-sprint-brief.md` §3](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md)

## Problem

The 3 June verbosity fix (1.1.1) wrote one rule into every tutor preamble: ≤3 sentences, **end every turn with a question**. The 9 June session then asked for the opposite voice for some activities — *"chummy but not a sycophant, very concise, no follow-up questions, prescriptive: just try this"* — plus a *"hardcore"* exam-level voice that does not soften or over-scaffold.

These are not contradictory feedback. They are **different teaching styles for different moments**, and the teacher is the right person to choose which one an activity uses. The "end every turn with a question" rule is the **Socratic preset**, not a global constraint. Today it is hardcoded into the SKILL.md preambles, so there is no way for a teacher to pick another voice without editing prompts — which the whole [teacher-activity-authoring](teacher-activity-authoring.md) line exists to avoid.

## Goals

**Primary goal:** A teacher selects an **interaction-style preset** on an activity. The chosen preset's preamble variant is composed into the tutor's system prompt at run time. The Socratic preset stays the default, so nothing regresses for existing activities.

**Preset set (AR signs off on each preset's prompt block):**

| Preset | Voice | End-of-turn rule | When |
|---|---|---|---|
| `socratic` (default) | Short, question-led, leaves room to notice | **ends with a question** (current 1.1.1 behaviour) | concept discovery, the default |
| `concise` | Chummy but **not a sycophant**, very concise, prescriptive — "just try this" | **no follow-up question**; ends with a directive | procedural help, lab steps, low-friction hints |
| `rigorous` ("hardcore") | Holds the student to exam-level expectations; does **not** soften or over-scaffold | question or challenge, exam-register | exam prep, summative-adjacent practice; pairs with deliberate-friction |
| `warm` | Encouraging, more scaffolding | gentle question | lower-confidence students, early in a topic |

**Success metrics:**
- A teacher sets `interaction_style: concise` on an activity → a test session produces terse, directive, **no-follow-up** responses. Switching to `socratic` restores question-ending behaviour.
- Zero prompt edits required to change voice — it is a dropdown.
- AR has signed off each preset's prompt block before it ships.
- Existing activities (no field set) behave exactly as today (`socratic`).

**Non-goals:**
- Free-text teacher-authored persona prompts (a teacher typing a raw system prompt) — that is tier-3 authoring, out of scope; presets are a fixed, AR-reviewed set.
- Voice/avatar personas (name, avatar, TTS voice) — that is the **separate** [voice-personas.md](voice-personas.md) (1.1.12) axis. See *Relationship to voice-personas* below.
- Per-message style switching by the tutor itself (the model deciding to "go hardcore") — style is teacher-set, not model-chosen.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Prompt composition only; no latency-path change. |
| 2 | EARNED TRUST | +1 | Preset prompts are **human-authored and AR-reviewed** (reviewable provenance); no AI-fabricated persona. |
| 3 | SKILLS, NOT FEATURES | +1 | Teaching voice becomes a **teacher-configurable** choice on a skill/activity, not a developer code edit — the core abstraction win. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Same model; only the system-prompt preamble varies. |
| 5 | GRACEFUL DEGRADATION | +1 | Unknown/missing `interaction_style` → falls back to `socratic`; malformed value rejected at validation → default. Never an empty preamble. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Extends the existing Pydantic `ActivityConfig`/`SkillConfig` via one enum field + the shipped InstructionProvider injection path. No new wire format. |
| 7 | API FIRST | +1 | The field is on the activity config contract; web builder + CLI + any channel set it identically. |
| 8 | OBSERVABLE BY DEFAULT | +1 | `tutor.interaction_style` becomes an OTel span attribute → BigQuery, so research can correlate style with engagement signals (1.1.17). |
| 9 | SECURE BY CONSTRUCTION | +1 | Style is a **closed enum**, not free text — no new user-controlled string reaches the model context. Strictly narrower attack surface than today's editable lesson prompt. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Preamble composition is entirely backend; the picker is a dropdown emitting one enum value. |
| 11 | USABLE BY DESIGN | +1 | Builder picker ships with helper copy per preset ("Socratic — guides with questions"); default pre-selected so a teacher is never forced to choose. No new student-facing void. |
| | **Net Score** | **+9** | Threshold: ≥ +4. |

**Conflict Justifications:** none (no −1 scores).

## Standards compliance

- **Definition:** one `Literal` enum field on the existing `ActivityConfig` (and a mirror default on `SkillConfig` for non-activity skills). No new schema.
- **Composition:** rides the existing InstructionProvider injection that already assembles the SKILL.md preamble + `{teacher_focus}`. The preset selects which preamble *variant* string is concatenated — the same mechanism 1.1.1 used to inject the verbosity block.
- **No protocol invented** (Axiom 6).

## Design

### The field

```python
# backend/db/models/activity_config.py (and SkillConfig default)
InteractionStyle = Literal["socratic", "concise", "rigorous", "warm"]

interaction_style: InteractionStyle = Field(
    default="socratic", alias="interactionStyle"
)
```

`socratic` is the default so legacy rows and seeded skills are unchanged.

### Preamble variants

Each preset is a named preamble block stored alongside the existing verbosity block, **not** inline in each SKILL.md (so all skills inherit the same four presets without per-skill duplication):

```
backend/skills/preambles/interaction_style/
  socratic.md      # = today's 1.1.1 verbosity+question block (extracted, single source of truth)
  concise.md       # ≤2 sentences, directive, no trailing question
  rigorous.md      # exam-register, no over-scaffolding, holds the bar
  warm.md          # encouraging, one scaffolding step, gentle question
```

The InstructionProvider composes: `base SKILL.md instruction` + `preambles/interaction_style/{style}.md` + `{teacher_focus}` + (activity-specific blocks). Extracting `socratic.md` from the three tutor SKILL.md files de-duplicates the 1.1.1 block and makes "the Socratic rule" one editable file — a clean follow-through on 1.1.1.

### Relationship to voice-personas (1.1.12) — two orthogonal axes

This is the disambiguation that matters. AIPLA now has **two** "persona"-shaped concepts; they compose, they do not collide:

| Axis | Doc | Controls | Field |
|---|---|---|---|
| **Interaction style** (this doc) | tutor-personas | *How the tutor teaches* — prompt voice, scaffolding, question-or-directive | `interaction_style` (enum) |
| **Voice persona** (1.1.12) | [voice-personas.md](voice-personas.md) | *How the tutor sounds/looks* — avatar, name, TTS voice, language | `persona` (Persona model) |

A `rigorous` interaction style can be spoken by a `warm`-sounding voice persona; they are independent. To prevent the field-name clash the brief's wording invites (it said "a `persona` field"), this doc deliberately names the field `interaction_style`, reserving `persona` for the voice/avatar bundle 1.1.12 already claims. **Open question Q1** tracks final naming with AR/JB.

### Teacher authoring surface

A single dropdown in the [activity builder](teacher-activity-authoring.md) (`/teacher/activities/[id]`), in the lesson-prompt section:

```
  Teaching style   [ Socratic ▾ ]
                   Socratic   — guides with questions, leaves room to notice (default)
                   Concise    — terse, directive, "just try this", no follow-up
                   Rigorous   — exam-level, no softening
                   Warm       — encouraging, more scaffolding
```

**Stretch (separate acceptance, can slip):** expose the picker to the *student* in-session (a small control in the chat header) so a student can request "be more direct" — bounded to the same four presets. Teacher-set value is the default; student override is per-session only and never persisted to the activity.

## API changes

- `POST/PATCH /api/activity-configs` body gains optional `interactionStyle` (validated against the enum; reject unknown values).
- `GET /api/activities/{id}` includes `interactionStyle` so the (stretch) student switcher knows the current value.
- No new endpoints.

## CLI surface

Fold into the shipped `aiplatform activity` group (no new command needed beyond a flag):

| Command | Change |
|---|---|
| `aiplatform activity new … [--style socratic\|concise\|rigorous\|warm]` | optional flag, defaults `socratic` |
| `aiplatform activity get <id>` | prints `interactionStyle` |

Backlink: [local-dev-cli](../../v6.1.0/local-dev-cli.md).

## Migration

- Additive enum field, default `socratic` → existing rows + seeded skills unchanged.
- Extracting `socratic.md` from the three SKILL.md files is a refactor: the 1.1.1 pytest guard moves to assert the **composed** instruction still contains the verbosity+question constraint. No behaviour change for existing activities.
- Rollback: ignore the field; composer falls back to the inline block (keep it during one release as a safety net, then delete).

## Testing strategy

- **Backend (pytest):** enum validation (reject unknown); composer concatenates the right variant per style; `socratic` composition still satisfies the 1.1.1 verbosity-guard assertion (regression); `concise` composition does **not** force a trailing question.
- **Frontend (vitest):** builder picker renders four options, defaults to Socratic, emits `interactionStyle` on save.
- **Eval (LOCAL_MODE, AR sign-off gate):** 5-turn session per preset — `concise` produces ≤2-sentence directive turns with no trailing `?`; `socratic` ends each turn with `?`; `rigorous` holds exam register on a deliberately under-specified student answer; counter-test `"forklar i detaljer"` still allowed to run long under any preset.

## Human gates (tee up to AR now)

1. **AR — prompt block per preset** (gates ship): the actual wording of `concise.md`, `rigorous.md`, `warm.md`. `socratic.md` is the extracted 1.1.1 block (already AR-signed). This is the only blocking gate.
2. **AR/JB — naming** (Q1): confirm `interaction_style` vs `persona` to avoid the 1.1.12 collision.

## Open questions

- **Q1 — field naming:** `interaction_style` (this doc's recommendation, avoids the 1.1.12 `persona` clash) vs the brief's literal `persona`. Recommend `interaction_style`.
- **Q2 — student in-session override:** ship in v1.1 or hold? Recommend hold as the stretch; teacher-set is the v1.1 deliverable.
- **Q3 — does `rigorous` interact with the deliberate-friction / entry-timing analytics (Part 2.D)?** The friction signal is R1-gated (analytics framework); keep this doc prompt-only and let 2.D consume `interaction_style` as a dimension later.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Field-name collision with voice-personas `persona` | Medium | Named `interaction_style` here; Q1 locks it before either ships |
| `rigorous` reads as harsh / demotivating (Axiom 11) | Medium | AR authors the block; "holds the bar" ≠ "cold"; warm preset exists for the other end; validate in eval |
| Preset proliferation (teachers want a fifth, sixth…) | Low | Closed enum on purpose; adding one is a one-file PR + AR sign-off, not a teacher capability (that's tier-3) |

## Success criteria

- [ ] `interaction_style` enum field on `ActivityConfig`/`SkillConfig`, default `socratic`.
- [ ] Four preamble variant files; `socratic.md` extracted from the three tutor SKILL.md files (1.1.1 guard moved to composed-instruction assertion, still green).
- [ ] Builder dropdown with per-preset helper copy, Socratic pre-selected.
- [ ] `interaction_style: concise` session → terse, directive, no trailing question (eval); `socratic` → ends with `?`.
- [ ] `tutor.interaction_style` OTel attribute lands in BigQuery.
- [ ] AR sign-off recorded on each preset block.
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green.

## Related documents

- [tutor-verbosity-fix.md](implemented/tutor-verbosity-fix.md) — 1.1.1; the Socratic preset is the block this generalizes
- [voice-personas.md](voice-personas.md) — 1.1.12; the **orthogonal** voice/avatar persona axis (do not conflate)
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; the activity-config surface the field rides
- [student-engagement-signals.md](student-engagement-signals.md) — 1.1.17; consumes `interaction_style` as a research dimension
