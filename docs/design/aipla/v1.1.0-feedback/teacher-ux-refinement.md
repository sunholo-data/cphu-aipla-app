# Teacher UX refinement — collapse the activity / sim / persona / difficulty sprawl

**Status:** Planned (P1, design-doc stage) — **refinement / correction doc** prompted by M's 15-June live critique of the teacher surfaces
**Last Updated:** 2026-06-15
**Priority:** **P1 — coherence before the pilot.** The teacher build shipped feature-by-feature (1.1.12 personas, 1.1.19 authoring, 1.1.20 interaction styles, 1.1.25 materials, 1.1.26 UI consolidation, 1.J workbench types) and accreted **five overlapping levels** — teacher → class → persona → activity → sim — each with settings that overlap or contradict. M can't tell what the Activities page is for, where prompts are set, why a sim doesn't match an activity, or what "difficulty" does. This is the opposite of the breadth-over-depth bet's promise (`aipla-breadth-over-depth`): degrees of freedom without a coherent mental model.
**Estimated:** ~3–4d for the pre-pilot slice (Phase A); the activity-reuse refactor (Phase B) is ~3–5d post-pilot.
**Scope:** Fullstack, mostly frontend wiring + one backend honesty fix (workspace reads the activity, not the slug) + removing/hiding dead controls. No new data store.
**Dependencies:** Amends [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19), [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26), [tutor-personas.md](tutor-personas.md) (1.1.12) + [voice-personas.md](voice-personas.md), [tutor-personas-sprint.md](tutor-personas-sprint.md) (1.1.20 interaction styles), [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J), [curriculum-library.md](curriculum-library.md) (1.1.25 materials). Sequence AFTER those (they exist; this rationalises them).
**Source:** [june-15-feedback.md](june-15-feedback.md) (the structural critique under "Activities UI makes no sense" — beyond the itemised disposition map) + M live, 15 June.

> **This is a coherence doc, not a feature doc.** It adds almost no new capability; it removes degrees of freedom and makes the remaining ones legible. The win is a teacher mental model that fits on one screen, not more knobs.

## Problem

The teacher surfaces accreted five levels, each shipped by a different sprint, with overlapping or dead settings. M's 15-June critique, verified in code:

| # | Problem | Evidence (file:line) |
|---|---|---|
| 1 | **Activities can't be reused across classes, but the UI implies they can.** An activity is keyed `activity_configs/{teacher_uid}:{class_id}:{activity_id}` — it's *per-class*. Yet the Activities list spans classes and each row has an "Open class" button, implying one activity ↔ many classes. There's no reusable template. | `backend/db/models/activity_config.py:70,112` · `frontend/src/app/teacher/activities/page.tsx` |
| 2 | **The "Paired workbench" dropdown is a lie.** The student workspace picks the sim from the **skill slug** (`SIM_WORKSPACE_SLUGS`), and *ignores* the activity's `paired_workbench`. So setting "Boldkast" on a concept activity does nothing. | `frontend/src/app/chat/[...path]/workspaceContent.ts:11-33` · `activity_config.py` (`paired_workbench` stored, never read by workspace) |
| 3 | **A 4th level of sprawl: sim ≠ activity.** Sims (Boldkast/LED-Planck/KineBot) are *skills* (lessons); concept activities use the `concept-dialogue` base skill. They live in different lists and don't marry. M wants **activity ↔ sim 1:1**. | `workspaceContent.ts` (3 hardcoded slugs) vs `concept-dialogue` activities |
| 4 | **`interaction_style` is set in two places.** Persona carries a style; the activity also has a `interaction_style` field; picking a persona *writes its style onto the activity at save* with no live link. Editing the persona later doesn't update the activity. | `frontend/.../activities/new/page.tsx:95-100` · `backend/adk/interaction_style.py:74-82` |
| 5 | **`difficulty` is a dead, unexplained control.** `standard\|guided` is settable on the activity and shown in lists, but **no backend code reads it** — it changes nothing. It's also unexplained in the UI, and M believed (incorrectly) it was also on the persona — i.e. it actively *creates* a false mental model. | `activity_config.py:83` (stored) · grep: no consumer |
| 6 | **No teacher preview.** "Preview as student" is disabled ("Phase 3"), so a teacher can't open their own activity as a chat to see what they built. | `frontend/.../activities/[id]/page.tsx` (disabled button) |
| 7 | **Teacher activities and student lessons are the same `skill_id` with no distinction.** Once configured + added to a class's `lessons`, a teacher activity is just a lesson; there's no "this is mine to edit" vs "this is what students run" framing. | `Class.lessons` (skill_ids) · `frontend/src/app/lessons/page.tsx:156` |
| 8 | **Prompts come from 3–4 places with no map.** Skill `instructions` (us) + activity `teaching_goal` (`{teacher_focus}`) + interaction-style preamble (persona *or* activity) + persona `voice_prompt` + materials grounding — all composed at agent build. A teacher has no single answer to "where do I change how the tutor behaves?" | `backend/adk/agent.py` instruction chain · `teacher_focus.py` · `interaction_style.py` |

