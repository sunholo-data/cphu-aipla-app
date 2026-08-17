# Question-set element — one instrument for self-assessment, AI-performance survey, and the graded quiz

**Status**: **OPEN (design) 2026-08-17** — 1.1.78. Supersedes [exit-ticket.md](exit-ticket.md) (1.1.8) and re-homes [teacher-activity-authoring.md](teacher-activity-authoring.md) M2 (the 1.1.19 form quiz, designed 2026-06-08, never built).
**Priority**: **P1** — the platform has no way for a student to answer a structured question. Three separately-designed instruments (1.1.19 M2 quiz, 1.1.8 exit ticket, 1.1.57 M3 four-format quiz) have each been waiting on the same missing substrate.
**Estimated**: ~4–5d phased (M0 element + store + four tutor wirings ~1.5d · M1 builder + co-pilot + CLI ~0.75d · M2 answer key + grading ~1d · M3 session-end placement ~0.75d · M4 research capture ~0.5d)
**Scope**: Fullstack — `backend/db/models/activity_config.py` (element + registry + a new `ElementSpec.redact`) + `db/models/activity.py` + `protocols/activity_routes.py` (recipe step 1b) + `protocols/activity_config_routes.py` (recipe step 1c, the redaction hook) + `db/activity_configs.py` + a new `db/question_responses.py` + `protocols/question_response_routes.py` + `adk/element_manifest.py` + `adk/element_state.py` + `adk/authoring_tools.py` + `observability/chat_log.py` · `frontend/src/components/workspace/WorkbenchQuestionSet.tsx` + `elementRenderers.tsx` + `lib/elementTypes.ts` + `lib/activityElements.ts` + the builder editor + `_AuthoringCopilot.tsx` + `components/chat/SessionEndQuestions.tsx`
**Dependencies**: [1.1.38 activity-elements-palette](activity-elements-palette.md) (the registry + the add-element recipe this follows); [1.1.73 student-writing-element](student-writing-element.md) (**the per-group store idiom copied verbatim** — `writing_progress` + `writing_progress_routes` are the template); [1.1.62 workbench-element-awareness](workbench-element-awareness.md) (prompt-time presence); [1.1.69 tutor-sees-element-state](tutor-sees-element-state.md) (fill readers); [1.2 chat-log-pipeline](../v1.0.0-pilot/implemented/chat-log-pipeline.md) (the BQ sink M4 extends); ADR-001 (anonymous-group students). **Human gate on CONTENT only** — see *Human gates*.
**Created**: 2026-08-17
**Last Updated**: 2026-08-17
**Source**: M, 2026-08-17 — *"do we have a web component for the workbench that outputs quizes or scales? … for student assessment and/or surveys of the ai performance."* The answer was no, and the audit that followed found the capability half-built in four places at once.

---

## Why this exists

The question *"can a student answer a rating scale or a multiple-choice question?"* has been answered **no** for the whole project, while four separate designs assumed **yes**. The audit on 2026-08-17 found the capability spread across four dead or orphaned half-states, none reachable in the UI:

| Half-state | Where | What is actually there |
|---|---|---|
| **A schema with no producer and no consumer** | `QuizOption` + `CheckQuestion.options` ([activity_config.py:290-335](../../../../backend/db/models/activity_config.py#L290-L335)), mirrored at [elementTypes.ts:116-122](../../../../frontend/src/lib/elementTypes.ts#L116-L122) | A complete MCQ model. No editor writes `options` ([ConceptMapEditor.tsx:188-242](../../../../frontend/src/components/teacher/ConceptMapEditor.tsx#L188-L242) authors prompt + expected answer only), the co-pilot's `_questions_wire` drops it ([authoring_tools.py:436-447](../../../../backend/adk/authoring_tools.py#L436-L447)), and the tutor never receives it ([checkpoint_tools.py:88-91](../../../../backend/adk/checkpoint_tools.py#L88-L91)). Write-nowhere, read-nowhere. |
| **A protocol capability, switched off** | `basicCatalog` v0.9 ships `ChoicePicker` / `Slider` / `CheckBox`; [A2UIRenderer.tsx:91](../../../../frontend/src/components/protocols/A2UIRenderer.tsx#L91) registers the catalogue wholesale | A slider *would* render. But every skill template carries `a2ui: enabled: false`, and no code path in this repo emits one. |
| **Content built, then stripped** | [artefacts/kinebot/v1/quizzes/](../../../../infrastructure/mcp-sandbox/artefacts/kinebot/v1/quizzes/) — 11 DK-vetted MCQ banks | Nothing fetches them. [index.html:86](../../../../infrastructure/mcp-sandbox/artefacts/kinebot/v1/index.html#L86) says "SIM ONLY". The `kinebot.quiz-attempt` event plumbing that [kinebot-migration.md](../v1.0.0-pilot/implemented/kinebot-migration.md) records as implemented does not exist. |
| **A design, parked on content** | [exit-ticket.md](exit-ticket.md) (1.1.8) | A 4-point Likert (`rating_4`) + free text, `POST /api/sessions/{id}/exit-ticket`, a BQ `exit_tickets` table. Zero implementation — no `exit_ticket` symbol in `backend/` or `frontend/src/`. Blocked since 2026-06-29 on Aswin's question set. |

**The pattern:** each design was gated on *its own* content decision (which quiz format, which exit-ticket wording, which rubric), and each therefore also never built the *mechanism* — which none of those content decisions actually gate. Four instruments waited on four different humans for the same missing widget.

This doc separates the two. **The mechanism is un-gated and ships now.** The content — Aswin's exit-ticket set, AR's four-format templates, JB's per-lesson questions — lands as data into a working element, which is the state those gates were always assuming.

### What already shipped, and why this does not replace it

The **chat-native concept checkpoint** is live and deliberately not a form: the tutor asks the teacher-authored question in its own voice ([checkpoint_tools.py:61-138](../../../../backend/adk/checkpoint_tools.py#L61-L138)), and [ConceptMapView.tsx:6](../../../../frontend/src/components/workspace/ConceptMapView.tsx#L6) states the rule — *"The map never becomes a quiz UI — assessment happens in the conversation."*

That rule stands and this element does not weaken it. The distinction:

| | Chat-native checkpoint (shipped) | Question-set element (this doc) |
|---|---|---|
| Who asks | the tutor, conversationally, adapting | the form, identically for every group |
| Good for | probing understanding, following up on a wrong answer | **measurement** — the same question, same wording, comparable across groups and across time |
| Answer shape | free text, judged by a model | a bounded choice or a scale point, counted deterministically |
| Research value | rich, hard to aggregate | aggregatable by construction |

An AI-performance survey is exactly the second column: *"did the AI help you think, or did it think for you?"* is worthless if the tutor phrases it differently for each group. That is the case for a form, and it is why this element does not contradict the checkpoint decision — it serves the question the checkpoint is structurally bad at.

---

## Goals

**Primary goal:** A teacher (or the platform) puts a set of questions in front of a student, gets structured answers back, and those answers reach three places correctly — the tutor (as context), the teacher (as their class's work), and the researcher (as consent-gated data).

**Success metrics:**

- A teacher adds a 4-point confidence scale to an activity in the builder, a student answers it, and the tutor adapts to a low-confidence answer in the next turn — end-to-end, no developer.
- The **AI-performance survey** M asked for exists: a question set placed at session end, answered by students, aggregated per class and per skill in the researcher view.
- A **graded** question set strips its answer key from every student-facing payload, proven by a test that asserts `correct` is absent from the `/active` response.
- Adding this element required **no new wire protocol and no new store pattern** — it rides `iframe-context`, the `ELEMENT_REGISTRY` recipe, and a group-keyed progress store copied from `writing_progress`.
- The 1.1.8 exit ticket ships as **data** into this element, not as its own modal, endpoint, and BQ table.

**Non-goals (explicit):**

- **Adaptive question selection** (different questions based on session behaviour) — year 2, unchanged from exit-ticket.md.
- **Cross-session longitudinal scheduling** (ask the same question in week 1 and week 8, fatigue-aware) — this is the real design expansion [june-29-feedback.md](june-29-feedback.md) added to the exit ticket. It needs this element as its substrate; it is scoped in [1.1.68 longitudinal-concept-evidence](longitudinal-concept-evidence.md), not here.
- **Item-response theory / psychometric scoring** — the four-format mastery rule is [1.1.57 competency-rubrics](competency-rubrics.md) M3's job; this doc supplies the delivery surface it was waiting on.
- **Reviving `kinebot.quiz-attempt`** — the in-sim quiz stays deleted. The architectural rule from [expanded-workbench-types.md:30](../v1.0.0-pilot/expanded-workbench-types.md#L30) is that quizzes are the platform's job, not the artefact's, and this element is the platform doing that job.
- **Validated research instruments** (FCI, QMCS, PLIC, CLASS) — item security lives with PhysPort and their official pipelines; see [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md). This element is for teacher- and researcher-authored questions.

---

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Radio groups and a submit button. Deterministic React in the workspace pane, no iframe, no model call to render or to score. |
| 2 | EARNED TRUST | +1 | The student sees a trust card confirming their answers reached the tutor (the recurring drop this project has shipped four times — see `feedback-trust-card-with-tutor-push`). Ungraded answers are never shown to a teacher per-group: a confidence rating is a self-report, and a student who thinks their teacher reads "I felt lost" per-group answers dishonestly. See *Who sees what*. |
| 3 | SKILLS, NOT FEATURES | +1 | This is the tenth entry on the `ELEMENT_REGISTRY` recipe, and it retires **three** pending designs rather than adding a fourth. The `redact` hook it introduces is reusable by every future element that holds a secret. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Scoring a multiple-choice answer is a string comparison. Zero LLM tokens to deliver, answer, score, or aggregate — the model is spent only on *reacting* to the result. |
| 5 | GRACEFUL DEGRADATION | +1 | Malformed item → that item renders disabled with a teacher-visible validation error, the rest of the set still works. No session at bootstrap → answers buffer locally and the catch-up sync pushes on arrival (the shipped `*.sync` pattern). Session-end modal is always skippable; a skip is recorded as a distinct state from "never answered". |
| 6 | PROTOCOL OVER CUSTOM | +1 | No new wire protocol. Delivery is the shipped `ELEMENT_REGISTRY`; state reporting is the shipped `POST /api/sessions/{id}/iframe-context`; storage is a group-keyed Firestore collection identical in shape to `writing_progress`; research capture is a fourth `emit_*` on the existing `observability/chat_log.py` sink. **A2UI `ChoicePicker`/`Slider` were evaluated and rejected** — see *Standards compliance*. |
| 7 | API FIRST | +1 | Answers ride a dual-audience REST pair mirroring `writing_progress_routes`; grading is its own endpoint; `aiplatform activity add-element --kind questionSet` gets parity in M1. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Every submission emits a BQ row (M4) via the existing sink. The skip rate is itself research signal (exit-ticket.md's point, preserved). |
| 9 | SECURE BY CONSTRUCTION | +1 | **This is the first element that holds a secret**, and it is the reason for the `ElementSpec.redact` hook rather than a hand-written exclusion. The answer key never enters a student-facing payload (registry-driven redaction, test-guarded), grading is server-side, and no free-text answer is ever interpolated into a prompt without the same treatment teacher text already gets. Positive rather than neutral because the mechanism generalises: the next element with a secret inherits it. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | The client never possesses the answer key — it POSTs a choice and receives a verdict. This is the deliberate departure from the calculator's client-side `safeFormula.ts`, and the reason is the difference between *a tool the student uses* and *an answer the student could read*. |
| 11 | USABLE BY DESIGN | +1 | Radio groups with real labels, no emoji (per `feedback-no-emoticons`, carried over from exit-ticket.md's wording note); one question per row reflowing to a single column at ~700px; every state (unanswered / answered / submitted / skipped) visually distinct. |
| | **Net Score** | **+11** | Threshold ≥ +4. No axiom at −1. Hard-fail rules pass: EARNED TRUST +1 and SECURE BY CONSTRUCTION +1, both required here since the feature carries user-facing data and introduces new data access. |

---

## Standards compliance

**A2UI was checked first and deliberately not used.** The v0.9 `basicCatalog` has `ChoicePicker`, `Slider`, and `CheckBox`, and [A2UIRenderer.tsx:91](../../../../frontend/src/components/protocols/A2UIRenderer.tsx#L91) already registers the whole catalogue — so a model *could* emit a rating scale today. Rejected for this element, for three reasons that are worth recording because "why isn't this A2UI?" is the obvious review question:

1. **A2UI is model-emitted; this is teacher-authored.** An A2UI card is a thing the agent decides to render mid-turn. A question set is a persisted, versioned, teacher-owned artefact that must render identically for every group in the class — that is `ActivityConfig` data, not a stream event.
2. **A2UI is off everywhere.** All eight skill templates set `a2ui: enabled: false`. Turning it on to ship one element means shipping the whole surface, un-reviewed, on the pilot path.
3. **The answer key cannot ride an A2UI payload.** A2UI components are declared in the message the client renders. There is no server-side redaction seam. Axiom 10 requires the key stay server-side, which forecloses it.

The A2UI path stays open and gets *cheaper* from this work — if a skill later wants a model-emitted one-off scale, the `QuestionItem` model is the natural payload and the grading endpoint already exists. That is a follow-on, not this doc.

**Everything else adopts an existing internal standard:** `ELEMENT_REGISTRY` + the [add-element recipe](activity-elements-palette.md) for definition and threading; `iframe-context` for tutor state (checked against `wrap_with_iframe_context`, which injects `mcp_app_context.<kind>.state` into every prompt — no new callback needed); a group-keyed Firestore collection matching `db/writing_progress.py`; `observability/chat_log.py`'s `emit_*` shape for BQ.

## Framework-native capability check

Per recipe step 5b-ter, each piece of custom plumbing must prove the stack does not already do it:

| Proposed plumbing | Native alternative checked | Verdict |
|---|---|---|
| Push answers to the tutor | **AG-UI / ADK session events.** `wrap_with_iframe_context` already injects `mcp_app_context.<kind>.state` into every agent prompt, and anything in a session event replays for the session lifetime for free. | **Native — use it.** No `before_model_callback`, no side channel. Identical to how `table`/`calculator`/`writing` already work. |
| Store the student's answers | **ADK session state / artifacts.** | **Not sufficient — custom store required, with evidence.** Session state is session-scoped; answers must survive rejoin from a different device by the same group ([1.1.53 group-shared-session-sync](group-shared-session-sync.md)). This is the same reason `writing_progress` exists rather than living in session state. The custom store is one Firestore collection copying a shipped idiom, not a new pattern. |
| Deliver the questions to the client | **A2UI catalogue.** | **Rejected with reasons** — see *Standards compliance* above. |
| Research capture | **Existing OTel → BQ sink** (`observability/chat_log.py`). | **Native — extend it.** One new `emit_question_response` beside `emit_chat_turn` / `emit_workbench_event` / `emit_voice_cost` / `emit_rubric_run`. exit-ticket.md's separately-designed `exit_tickets` table and Terraform block are **not** built; the row rides the existing auto-schema discipline. |

---

## Design

### The element

One registry kind — `questionSet` — carrying a list of items. The mode is **derived, never a teacher toggle**: a set whose items have no answer key is a survey; a set where any item marks an option `correct` is a quiz. This is the direct consequence of M's 2026-08-17 decision to build one element rather than two, and it means a teacher who writes "which of these is the correct unit?" gets grading without having found a setting.

```python
# backend/db/models/activity_config.py

QuestionKind = Literal["rating", "single_choice", "multi_choice", "free_text"]
QuestionPlacement = Literal["workspace", "session_end"]

class QuestionItem(BaseModel):
    """One question. ``options`` carries the answer key when the item is graded."""
    id: str = Field(min_length=1, max_length=64)
    kind: QuestionKind = "single_choice"
    prompt: str = Field(min_length=1, max_length=500)
    # rating: the ordered scale labels, low → high. 2–7 points; a 4-point scale
    # (no neutral midpoint) is the exit-ticket default, preserved from 1.1.8.
    labels: list[str] = Field(default_factory=list, max_length=7)
    # choice: the options. `correct` is the SECRET — see ElementSpec.redact.
    options: list[QuizOption] = Field(default_factory=list, max_length=6)
    required: bool = False
    explanation: str = Field(default="", max_length=1000)   # shown after answering

class QuestionSetElement(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(default="", max_length=120)
    intro: str = Field(default="", max_length=2000)
    placement: QuestionPlacement = "workspace"
    items: list[QuestionItem] = Field(default_factory=list, max_length=12)
```

`QuizOption` (`id` / `label` / `correct`) is **reused as-is** — it is the shipped 1.1.19 shape at [activity_config.py:290-303](../../../../backend/db/models/activity_config.py#L290-L303), it has never had a producer, and this is the home it was designed for. Its dead sibling, `CheckQuestion.options`, is deleted (see *Stale-record corrections*).

**Cap: 12 items.** Deliberately above the exit ticket's 4 and below anything that reads as an exam. The 2026-06-29 fatigue note is a real constraint — a 30-question bank belongs in a curriculum document, not in a workspace pane on a shared phone.

**Registry entry** — `max_items: 3`, `render: "workspace"`. Three because an activity plausibly wants a pre-check, a mid-check, and an end-of-session ticket; more than that is the longitudinal design, not this one.

### `ElementSpec.redact` — the new registry capability

This is the first element whose config contains something the student must not read. The project's own rule from the [palette recipe](activity-elements-palette.md#L160-L168) applies exactly:

> **iterate `ELEMENT_REGISTRY` where you can, and where you genuinely cannot, add a test that iterates it for you.** An enumeration may be written by hand; it may never be left unchecked.

So the answer key is **not** stripped by a hand-written branch in the student route. `ElementSpec` gains an optional `redact` callable, and [`_element_block`](../../../../backend/protocols/activity_config_routes.py#L241) — which is already registry-driven — applies it:

```python
@dataclass(frozen=True)
class ElementSpec:
    kind: ElementKind
    field: str
    max_items: int
    render: ElementRender
    # Applied to every item before it enters a STUDENT-facing payload. None =
    # this kind holds nothing secret. Registry-driven so a new secret-bearing
    # element cannot forget; guarded by test_student_payload_carries_no_answer_key.
    redact: Callable[[dict], dict] | None = None
```

For `questionSet`, `redact` drops `correct` from every option and drops `explanation` until the item is answered. Every other kind keeps `redact=None`, which is a positive declaration of "nothing secret here" in the same spirit as `element_state.NoFillChannel`.

**The guard:** `test_student_payload_carries_no_answer_key` walks the `/active` response for a graded set and asserts no `correct` key survives at any depth — a structural assertion, not a field list, so it catches a future nested field too.

> **Known residual, inherited not introduced.** The chat-native checkpoint already ships expected answers to the model over the session stream, which a determined student could inspect — recorded as an accepted formative-demo risk on [CheckQuestion](../../../../backend/db/models/activity_config.py#L316-L320) and in `concept-map-sprint.md`. This element does **not** widen it: the key travels teacher→server→verdict only, and the tutor is told *whether* an answer was correct, never *which* option is. Closing the checkpoint's stream exposure stays that doc's item.

### The four tutor wirings

Per the [`workbench-element-builder`](../../../../.claude/skills/workbench-element-builder/SKILL.md) skill, all four are required. Stating each explicitly because dropping one is this project's most-repeated element bug:

| # | Wiring | For `questionSet` |
|---|---|---|
| **1. Push** (data → AI) | `useSimSnapshotPush(sessionId, "questionSet")` | On submit, push `{ setId, answers: [{itemId, kind, value, correct?}] }` under event `questionSet.commit` — *passive* context, no unprompted tutor reply. For a graded item the push carries the boolean verdict, **never the key**. |
| **2. Trust card** (confirmation → student) | `useHumanToolEvents().dispatch` | Interaction shape is **one-shot** (an explicit Submit), so: **one card per submit**, not per item — a 4-item Likert must not fire four cards. Label in Danish, naming what was shared without the content: `Besvarede 4 spørgsmål — delt med vejlederen`. **Session-end placement dispatches no card** (there is no chat left to card into; the modal's own confirmation is the feedback). |
| **3. Prompt-time presence** (existence → AI) | `_DESCRIBERS["questionSet"]` in `adk/element_manifest.py` | *"This activity has a question set, «title»: 4 questions (a 4-point confidence scale, 3 multiple-choice). The student answers it in the workspace."* Names the instrument and the shape, **never the items' answers and never the key** — the manifest is composed once per session and would go stale. |
| **4. Fill state** (emptiness → AI) | a reader in `adk/element_state.py` | A **real reader**, not a `NoFillChannel`: answered-count over item-count is directly observable. This matters more here than for the table — "the student said they were confident" and "the student never opened the ticket" must not collapse into one signal, which is the exact unknown/empty conflation 1.1.69 exists to remove. |

### Storage — one collection, copied from `writing_progress`

`db/question_responses.py`, group-keyed, doc id `{group_id}:{activity_id}`, mirroring [`db/writing_progress.py`](../../../../backend/db/writing_progress.py) field for field. Routes in `protocols/question_response_routes.py` copy [`writing_progress_routes.py`](../../../../backend/protocols/writing_progress_routes.py) exactly — including its dual-audience read (student reads own group; owning teacher reads all groups; anyone else gets an enumeration-resistant 404) and its student-only write.

> **The auth footgun, stated in advance.** These routes MUST import `get_current_user` from `auth` (the dispatcher), never from `auth.firebase_auth`. The Firebase-only symbol 401s **every** anonymous-group student, and — the part that makes it expensive — a route's own tests `dependency_overrides` the same wrong symbol the route imports, so they pass in lockstep with the bug. Student writing autosave shipped this to prod. `scripts/check-auth-dispatcher.sh` now gates it in CI, and `tests/api_tests/test_dual_auth_rejection.py` must gain a case for these two routes with a **real minted group token**.

### Who sees what

The two modes have genuinely different data postures, and this is where a single element earns its keep only if the rule is explicit:

| Item | Tutor | Teacher | Researcher |
|---|---|---|---|
| **Graded** (any option marked `correct`) | the answer + whether it was right | **per group** — it is that group's work, like a filled table | per group, consent-gated |
| **Ungraded** (rating / free text / unkeyed choice) | the answer — a low-confidence rating is exactly what a tutor should adapt to | **aggregate across the class only** — distribution, not per-group | per group, consent-gated |

The teacher asymmetry is deliberate and is the Axiom-2 call. A confidence rating and an AI-performance rating are **self-reports**; a student who believes their teacher reads "I felt lost" attributed to their group answers dishonestly, and the measurement is then worth nothing. Graded answers carry no such incentive — they are work, and a teacher seeing them is the point.

For a class small enough that aggregate is effectively per-group, the aggregate view suppresses below a floor of **3 responding groups** and says so, rather than silently rendering a one-row "distribution".

### Session-end placement — this is the exit ticket

`placement: "session_end"` is the whole of the supersession. The same `QuestionItem[]`, rendered in a focus-trapped modal instead of the workspace pane, on the two triggers [exit-ticket.md](exit-ticket.md) already specified (teacher ends the session; student clicks Done). Everything that doc designed bespoke is now a consequence:

| exit-ticket.md designed | Becomes |
|---|---|
| `POST /api/sessions/{id}/exit-ticket` | the same `PUT …/questions` write, with the set resolved by placement |
| `exit_ticket_responses` / `_submitted_at` / `_skipped` on the session doc | rows in `question_responses`, with `skipped` a first-class response state |
| a BQ `exit_tickets` table + Terraform | a `emit_question_response` row on the existing sink |
| `exit_ticket:` block in `SKILL.md` frontmatter | **kept** — a per-skill default set, used when the activity authors none. This is the one piece of 1.1.8's design that is not redundant, and it is what gives the platform a baseline instrument for skills nobody has customised. |
| emoji rating (brief) → named radio buttons | **kept**, unchanged — `feedback-no-emoticons` |
| tab-close is out of scope as a trigger | **kept**, unchanged — `beforeunload` beacons are unreliable; the session records `closed_via=abandonment` |

The three distinct states 1.1.8 insisted on — `never answered` / `skipped` / `submitted` — survive intact, because wiring #4 requires that distinction anyway.

**What is still gated is only the content.** Aswin owns the question set, per [june-29-feedback.md](june-29-feedback.md), and that gate is unchanged. It now gates *what the platform asks*, not *whether the platform can ask*.

### Grading

`POST /api/activities/{activity_id}/questions/{set_id}/grade` — student (group) session. Body is the chosen option ids; response is per-item `{itemId, correct: bool, explanation?}`. The key is read server-side from the config and never returned.

Client-side evaluation is **not** an option here, and the contrast with the calculator is instructive: [`safeFormula.ts`](../../../../frontend/src/lib/safeFormula.ts) evaluates client-side because a formula is a *tool the student uses* and there is nothing to hide. An answer key is a secret, and a secret in the bundle is not a secret. Same registry, opposite call, for a reason worth writing down.

### CLI surface

| Command | Purpose |
|---|---|
| `aiplatform activity add-element <id> --kind questionSet --file set.json` | Add a question set from a JSON spec (existing subcommand, new kind) |
| `aiplatform activity questions <id> [--group <code>]` | Read responses — the flag distinguishes one group from the class aggregate |

---

## API changes

| Endpoint | Change | Auth |
|---|---|---|
| `POST` / `PATCH /api/activity-configs[/…]` | `ActivityConfigUpsert` gains `question_set`; registry validation | teacher JWT (owner) |
| `GET /api/activity-configs/active/{id}` | carries `questionSet` via `_element_block`, **through the new `redact` hook** | student or teacher |
| `GET /api/activities/{id}/questions` | **New** — dual-audience: own group's responses, or (owner) all groups | student (group) **or** teacher |
| `PUT /api/activities/{id}/questions` | **New** — student submits or skips a set | student (group) only |
| `POST /api/activities/{id}/questions/{set_id}/grade` | **New** — server-side scoring; key never returned | student (group) |

---

## Milestone phasing

| MS | Deliverable | Est | Gate |
|---|---|---|---|
| **M0** | **Element + store + the four tutor wirings.** Models + registry entry + recipe steps 1b/1c (all three activity stores, both adapters, the `/active` carrier, the legacy upsert) + `db/question_responses.py` + routes + `WorkbenchQuestionSet.tsx` + push + trust card + manifest describer + fill reader. Ungraded only — ratings, choices, free text. | ~1.5d | none |
| **M1** | **Authoring.** Builder editor (`QuestionSetEditor`) + co-pilot `add_element` coverage both sides (recipe 5b) + CLI parity. Without this a teacher cannot create one. | ~0.75d | none |
| **M2** | **Answer key + grading.** `ElementSpec.redact` + `_element_block` wiring + the grade endpoint + the structural key-leak test + post-answer explanation reveal. **This is the milestone that makes it a quiz.** | ~1d | none |
| **M3** | **Session-end placement.** `placement` field + `SessionEndQuestions` modal + the two triggers + per-skill `SKILL.md` default set + the three-state distinction. **Retires exit-ticket.md.** | ~0.75d | **Aswin's question set gates the CONTENT, not this milestone** — ships with the platform-default set, Aswin's replaces it as data |
| **M4** | **Research capture.** `emit_question_response` → BQ + consent gating + the researcher aggregate view (distribution per class/skill, free-text feed) + the ≥3-group suppression floor. | ~0.5d | JB on consent granularity (see below) |

M0+M1 is the shippable slice: a teacher can author a confidence scale and a student can answer it. M2 and M3 are independently valuable and independently orderable — **M3 before M2** is the right order if the AI-performance survey is the priority, since a survey needs no answer key.

---

## Testing strategy

- **Backend (pytest):** model round-trip through all three activity stores + both adapters; the registry-completeness family (`-k "element_kind or element_field or registered_element"`) must pass with the new kind, i.e. manifest describer, fill reader, `/active` carrier, legacy upsert all covered; **`test_student_payload_carries_no_answer_key`** walking the `/active` response structurally; grading correctness incl. multi-choice partial credit; dual-audience read (student own-group / teacher all-groups / stranger 404); **a real minted group token through the real dispatcher** in `test_dual_auth_rejection.py`; skip vs never-answered persisted distinctly.
- **Frontend (vitest):** renderer empty / partially-answered / submitted / skipped states; **the push assertion AND the card assertion** (one card per submit, not per item — the specific bug this element is shaped to avoid); session-end modal focus trap + skip path; no `correct` key present in any client-held config object.
- **E2E (LOCAL_MODE):** teacher adds a 4-point scale → mints a code → anon student answers → tutor references the low confidence in its next turn.
- **Audit:** `make audit-trust-cards` must not show `WorkbenchQuestionSet` as a new red row.

---

## Human gates

1. **Aswin — the exit-ticket question set** (gates M3 *content*, not M3). Unchanged from [june-29-feedback.md](june-29-feedback.md), plus the two axes that note added: an **affective** axis (do students feel they are learning more / that it is more accessible) and a **longitudinal** axis. The longitudinal axis is explicitly out of scope here and needs its own design.
2. **JB — consent granularity** (gates M4). Carried forward verbatim from [exit-ticket.md](exit-ticket.md) open question 2: for a declined-consent session, suppress the whole BQ row, or write the metadata (`skipped` / `submitted_at`) and null the responses? The doc's recommendation stands — metadata is itself institutional-reporting signal.
3. **AR — whether the four-format template lands here** ([1.1.57 competency-rubrics](competency-rubrics.md) M3). That milestone was estimated as "+1d on TAA M2"; TAA M2 is the thing this doc replaces, so the dependency re-points here. AR to confirm the four formats map onto `QuestionKind` or need a fifth.
4. **JB/AR — the teacher asymmetry** (*Who sees what*). Engineering's call is that ungraded self-reports are class-aggregate only. If a teacher genuinely needs per-group confidence to run their lesson, that is a pedagogical decision that overrides the Axiom-2 reasoning — but it should be made explicitly, not by default.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **The element becomes an exam surface** — the thing the concept-map work deliberately avoided | Medium | The 12-item cap; the `intro` framing; and the pedagogical line held in this doc's *What already shipped* table. If teachers start authoring 12-item graded sets as their primary assessment, that is a finding to report, not a feature to extend |
| **Answer key leaks** | Low, high impact | `ElementSpec.redact` is registry-driven, so a future secret-bearing element inherits it; the guard test is structural, not a field list; grading is server-side |
| Survey fatigue across a term | Medium | The 2026-06-29 note's own concern. v1.1 is per-session one-shot; the cross-session scheduling that would cause fatigue is explicitly out of scope until designed |
| Students answer self-reports dishonestly | Medium | The teacher asymmetry above is the mitigation, and it only works if it is *told* to students — the element's copy says who sees the answers |
| Free-text answers contain PII | Medium | Same consent path as chat turns; the same "don't share personal info" copy as 1.1.7; free text is optional on every set |
| Another element ships needing a secret and forgets redaction | Low | That is exactly what `redact=None` as a *positive declaration* prevents — the same discipline as `NoFillChannel` |

---

## Stale-record corrections shipped with this doc

The audit found records asserting capabilities that do not exist. Corrected in the same change, because a design doc that leaves them standing has added a fifth half-state rather than removing four:

| Record | Was | Now |
|---|---|---|
| [exit-ticket.md](exit-ticket.md) | Planned (P1), blocked | **Superseded** by this doc; content gate carried forward |
| [teacher-activity-authoring.md](teacher-activity-authoring.md) M2 | "quiz designed, not built" | Re-homed here; M2 closed |
| [activity-elements-palette.md](activity-elements-palette.md) | `ElementKind` sample includes `quiz`; render table lists `quiz → inline chat` | Corrected to `questionSet → workspace`; non-goal #1 re-pointed |
| [competency-rubrics.md](competency-rubrics.md) M3 | "+1d on TAA M2" | Dependency re-pointed to this doc's M2 |
| [end-of-class-notes-summary.md:59](end-of-class-notes-summary.md#L59) | "the same component family as the session-report and quiz-feedback cards" | No quiz-feedback card family exists — corrected |
| [kinebot-migration.md](../v1.0.0-pilot/implemented/kinebot-migration.md) | Records the quiz bank, `kinebot.quiz-attempt` events, `quizProgress`, and trust cards as **implemented** | Correction block: the sim half shipped, the quiz half was stripped and never wired. The 11 JSON banks are deleted from the tree (recoverable from git history — the doc records the SHA) |
| [living-concept-map.md](living-concept-map.md) | "the 1.1.19 form-quiz element remains its own thing" | Re-pointed here |
| [activity_config.py:446](../../../../backend/db/models/activity_config.py#L446) | "`quiz` (inline, A2UI) joins when 1.1.19 M2 builds it" | Corrected to name this doc and `questionSet` |
| `CheckQuestion.options` + `_options_bound` + the `elementTypes.ts` mirror | A complete MCQ field with no producer and no consumer | **Deleted.** `QuizOption` itself is kept — this element is the home it was designed for |
| [activityTemplates.ts:17](../../../../frontend/src/lib/activityTemplates.ts#L17) | "Quiz is not a shipped workspace element." | Corrected |
| [chat/[...path]/page.tsx:1386](../../../../frontend/src/app/chat/[...path]/page.tsx#L1386) | "Adding a non-sim element (quiz, A2UI) composes here from config." | Corrected |

---

## Success criteria

- [ ] A teacher authors a 4-point confidence scale in the builder; a student answers it; the tutor adapts to a low rating in its next turn (M0+M1)
- [ ] The trust card fires **once per submit**, not once per item, and `make audit-trust-cards` shows no new red row (M0)
- [ ] `test_student_payload_carries_no_answer_key` passes structurally against a graded set (M2)
- [ ] `-k "element_kind or element_field or registered_element"` is green with the new kind — manifest, fill reader, `/active` carrier, legacy upsert (M0)
- [ ] A real minted group token reaches both new routes through the real dispatcher (M0)
- [ ] An AI-performance survey at session end produces a per-class distribution in the researcher view, suppressed below 3 responding groups (M3+M4)
- [ ] `never answered` / `skipped` / `submitted` are three distinct, separately-rendered states (M3)
- [ ] exit-ticket.md is marked superseded and no second rating instrument exists in the codebase
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green

---

## Related documents

- [activity-elements-palette.md](activity-elements-palette.md) — 1.1.38, the registry + the add-element recipe this is the tenth entry on
- [student-writing-element.md](student-writing-element.md) — 1.1.73, the per-group store + routes copied verbatim
- [exit-ticket.md](exit-ticket.md) — 1.1.8, **superseded**; its question schema, trigger design, and three-state distinction are preserved here
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19, whose M2 quiz this builds
- [competency-rubrics.md](competency-rubrics.md) — 1.1.57, whose M3 four-format quiz depends on this delivery surface
- [living-concept-map.md](living-concept-map.md) — the chat-native checkpoint decision this element sits alongside, not against
- [tutor-sees-element-state.md](tutor-sees-element-state.md) — 1.1.69, why the fill reader is a reader and not a `NoFillChannel`
- [workbench-element-awareness.md](workbench-element-awareness.md) — 1.1.62, prompt-time presence
- [researcher-role.md](researcher-role.md) — 1.1.5, the aggregate view's role gate
- [student-consent-prompt.md](student-consent-prompt.md) — 1.1.3, gates the M4 BQ rows
