# Sprint COPILOT-1 — activity-authoring co-pilot (1.1.39 M0 + 1.1.50 M0–M1)

**Design:** [activity-authoring-assistant.md](activity-authoring-assistant.md) (1.1.39) + [authoring-teaching-framework.md](authoring-teaching-framework.md) (1.1.50)
**Created:** 2026-06-26 · **Branch:** `dev` (commit straight to dev)
**Goal:** a teacher chats beside the builder and the AI proposes a Socratic lesson prompt that the teacher Applies into the activity — built against a **placeholder teaching-framework** behind a teacher-tier dark flag (AR/JB content + Aswin's meta-prompt are the human gates; the real prompt is a one-config swap).

## The basis is shipped (why this is mostly wiring)

| Need | Precedent / shipped |
|---|---|
| Teacher-only tool-using AG-UI skill | **`analytics-chat`** — `accessControl: tagged role:teacher`, `metadata.tools: [...]`, `metadata.model` |
| Teacher-auth AG-UI chat mount | **`_AnalyticsChat.tsx`** — `<AGUIProvider skillId useTeacherAuth>` + slug→UUID resolve (the auth corner, solved) |
| FunctionTool registration | analytics-chat's `count_messages`/… tools in `adk/tools.py` |
| Owner-scoped write target | `ActivityUpsert` / `create_activity` / `save_activity`; tools read `tool_context.state["user:id"]` |
| Palette to assemble | `ELEMENT_REGISTRY` (1.1.38, shipped) |
| Role gate for the framework | `role:researcher` (1.1.5, shipped) |

## Milestones

| MS | Scope | Deliverable | Est | Gate |
|---|---|---|---|---|
| **M0** | backend | **Skill + framework-as-a-layer.** `backend/skills/templates/activity-authoring-assistant/SKILL.md` (teacher-only `accessControl`, capable model, the **starter teaching-framework** = placeholder system prompt + structure-rubric framing as its instruction). Framework default + a `TEACHING_FRAMEWORK` registry constant (1.1.50 M0). Behind a teacher-tier dark flag. | ~0.5d | seed note |
| **M1** | backend | **`set_lesson_prompt` authoring write-tool.** Owner-scoped FunctionTool: reads `user:id` from `tool_context.state`, loads the activity, **denies if not owner** (404), returns a **proposal** (does NOT auto-persist — the teacher Applies on the FE). Wired into the skill's `tools`. Declarative-only (no code-gen). | ~0.75d | none |
| **M2** | backend | **Structure-rubric + eval scaffold.** The 1.1.50 rubric as a checkable artefact (rubric lines as data) + an eval scaffold that scores a draft against the current framework version (the 1.1.39/1.1.50 eval gate; AR owns the real scoring key). | ~0.75d | AR scoring key (real bar) |
| **M3** | frontend | **Teacher-auth chat panel + A2UI accept/edit card.** Model on `_AnalyticsChat.tsx`: `<AGUIProvider skillId useTeacherAuth>` in the builder behind the dark flag; proposal → Apply/Edit/Dismiss card; **Apply** mutates `teachingGoal` via the shipped save path; builder fully usable with the assistant disabled (degradation). Browser-verify is the remaining gate. | ~1.5d | — |

**Execution order:** M0 → M1 → M2 (backend foundation, fully testable) → M3 (frontend, browser-verify deferred). Backend milestones land + commit independently; M3 may carry to a follow-up session (sprint JSON tracks it).

## Acceptance (per milestone)

- **M0:** the `activity-authoring-assistant` skill loads; `accessControl.type == tagged` with `role:teacher`; the framework default + `TEACHING_FRAMEWORK` constant are present; the framework is injected as the agent's instruction. BE lint + test-fast green.
- **M1:** `set_lesson_prompt` rejects a non-owner (404/deny) and returns a well-formed proposal for the owner; the tool never persists directly; declarative-only assertion. Owner-scoping test is the headline.
- **M2:** the structure rubric is well-formed (each line has id + check); the eval scaffold runs and scores a fixture draft against the rubric (placeholder bar, AR sign-off pending).
- **M3:** the chat panel mounts with `useTeacherAuth` (auth-corner regression guard — a group token is NOT minted); the card renders Apply/Edit/Dismiss; Apply mutates the draft and only then persists; the builder works with the assistant disabled. FE quality:check green.

## Human gates (not blocking the wiring)

- **AR/JB — the teaching-framework content** (the real system prompt + structure rubric). M0 ships a placeholder; swap is one config edit.
- **AR — eval scoring key** (M2 real bar).
- The whole feature stays behind the **teacher-tier dark flag** until the framework lands (Axiom 5: the manual builder is unaffected).

## Quality gates

- Backend: `cd backend && make lint && make test-fast` (CI parity) after each backend milestone.
- Frontend: `npm run quality:check` after M3.
- Seed: M0 adds a SKILL.md template → `make seed ENV=dev` after deploy (the recurring gotcha; CI `seed-reminder` warns).