**Net effect:** the model is `teacher × class × persona × activity × sim` with overlapping settings — many degrees of freedom, no spine. M's ask: **marry activity and sim 1:1, make persona its own thing, make the three prompt levels explicit, and kill the dead difficulty knob.**

## Goals

**Primary goal:** a teacher mental model that fits on one screen — *"I pick a **persona** (how it sounds + teaches), I write an **activity** (what to learn, optional sim, optional materials), I assign it to a **class** (who can run it)."* Three nouns, each owning a clear set of settings, no duplication, no dead controls, and the ability to **preview** before students see it.

**Success metrics:**
- A teacher can state, unprompted, where each setting lives (persona vs activity vs class) — no "do I juggle three places?".
- The sim a teacher picks on an activity is **the sim the student sees** (no slug decoupling).
- No control in the UI is a no-op (difficulty either does something or is gone).
- A teacher can open any activity they own as a student-style chat preview.

**Non-goals:**
- New tutor capabilities, new sims, or new analytics (those are 1.1.x rows elsewhere).
- Teacher-authored *personas* (still the static YAML catalogue, 1.1.12; custom personas are the v1.2 "Custom persona" card already stubbed).
- The full activity-reuse refactor in the pre-pilot slice — that's Phase B (post-pilot), scoped here but not built now.

## The target model (three nouns)

```
PERSONA  (how the tutor sounds + teaches)   — catalogue; set the CLASS default; activity may override
   ├─ avatar + name                          (display)
   ├─ voice + voice_prompt (1.1.12)           (Gemini-TTS direction)
   └─ teaching style (socratic/concise/…)     (interaction_style — OWNED here, not on the activity)

ACTIVITY (what students learn)               — the unit a teacher authors
   ├─ title + teaching goal ({teacher_focus}) (the one prompt a teacher writes)
   ├─ optional SIM (1:1, baked in)            (concept | boldkast | led-planck | kinebot — IS the workspace)
   ├─ optional materials (1.1.25)             (cited curriculum docs → grounding)
   └─ optional checklist                      (student-facing steps)

CLASS    (who can run it + roster)           — assignment + access
   ├─ assigned activities (was: lessons)      (which activities this class runs)
   ├─ default persona (1.1.12)                (the class identity; activity overrides)
   ├─ group codes / voice-in / recording      (access + capabilities)
   └─ voice override (advanced)               (rare; persona normally supplies voice)
```

**Prompt authorship — exactly three levels, made explicit in the UI:**

| Level | Owns | Who sets it | Teacher-facing label |
|---|---|---|---|
| **Skill** (us) | The fixed Socratic chassis (`SKILL.md instructions`, ≤3-sentence rule, etc.) | AIPLA team | *not shown — it's the engine* |
| **Persona** | HOW it speaks: teaching style + voice + voice direction | Teacher (catalogue pick) | "Tutor persona" |
| **Activity** | WHAT it teaches: teaching goal + cited materials | Teacher (free text + picker) | "Teaching goal" + "Materials" |

`interaction_style` stops being an independent activity field — the **persona owns it**. (An explicit per-activity style override can live behind an "Advanced" disclosure, clearly labelled "overrides the persona's style", so the default path has one source of truth.)

## Design

### Phase A — pre-pilot coherence (this slice, ~3–4d)

