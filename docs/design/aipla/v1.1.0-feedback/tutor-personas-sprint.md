# Sprint Plan: PERSONA-1 — tutor interaction personas (1.1.20)

## Summary

Ship per-activity **interaction-style presets** (`socratic` default / `concise` / `rigorous` / `warm`) from [tutor-personas.md](tutor-personas.md). A teacher picks a style on an activity; the tutor's voice changes at runtime. First feature to land into the 1.1.26 design-system pattern.

**Duration:** ~1.5–2 days · **Scope:** Fullstack · **Design Doc:** [tutor-personas.md](tutor-personas.md)
**Gate:** AR sign-off on the `concise` / `rigorous` / `warm` prompt wording (stubbed in this sprint; socratic needs no sign-off).

## Scoping decision — override, not extract (records a deviation from the doc)

The design doc's mechanism was "extract the Socratic block out of the three tutor SKILL.md files into `socratic.md` and inject it for every turn." Grounding revealed two risks:
1. Injecting the socratic block for **every** tutor turn changes the runtime prompt for all existing tutors — high blast radius if the injector misbehaves.
2. The Boldkast tutor (`problem-set-hints`) embeds the constraint inside its templates, not as the standalone block kinebot/led-planck share — so extraction isn't clean across all three.

**Decision (lower-risk first cut):** `socratic` is the **untouched default** — no injection, SKILL.md files unchanged, **zero regression to existing tutor behavior**. Only the non-default styles (`concise`/`rigorous`/`warm`) inject an **override preamble** that explicitly countermands the Socratic "end with a question" rule. The socratic extraction + de-dup (making `socratic.md` the single source of truth, moving the 1.1.1 guard onto the composed instruction) is deferred to a **noted follow-up** — which the design doc itself frames as a "clean follow-through on 1.1.1," not the core feature. This delivers the teacher-facing picker with no risk to the shipped tutors.

## Milestones

### M1 — Backend: field + override injection + telemetry
**Scope:** backend · ~0.75–1d
- [ ] `interaction_style: Literal["socratic","concise","rigorous","warm"] = "socratic"` on `ActivityConfig` (`backend/db/models/activity_config.py`, alias `interactionStyle`) + default on `SkillConfig` (`backend/db/models/__init__.py`)
- [ ] `backend/skills/preambles/interaction_style/{concise,rigorous,warm}.md` — override preambles (AR-stub content + behavioral spec); plus a `socratic.md` placeholder for the future extraction (not injected this sprint)
- [ ] `inject_interaction_style_preamble(instruction, activity_id, group_tags)` in `backend/adk/` — resolves the active `ActivityConfig` (mirrors `inject_teacher_focus` / `resolve_active_config`); for non-socratic styles, appends the override preamble; socratic → passthrough. Wire into `compose_instruction_providers` (`backend/adk/agent.py`) at the innermost step.
- [ ] OTel `tutor.interaction_style` span attribute (`backend/adk/proactive_telemetry.py` pattern; safe-to-call)
- [ ] Tests (pytest): field round-trip + alias; injector picks the right variant; socratic → unchanged instruction (passthrough); concise → composed instruction contains the no-question override; unknown style → socratic fallback; existing 1.1.1 guard still green (SKILL.md untouched)

**Acceptance:** a tutor turn under `interaction_style=concise` composes an instruction containing the directive/no-question override; `socratic` composes byte-identical to today; `make lint` + `make test-fast` green.

### M2 — Frontend: builder picker + wiring
**Scope:** frontend · ~0.5d
- [ ] `InteractionStyle` type + field on `ActivityConfigPayload` + `ActivityConfigUpsert` (`frontend/src/lib/teacherApi.ts`)
- [ ] `INTERACTION_STYLE_OPTIONS` + state + a `Field` dropdown in the activity builder (`/teacher/activities/new`), beside language/difficulty; pass to `saveActivityConfig`
- [ ] Helper copy per preset (Socratic — guides with questions / Concise — terse, directive / Rigorous — exam-level / Warm — encouraging)
- [ ] Tests (vitest): picker renders 4 options, defaults Socratic, includes `interactionStyle` in the saved payload
- [ ] (If low-effort) `aiplatform activity new --style` CLI flag

**Acceptance:** builder shows the Teaching-style dropdown (default Socratic); saving an activity sends `interactionStyle`; `npm run quality:check` green.

## Out of scope / follow-ups
- **Socratic extraction + de-dup** (remove the block from kinebot/led-planck SKILL.md, make `socratic.md` canonical, move the 1.1.1 guard onto the composed instruction). Noted follow-up.
- Student in-session style override (design doc stretch).
- AR's final prompt wording for concise/rigorous/warm (sprint ships stubs + behavioral spec; AR fills wording).

## Success criteria
- [ ] Teacher sets `interaction_style` on an activity (builder + CLI); persisted with camelCase alias.
- [ ] `concise` produces terse/no-trailing-question turns (composed-instruction test); `socratic` unchanged.
- [ ] `tutor.interaction_style` in OTel; unknown style falls back to socratic.
- [ ] Backend `make lint`+`make test-fast` + frontend `npm run quality:check` green.
