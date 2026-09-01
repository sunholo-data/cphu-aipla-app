# Tutor verbosity fix — prompt-only length + question-ending constraint

**Status:** Planned (P0 immediate)
**Last Updated:** 2026-06-03
**Priority:** **P0** — flagged at the 3 June teacher check-in. Teachers report tutor responses are too long; students skim instead of engaging
**Estimated:** ~2h
**Scope:** Backend skill templates only — system-prompt delta. No code changes
**Dependencies:** None. AR sign-off on the rewritten preamble before merge
**Source brief:** [`june-03-feedback-sprint-brief.md` §1](../../_scoping-snapshot/prototypes/june-03-feedback-sprint-brief.md)

## Problem

Teachers at the 3 June check-in flagged that current tutor turns are too long. Students skim multi-paragraph explanations rather than engaging with them. Pedagogically, the Socratic loop the tutors are *meant* to drive needs short turns ending in a question, not lectures.

## Change

Add an explicit length + question constraint to the **shared preamble** used by every skill's system prompt. Apply to Boldkast, LED Planck, KineBot at minimum (the three artefact-coupled tutors). Existing per-skill `## Opening`, `## Idle nudge`, DRA blocks remain unchanged.

**The constraint:**

> Maximum 3 sentences per response unless the student explicitly asks for a longer explanation (e.g. "explain in detail", "give me the full derivation"). Every response must end with a question that invites the student to act, predict, or describe. Do not produce multi-paragraph explanations unprompted.

## Where it lives

Three options for "the shared preamble":

1. **Per-skill SKILL.md preamble** (current state) — copy the block into each skill's SKILL.md
2. **Skill template base** in [backend/skills/templates/](../../../../backend/skills/templates/) shared across all v1 physics skills — one source of truth
3. **`compose_instruction_providers` chain** in [backend/adk/agent.py](../../../../backend/adk/agent.py) — programmatic injection

**Recommendation: option 2 if a shared template already exists; otherwise option 1.** Option 3 is over-engineered for a literal-string constraint that AR will iterate on directly.

Check [backend/skills/templates/](../../../../backend/skills/templates/) for a shared base file before duplicating into each SKILL.md.

## Files to touch

| File | Change | Owner |
|---|---|---|
| Shared skill preamble (option 2) **or** each of: `backend/skills/templates/boldkast/SKILL.md`, `backend/skills/templates/led-planck/SKILL.md`, `backend/skills/templates/kinebot/SKILL.md` | Add the constraint block at the top of the system prompt | M |
| `backend/skills/templates/problem-set-hints/SKILL.md` (and any other v0.1 skill still in tree) | Same constraint applied | M |
| `backend/tests/skills/test_skill_prompts.py` (or equivalent) | Assert the constraint string is present in each skill's resolved system prompt | M |

## Acceptance

- [ ] AR-approved final wording of the constraint block (Danish + English context noted — the wording itself is English because it's a system-prompt instruction, not student-facing copy)
- [ ] All three artefact-coupled skills (Boldkast, LED Planck, KineBot) carry the constraint
- [ ] A LOCAL_MODE chat session with Boldkast: the first five tutor turns are each ≤3 sentences and end with a `?`
- [ ] A counter-test: student says "explain in detail" → the next turn is allowed to be longer
- [ ] One pytest case asserts the constraint string is present in each skill's compiled prompt (so a future template refactor can't silently regress it)
- [ ] No backend code changes; `make lint` + `make test-fast` green from the prompt update alone

## Out of scope

- Auto-trimming responses post-hoc (e.g. server-side truncation) — pedagogically worse than just instructing the model
- Programmatic token caps on the model call (`max_tokens=120`) — risks mid-sentence cutoff; the prompt-side constraint is strictly better at this scale
- Per-skill tone variations (Danish stx vs NCERT) — the length + question rule is universal; tone stays per-skill in the existing `## Opening` and per-skill `## Idle nudge` sections
- A2UI form for AR to tune the prompt — direct SKILL.md edit + PR is the right loop until friction forces a UI

## Notes

This is a 2-hour change that the team should not over-engineer. The brief's framing is "system prompt only" and that boundary should be respected. The mistake to avoid is conflating this with model-side or middleware-side enforcement — start with the cheapest mechanism (prompt instruction) and only escalate if the model demonstrably ignores it after a real session.

If after a week of pilot sessions the model is still producing >3-sentence turns despite the constraint, the next escalation is **few-shot examples in the preamble** showing a ≤3-sentence answer ending in a question, not server-side enforcement.

## Related

- [proactive-sim-reactive-tutor.md](proactive-sim-reactive-tutor.md) — also flagged at 3 June; the sim-reactive tutor's short-observation-plus-question shape inherits this constraint
- [proactive-tutor.md](../../v1.0.0-pilot/proactive-tutor.md) — Phase A auto-greet's `## Opening` block already says "keep your first turn to ~2-3 sentences"; this constraint generalises that rule