1. **Sim ↔ activity, honestly (problem 2/3).** The chat workspace reads the **activity's** `workbench_type` / `paired_workbench` to choose the sim, instead of the hardcoded `SIM_WORKSPACE_SLUGS` slug map. The activity-creation form chooses the activity's *kind* up front — **Concept (chat-only) | Boldkast | LED Planck | KineBot** — and that choice IS the workbench (1:1). The "Paired workbench" dropdown disappears as a separate, decoupled control. Boldkast/LED/KineBot stop being separately-addable "lessons" that compete with concept activities — they become activity kinds. (Workspace decision becomes: `workspaceFor(activityConfig)`, not `workspaceFor(slug)`.)

   > **Implementation note (Phase A shipped, 2026-06-15).** The honest fix turned out to be *narrower* than "thread `workbench_type` into the workspace decision." A sim **is the skill it runs** — `problem-set-hints`→Boldkast, `led-planck-tutor`→LED, `kinebot-kinematics-tutor`→KineBot are three distinct skills, each with its own instructions + artefact, and the chat page dispatches the specific sim on the **skill slug** (it has to — the components differ). A `concept-dialogue` activity therefore *cannot* render a sim no matter what `paired_workbench` says; wiring the config field to the workspace would only have turned a silent no-op into a blank pane. So Phase A **removed the lying "Paired workbench" control** from both activity forms (the actual UX lie M hit) and replaced it with an honest note — "a simulator is the tutor it runs, not a setting you attach here." `paired_workbench` stays on the model (legacy rows still backfill `workbench_type="app"`); the slug registry stays as the truthful "which skills render a sim" set, now documented as such in `workspaceContent.ts`. True activity↔sim 1:1 — letting an authored activity *be* a sim — lands in **Phase B** (an activity becomes a sim by binding to the sim's skill, not by a decoupled pointer). Net: the coherence win (no mismatched-sim knob) without the risky workspace rewrite.
2. **Personas as their own settings surface (problem 4, M's ask).** A dedicated "Tutor personas" section (reuse the redesigned `ClassPersonaPanel`) is where the **class default** is set, with the style + voice + bio shown per card (already built 2026-06-13). The activity form shows the **inherited** persona read-only with a single "Override for this activity" affordance — not a second co-equal picker. Remove the duplicated `interaction_style` dropdown from the activity form (persona owns style); keep it only behind an "Advanced" disclosure.
3. **Kill the dead difficulty knob (problem 5).** Remove `difficulty` from the teacher UI (it's consumed nowhere — showing it is anti-transparent, Axiom 2). Keep the field in the model (no migration) but stop surfacing it until it maps to a real behaviour. **Follow-up option (noted, not built):** if we want it, `guided` injects a scaffolding preamble (same mechanism as interaction styles) — then it earns its place. Until then it's gone from the form.
4. **Teacher preview (problem 6).** Enable "Open as student" on an activity: starts a teacher-owned preview chat session against the activity's resolved config (persona + goal + sim + materials), so the teacher sees exactly what students get. Uses the existing chat surface with the teacher's Firebase identity; no new endpoint (the chat page already accepts a skill + session).
5. **A one-line "where settings live" explainer** at the top of the activity form and the class settings, mapping the three nouns (the table above) — so the mental model is stated, not inferred.

### Phase B — activity reuse (post-pilot, scoped not built, ~3–5d)

6. **Decouple activity definition from class (problems 1/7).** Today config is keyed per `(teacher, class, activity)`. Target: an **activity template** owned by the teacher (definition: goal + sim + persona override + materials + checklist), and a separate **assignment** binding a template to one or more classes. The Activities page becomes the teacher's template library; the class page lists *assigned* templates. This removes the per-class duplication and makes "Open class" coherent (assignment, not ownership). Migration: the current composite-keyed configs become templates keyed by `(teacher, activity)` with a join table for class assignment; existing rows backfill one template per distinct `(teacher, activity)` taking the most-recent config. Deferred post-pilot because it touches the storage key + the student resolution path (`resolve_active_config`).

### CLI surface

- `aiplatform activity preview <activity_id> --class <id>` — mint a teacher preview session + print the chat URL (parity with the new "Open as student" button; ops/eval can drive previews headless). Backlink: [local-dev-cli](../../v6.1.0/local-dev-cli.md).

## API / behaviour changes

| Surface | Change | Phase |
|---|---|---|
| Chat workspace selection | Read sim from the activity config (`workbench_type`/`paired_workbench`), not the skill slug | A |
| `GET /api/activity-configs/active/{id}` | Already returns `workbenchType` — frontend `workspaceContent` consumes it instead of the slug map | A |
| Teacher activity form | Remove `difficulty` + standalone `interaction_style`; persona inherited read-only + override disclosure | A |
| Teacher preview | "Open as student" → teacher-owned chat session on the activity's resolved config | A |
| Activity templates + class assignment | New template/assignment split (storage-key change) | B |

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | UX wiring; no new latency. |
| 2 | EARNED TRUST | +1 | **Removing the dead difficulty knob + the lying paired-workbench dropdown is a direct trust win** — every control now does what it says. Teacher preview lets a teacher verify before students run it. |
| 3 | SKILLS, NOT FEATURES | +1 | Collapses `teacher×class×persona×activity×sim` toward three legible nouns; sim becomes part of the activity (a skill affordance), not a separate level. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | No model-selection change. |
| 5 | GRACEFUL DEGRADATION | +1 | Reading the sim from the activity (vs slug) means an unconfigured activity degrades to chat-only cleanly; preview reuses the resilient chat surface. |
| 6 | PROTOCOL OVER CUSTOM | 0 | No new format; reuses existing config + chat surfaces. |
| 7 | API FIRST | +1 | Preview gets a CLI command; the workspace decision moves to a single `workspaceFor(config)` consumed by every client. |
| 8 | OBSERVABLE BY DEFAULT | 0 | No telemetry change. |
| 9 | SECURE BY CONSTRUCTION | 0 | No new data access; teacher preview uses the teacher's own identity + existing access checks. Phase B's template/assignment split keeps the same class-tag ACL. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Sim selection logic moves off "frontend knows the slug map" toward "config says what the workbench is" — the client renders what the config declares. |
| 11 | USABLE BY DESIGN | +1 | **The headline.** One-screen mental model, no dead controls, no duplicated settings, explicit prompt levels, preview before publish. |
| | **Net Score** | **+6** | Threshold ≥ +4. No −1s. |

## Standards compliance

- No new format. Reuses ADK skills (`SkillConfig`), the existing `ActivityConfig`, the chat/AG-UI surface, and the 1.1.12 persona catalogue. The Phase-B template/assignment split is a storage refactor of existing models, not a new protocol.
- Teacher preview reuses the existing chat session path (no new endpoint) — Axiom 6.

## Migration

- **Phase A:** no data migration. `difficulty` stays in the model (hidden in UI); `interaction_style` stays (persona-driven; advanced override only). Workspace-selection change is frontend-only (reads a field already returned by `/active/{id}`).
- **Phase B:** activity templates + class-assignment split — backfill one template per `(teacher, activity)` from the most-recent per-class config; a join table for assignments. Rollback = keep reading the composite-keyed configs.

## Testing strategy

- **Frontend (vitest):** activity form shows persona inherited + override disclosure (no standalone style/difficulty); workspace renders the sim declared by the activity config (concept→none, boldkast→sim); preview button opens a chat session.
- **Backend (pytest):** `workspaceFor(config)` mapping; preview session creation uses the teacher identity + passes access checks; Phase B template/assignment resolution.
- **E2E (LOCAL_MODE):** create activity (pick Boldkast) → preview as teacher → assign to class → student join sees the same sim + persona.

## Open questions

- **Q1 — difficulty:** remove entirely, or wire `guided` → scaffolding preamble now? Recommend remove from UI in Phase A; reintroduce only if it maps to behaviour (decide with AR — does "guided" mean more scaffolding, or a different model tier?).
- **Q2 — activity reuse timing:** is the Phase-B template/assignment split worth doing before the pilot, or does per-class config survive the pilot? Recommend defer (the pilot is small; the storage-key change is risky pre-pilot).
- **Q3 — sim-as-activity-kind:** do we still let a class add Boldkast/LED/KineBot as standalone lessons (for the curated-sim-library framing, 1.I), or only as activity kinds? Recommend: a sim is always reached *through* an activity (even a zero-config one), so there's one path.
- **Q4 — persona override on activity:** keep the per-activity persona override at all, or is class-default-only simpler for the pilot? (M's "do we juggle three places" suggests fewer is better — consider class-only for v1, activity-override post-pilot.)

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Workspace-from-config change breaks the 3 shipped sims | Medium | The config already carries the workbench; map every existing sim slug → workbench kind in one table; vitest per sim; the 3 sims are the test fixtures |
| Removing difficulty/style controls surprises a teacher mid-pilot | Low | Pre-pilot change; nothing consumed difficulty so no behaviour change, only a cleaner form |
| Phase B storage refactor slips into the pilot window | Medium | Explicitly post-pilot; Phase A delivers the coherence win without the risky key change |

## Success criteria

- [ ] Activity form shows: title, teaching goal, **kind/sim (1:1)**, materials, checklist, **inherited persona (read-only + override)** — no standalone difficulty, no co-equal style picker.
- [ ] The sim a teacher picks is the sim the student sees (workspace reads the activity config, not the slug).
- [ ] No no-op control remains in the teacher UI.
- [ ] "Open as student" preview works for any owned activity.
- [ ] A one-line "where settings live" explainer is present on the activity + class-settings surfaces.
- [ ] `aiplatform activity preview` works end-to-end.
- [ ] (Phase B) an activity template can be assigned to ≥2 classes without re-authoring.
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green.

## Related documents

- [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19) — the authoring surface this rationalises; `materials` + checklist + workbench live there
- [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26) — the primitives + nav this builds on
- [tutor-personas.md](tutor-personas.md) + [voice-personas.md](voice-personas.md) (1.1.12) — persona model + the 2026-06-13 transparency redesign (style chip + bio + Default badge)
- [tutor-personas-sprint.md](tutor-personas-sprint.md) (1.1.20) — interaction styles (the field this stops duplicating on the activity)
- [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J) — workbench type system the sim-kinds map to
- [curriculum-library.md](curriculum-library.md) (1.1.25) — materials picker now in the activity form (shipped)
- [june-15-feedback.md](june-15-feedback.md) — the 15-June index this structural critique extends
- `aipla-breadth-over-depth` (memory) — the steer this serves: coverage with a coherent model, not knobs
