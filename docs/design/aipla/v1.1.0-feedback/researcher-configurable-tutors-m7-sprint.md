# Sprint Plan: TUTOR-3 — one tutor choice (1.1.91 M1 + M7)

## Summary

A teacher picks **one thing** — a tutor — and gets its avatar, voice, tone and pedagogy
together. Today they pick a persona *and* a teaching style, and a framework would have been
a third. Decision taken 2026-09-10 (M): **bundle, don't add a third control.**

**Duration:** ~3–4 days · **Scope:** Fullstack · **Design docs:** [1.1.91](researcher-configurable-tutors.md) M1 + M7

## The problem this fixes

Four overlapping answers to "what tutor is this?" have accumulated:

| Concept | Ships | Controls |
|---|---|---|
| SKILL.md tutors | 4 | the agent itself |
| Personas (1.1.12) | 6 YAML | name, avatar, TTS voice |
| `interaction_style` (1.1.20) | 4 preambles | tone |
| Teaching frameworks (1.1.91) | 7, two written | pedagogy |

A teacher has **one** question — *how should this tutor teach?* — and currently answers it in
three places. `Tutor` (M0) was designed as the object that bundles them; this sprint makes it
the thing you actually select.

## The rule that makes this safe

**Behaviour-preserving by construction.** Every seeded base tutor carries the persona it is
named for and **no framework**, so selecting one composes byte-identically to today. A
framework only ever arrives through a *variant* somebody deliberately made. No existing
activity changes, and the passthrough guarantee from TUTOR-2 still holds end to end.

This is also why base tutors are not pre-paired with frameworks. "Sofie teaches with ESRU"
is a pedagogical claim, and the catalogue does not get to make claims nobody signed off —
the same rule that keeps five frameworks as empty slots.

## Milestones

### M1 — Tutor catalogue + store
**Scope:** backend · ~1d
- [x] `backend/tutors/*.yaml` + `loader.py`, mirroring `personas/` and `frameworks/` — one base tutor per shipped persona, `framework_id: null`
- [x] `db/tutors.py` — Firestore store for authored tutors and variants, layered over the YAML defaults exactly as `framework_overrides` layers over framework YAML
- [x] `create_variant(parent_id, …)` — records lineage, bumps version, never mutates the parent

**Acceptance:** the catalogue loads; a variant records its parent; a parent edit does not alter an existing variant.

### M2 — One resolution path
**Scope:** backend · ~0.75d
- [x] `tutor_id` on `ActivityConfig` (alias `tutorId`)
- [x] `adk/tutor_resolution.py` — resolve tutor → (persona, framework, interaction_style); the tutor's values win, and each falls back to today's independent field when no tutor is set
- [x] `inject_framework_preamble` + the persona/voice chain both read through it — one join, not two

**Acceptance:** no `tutor_id` ⇒ byte-identical composition; a tutor with a framework injects it; a tutor's persona drives avatar and voice.

### M3 — API
**Scope:** backend · ~0.5d
- [x] `GET /api/tutors` — teacher-visible catalogue with resolved persona + framework summary
- [x] `POST /api/research/tutors` / `PUT` — researcher-authored tutors and variants (`assert_researcher`)
- [x] `tutor_id` accepted on the activity-config write path

### M4 — The teacher picker
**Scope:** frontend · ~0.75d
- [x] `TutorPicker` — card list reusing `ClassPersonaPanel`'s visual language: avatar, name, and a plain-language second line ("warm · question-and-use cycle")
- [x] Frameworks appear under **plain-language names**, never bare acronyms — "Question-and-use cycle (ESRU)"
- [x] "What is this tutor told to do?" disclosure showing the real composed instruction
- [x] Mounted in the activity builder; the persona + style controls fold into it

### M5 — Variants for researchers
**Scope:** fullstack · ~0.5d
- [x] "Create a variant" from the tutor picker and from `/teacher/research/frameworks`
- [x] Variant editor: name, persona, framework, style, with lineage shown

### M6 — Migrate the four SKILL.md tutors (M7 in the design doc)
**Scope:** backend · ~0.75d
- [x] `concept-dialogue`, `kinebot-kinematics-tutor`, `led-planck-tutor`, `problem-set-hints` become base tutors
- [x] The other four templates (`manage-class`, `analytics-chat`, `activity-authoring-assistant`, `aipla-help`) are teacher tools and are **not** tutors — they stay as they are

## What changed during execution — recorded

1. **The picker is CLASS-level, not in the activity builder.** The chosen mockup put it in the
   activity form; 1.1.32 Q4 had already put identity in class settings, and
   `InheritedPersona`'s docstring records why — *"a duplicate per-activity picker (the old
   co-equal grid was problem 4 of teacher-ux-refinement.md)"*. Building it as drawn would have
   re-created a known UX problem. `ActivityConfig.tutor_id` exists as the override, unsurfaced.
2. **It REPLACED the persona panel; it did not join it.** The first cut mounted both and called
   the persona panel "the finer control". That was two lists of the same six identities, was
   reported from production, and was fixed in `d05500d2`. `ClassPersonaPanel` is deleted; the
   "How teaching styles are enforced" transparency was extracted and kept.
3. **`Tutor.skill_name` was added** — the schema gap M7 exists to find. See the design doc.
4. **Two bugs of one shape.** Firestore's `__id` broke `extra="forbid"` validation so authored
   tutors silently vanished from the catalogue, and a bare `except Exception` swallowed it.
   Malformed rows now log with their id. Worth remembering: this is the reassuring-wrong-answer
   footgun, written by someone who had documented it in the deploy runbook the same day.

## Out of scope
- Preview / side-by-side comparison (design doc M3) and the researcher cross-view (M4).
- The clash gatekeeper (M6) — a tutor now owns both style and framework, so the commonest clash is gone by construction.
- Retiring `ActivityConfig.persona` / `interaction_style`. They stay as the fallback path; removing them is a later cleanup once no activity uses them.

## Success criteria
- [x] A teacher makes ONE choice and gets avatar + voice + tone + pedagogy.
- [x] An activity with no tutor behaves exactly as before this sprint.
- [x] Frameworks are never shown to a teacher as a bare acronym.
- [x] A researcher can create a variant with lineage without touching git.
