# Sprint COPILOT-2 — co-pilot configures the workbench (1.1.39 M1–M2, rescoped)

**Design:** [activity-authoring-assistant.md](activity-authoring-assistant.md) (1.1.39, corrected 2026-06-26) + [authoring-teaching-framework.md](authoring-teaching-framework.md) (1.1.50)
**Builds on:** sprint **COPILOT-1** (set_lesson_prompt tool + the teacher-auth panel + the Apply card — all shipped, dark-flagged)
**Created:** 2026-06-26 · **Branch:** `dev`
**Goal:** the co-pilot helps configure the **workbench** — propose **workspace elements** (checklist/table/chart/calculator) and a **vetted sim** — through the same owner-scoped, propose-only, Apply-card pattern as M1.

## ⚠ Rescope note — what changed vs the original 1.1.39 M1–M2

1.1.39 (2026-06-17) listed **`set_workbench_type(type)`** (`none`/sim/notebook). **That is retired** — `workbenchType` is now a *derived/internal* field (`app` when there's an `artefactId`, else `none`), the builder has **no type picker** (`useActivityBuilder.ts`: *"No longer teacher-chosen"*), and `drawing/sensor/video/notebook` never shipped (`document` is deprecated → an element). So this sprint **drops `set_workbench_type`** and configures the workbench through the **real** teacher choices:

| Real teacher choice | Tool | Apply target | Validation |
|---|---|---|---|
| A **sim** | `set_artefact(artefactId)` | `builder.setArtefactId` (derives `workbenchType=app`) | `is_known_artefact` / `GET /api/artefacts` catalogue |
| A **workspace element** | `add_element(kind, spec)` | `builder.setChecklist/setTable/setChart/setCalculator` | `ELEMENT_REGISTRY` (kind + caps, 1.1.38) |

## Milestones

| MS | Scope | Deliverable | Est | Gate |
|---|---|---|---|---|
| **M0** | fullstack | **Generalize the proposal pipeline.** Standardize the proposal envelope `{kind, ...}`; generalize the FE `parseLessonProposal` → `parseProposal(tc)` dispatching on `kind`; an **Apply router** mapping `kind` → builder setter. Refactor COPILOT-1's `set_lesson_prompt` + card onto the general path (behavior-preserving — existing tests stay green). | ~0.75d | — |
| **M1** | backend+fe | **`add_element` tool.** Owner-scoped, propose-only: proposes a palette element (checklist/table/chart/calculator) validated against `ELEMENT_REGISTRY` (known kind + within cap). The card renders an "add element" proposal; Apply calls the builder's element setter. Declarative-only; never persists. | ~1d | [1.1.38](activity-elements-palette.md) (✅ shipped) |
| **M2** | backend+fe | **`set_artefact` tool.** Owner-scoped, propose-only: proposes a **vetted sim** from the artefact catalogue (`is_known_artefact`). The card renders "use this sim"; Apply calls `setArtefactId` (derives `app`). | ~0.75d | artefact catalogue (✅) |
| **M3** *(optional)* | backend+fe | **`set_interaction_style` / `suggest_persona`.** The style layer (1.1.39 M1 remainder) — propose a teaching style/persona; Apply sets `interactionStyle`. | ~0.5d | — |

**Execution order:** M0 (the refactor unblocks M1/M2) → M1 → M2 → M3 (optional). Each is small once M0 lands — the new tools mirror `set_lesson_prompt` (~30 lines + tests each) and the card already exists; M0 just makes both generic.

## Acceptance (per milestone)

- **M0:** `parseProposal` dispatches on `kind`; the Apply router maps each kind to a builder setter; COPILOT-1's set_lesson_prompt flow is unchanged (its 8 FE + 6 BE tests stay green). The proposal envelope is documented.
- **M1:** `add_element` rejects a non-owner (denial shape) and an unknown/over-cap kind; returns a well-formed proposal for the owner; never persists. The card's Apply adds the element to the builder draft. Owner-scoping + registry-validation are the headline tests.
- **M2:** `set_artefact` rejects a non-owner and an unknown artefact id (`is_known_artefact`); proposes a vetted sim; Apply sets `artefactId`. The framework's `formative_checkpoint`/sim cues steer the co-pilot here.
- **M3:** `set_interaction_style` proposes a valid style; Apply sets `interactionStyle`.

## Reuse (the basis is all shipped)

- **The tool pattern** — `set_lesson_prompt` (COPILOT-1 M1): `_caller_uid` + owner-check + propose-only + `TOOL_REGISTRY`. New tools are instances of it.
- **The Apply card** — COPILOT-1 M3's `ProposalCard` already does Apply/Edit/Dismiss; M0 generalizes the parse + Apply target.
- **The palette** — `ELEMENT_REGISTRY` (1.1.38) validates `add_element`; the builder element setters are the Apply targets.
- **The sim catalogue** — `GET /api/artefacts` + `is_known_artefact` for `set_artefact`; `SimPicker` is the existing UI precedent.
- **The framework** — the M2 rubric's `formative_checkpoint` line should steer the co-pilot to `add_element('checklist')`; closing the loop the framework promised.

## Human gates (unchanged from COPILOT-1)

- **AR/JB framework content** — still the quality gate; the new tools inherit the dark flag (`NEXT_PUBLIC_AUTHORING_COPILOT`).
- **Browser-verify** — the live Apply round-trips for element-add + sim-set (unit tests cover the wiring).

## Quality gates

- Backend: `cd backend && make lint && make test-fast` after each backend milestone.
- Frontend: `npm run quality:check` after M0 (the card refactor) + each FE milestone.
- New tools → `metadata.tools` in the authoring SKILL.md → `make seed ENV=dev` after deploy.
