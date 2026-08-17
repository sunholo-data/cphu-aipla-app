# Teacher activity authoring — non-sim activities first class

**Status:** Planned (P1, aggressive v1.1 target — phased; thin slice pre-freeze)
**Last Updated:** 2026-06-15 (15 June: per-activity RAG **source-selection** sharpened to a first-class authoring control — see *Per-activity RAG source selection*)
**Priority:** **P1** — recorded as *"the primary design priority in the 3 June teacher check-in"* in the scoping site (`strands.qmd`, three separate mentions). Teachers want to create activities from scratch — including activities with **no simulator at all** — without a developer in the loop.
**Estimated:** ~6–8d full builder; **~1.5d for the M0 pre-freeze thin slice** (see Milestone phasing)
**Scope:** Fullstack — `backend/db/models/activity_config.py` (extend) + `backend/db/activity_configs.py` + `backend/protocols/activity_config_routes.py` (extend to CRUD) + new A2UI student surfaces (quiz / notebook / drawing / none) + `frontend/src/app/teacher/activities/` (builder) + generalize `frontend/src/components/workspace/ProgressChecklist.tsx` + `aiplatform activity` CLI
**Dependencies:** [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) (Phase 2 `ActivityConfig` is the parent surface — shipped); [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md) (1.A teacher auth — shipped); [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J — workbench type system); [lesson-picker.md](../v1.0.0-pilot/implemented/lesson-picker.md) (shipped); ADR-015 (unified multi-surface UI) + ADR-013 (artefact safety) in the scoping site
**Source brief:** [`june-03-feedback-sprint-brief.md`](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-03-feedback-sprint-brief.md) + [`june-09-feedback-sprint-brief.md` §A](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md) (curriculum library + equipment co-design) + [`notes/2026-06-15-teacher-feedback.md`](file:///Users/mark/Documents/clients/cph-uni/notes/2026-06-15-teacher-feedback.md) (15 June: teacher chooses RAG inputs) + scoping-site [`strands.qmd`](file:///Users/mark/Documents/clients/cph-uni/strands.qmd) "Teacher activity creation and branching"

> **9 June split (read with the realism note).** The 9 June brief folds two more requirements into "design doc A": (1) a **referenceable A/B/C curriculum library** teachers cite when authoring, and (2) **AI co-designing the missing workbench element** around a teacher's existing lab equipment. The **library** is a standalone subsystem (storage, taxonomy, ingestion, ACL, retrieval) and has been split into its own doc — [curriculum-library.md](curriculum-library.md) — which this builder *consumes* (its `materials` picker browses that library). The **co-design** stays here as **M6**, because it is an authoring *interaction*, not a corpus.

> **Realism note (read first).** This is the largest open v1.1 item and it competes directly with the open P1 items (1.1.3/1.1.4/1.1.5/1.1.7/1.1.9/1.1.10) and the **2026-06-29 → 07-05 freeze**. The full builder will not land in one sprint before the pilot. This doc therefore commits to a **phased build with a self-contained M0 thin slice** (teacher authors a no-workbench *concept-dialogue* activity end-to-end) that delivers standalone value before the freeze, and treats the quiz/checklist/branching milestones as independently shippable through the pilot-iteration window. If the team is consumed by the other P1 items, M0 ships and the rest slides — without leaving a half-built surface.

> **17 June — element layer + AI co-pilot split out (read with the above).** Two follow-ups generalise this umbrella and should be read alongside it: [activity-elements-palette.md](activity-elements-palette.md) (1.1.38) reframes this doc's `checklist`/`quiz`/`materials` fields into a **bounded element registry** and adds table / chart / calculator / inline-document elements; [activity-authoring-assistant.md](activity-authoring-assistant.md) (1.1.39, Aswin) is the **AI co-pilot** that assembles them for a non-technical teacher — and it **re-homes M6 (equipment co-design), M7 (auto-rubric), and M8 (coverage)** below as conversational *tools*. The milestone table here is otherwise unchanged: treat M6/M7/M8's *logic* as specified here, their *conversational front-end* as 1.1.39, and the *element substrate* as 1.1.38.

## Why this exists as one doc

The capability teachers asked for — *"create activities from scratch (topic, workbench type, Socratic prompt, uploaded materials) or branch from existing ones; non-sim activities first class: a workbench can be a quiz, a drawing board, or nothing"* — is currently **scattered across five places** with no single execution design:

| Piece | Where it lives today | State |
|---|---|---|
| Authoring **tier 1** — teaching goal (free text) + A2UI config forms | `problem-set-helper-config`, `concept-dialogue-config`, `manage-class` skills | **Shipped** |
| Authoring **tier 2** — bounded parameter knobs (sim artefacts) | [post-pilot/teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) | Stub, pilot-gated |
| Authoring **tier 3** — code-level / AI-assisted artefact authoring | [post-pilot/teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md) | Year-2 stub |
| **Workbench type system** (App / Drawing / Sensor / Video / Notebook; non-sim first class) | [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J) | Spec'd |
| **Task tracking** — self-assessment progress checklist | `ProgressChecklist.tsx` (Boldkast `a/b/c/d` hardcoded in caller) | Shipped (sim-bound) |

This doc is the **umbrella** that unifies them and fills the two genuine gaps: **(1) teacher-authorable non-sim activities** as a first-class A2UI flow, and **(2) a quiz mechanism** (teacher-authored declarative MCQ). It does **not** restate the tier-2/tier-3 stubs — it sequences them under one model and makes the non-sim builder the v1.1 deliverable.

### Architecture is already decided — this is execution, not re-litigation

Two splits are settled in the scoping-site ADRs; this doc consumes them:

- **A2UI** (declarative, backend-emitted, rendered inline in chat) is the rail for **teacher authoring forms and non-sim student surfaces** (quiz, notebook, drawing prompt, no-workbench). Per `architecture.qmd`'s extension table, "teacher-config forms" are already an interactive A2UI surface — a student quiz is the **same pattern, student-facing**.
- **MCP Apps** (sandboxed iframes, own state) stay the rail for **complex standalone sims** (Boldkast / LED Planck / KineBot via ADR-013 + the `mcp-app-artefact` skill). Authoring a *new sim* is tier-3 (Year-2) and explicitly **out of scope here**.

The design principle from [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) and [jitt-dk-artefacts.md](../v1.0.0-pilot/jitt-dk-artefacts.md) is load-bearing: **the workbench is one interactive surface; quizzes, checklists, instructions and data tables are AIPLA's job (platform / tutor), not the artefact's.** That is exactly why a teacher-authored quiz is an A2UI/platform concern and not a new sim.

## Goals

**Primary goal:** A teacher creates a complete, student-ready activity — pick a workbench type (including *none*), write the Socratic lesson prompt, author a progress checklist, optionally author a quiz, attach materials — and hand out a group code, **without a developer touching code**.

**Success metrics:**

- A teacher creates a **no-workbench concept-dialogue activity** end-to-end in **< 5 minutes** (M0 acceptance).
- A teacher creates a **quiz activity** (≥ 3 MCQ items) and a student completes it, with responses landing in BigQuery, in **< 10 minutes** of authoring.
- Zero developer involvement for any non-sim activity type.
- Every authored activity has a designed empty / loading / error state on the student side (no blank void — Axiom 11).
- Branching ("duplicate + edit") works for any activity type.

**Non-goals (explicit):**

- Authoring *new* sims / lab artefacts (that's tier-3, [teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md), Year-2).
- Bounded parameter knobs on *existing* sims (that's tier-2, [teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md), pilot-gated — complementary, not blocked by this doc).
- AI-generated quiz items (KineBot's tutor-driven adaptive quiz is a *different* mechanism — see Quiz section). v1.1 quizzes are **teacher-authored**.
- A teacher "marketplace" / cross-teacher sharing (v2 per [teacher-permission-model.md](../v1.0.0-pilot/implemented/teacher-permission-model.md)).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Non-sim A2UI surfaces render inline with **no MCP-App iframe cold-start** — a quiz/checklist/concept activity is visible immediately, faster than a sim workbench. |
| 2 | EARNED TRUST | +1 | Quiz content and checklist items are **teacher-authored** (human provenance, reviewable) — not AI-fabricated. The checklist stays **student-driven, not auto-graded** (the agent never decides "done"). |
| 3 | SKILLS, NOT FEATURES | +1 | The headline win: activity creation becomes a **teacher-configurable skill**, not a developer feature. Directly serves the <5-min, <3-concept bar. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Static MCQ rendering and grading, and checklist state, are **deterministic — zero LLM tokens**. No reasoning model used where none is needed. |
| 5 | GRACEFUL DEGRADATION | +1 | Designed fallbacks: malformed/empty quiz spec → render items as a plain numbered list; `workbench_type=none` → chat-only activity still fully works; missing checklist → chat proceeds. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Renders through **A2UI** (non-sim) and **MCP Apps** (sim); the activity definition extends the existing **Pydantic `ActivityConfig` + ADK SkillConfig** schema via metadata — no new wire protocol invented. |
| 7 | API FIRST | +1 | Activity CRUD is an API surface with a thin `aiplatform activity` CLI adapter; the teacher web builder and any future channel render the same contract. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Quiz responses and checklist ticks become first-class observable signals → OTel spans → `chat_turns` / new `activity_events` in BigQuery. Directly feeds [student-engagement-signals.md](student-engagement-signals.md). |
| 9 | SECURE BY CONSTRUCTION | 0 | Adds a new teacher-authored input surface that reaches both student render and tutor context. **Net neutral, not negative:** choosing **structured A2UI over raw-HTML authoring** keeps teacher input inside a safe, non-executable boundary (no `<script>`, no iframe), authoring is gated behind authenticated teacher auth, and content is server-side length/shape-validated before persistence. See Security section. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Activity definition, quiz spec, and **grading** all live backend; the frontend renders A2UI events only. Teacher builder is a teacher-only **code-split route** — student bundle unaffected. |
| 11 | USABLE BY DESIGN | +1 | Student-facing surface — student journey, empty/loading/error states, and the ~700px workspace viewport are specified **before** build (see Student rendering). Teacher builder empty/first-run state designed upfront. |
| | **Net Score** | **+10** | Threshold: ≥ +4. |

**Conflict Justifications:**

- **#9 SECURE BY CONSTRUCTION (0, not −1):** A new user-controlled input that reaches model context would normally pull this negative. It is held to **neutral** by construction, not discipline: (a) teacher authoring is the **only** write path and it sits behind the existing teacher Firebase-auth gate; (b) the chosen rail is **declarative A2UI**, which renders structured components — teacher text can become a label or an MCQ option but **cannot become executable markup or an iframe** (that capability is deliberately reserved for tier-3 with its own ADR-013 review); (c) teacher content reaching the tutor prompt rides the **same `{teacher_focus}` injection path already shipped and reviewed** in [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — no new injection vector. Hard-fail check passes (SECURE is 0, not −1; no student-facing −1; ≤ 2 axioms at −1).

## Standards compliance

Per Axiom 6, no custom protocol is introduced:

- **Student rendering:** A2UI declarative components (the same interactive-form capability already used for teacher-config forms) for non-sim surfaces; MCP Apps for sims. No bespoke renderer.
- **Activity definition:** extends the existing Pydantic `ActivityConfig` (verified at `backend/db/models/activity_config.py`) and the ADK `SkillConfig` it feeds — metadata extension, not a new schema language.
- **Streaming / interaction:** quiz submit and checklist toggle ride existing AG-UI / `iframe-context` event paths (the checklist already pushes to `/api/sessions/{id}/iframe-context`).
- **Quiz item shape:** a small Pydantic model, rendered *to* A2UI — not a new quiz interchange format. (Open question Q3 tracks whether to align field names with any emerging A2UI form spec before locking.)

## Design

### The activity model: `Activity` vs `ActivityConfig`

Today, `ActivityConfig` (`backend/db/models/activity_config.py`) is a **per-(teacher, class, activity)** overlay keyed `{teacher_uid}:{class_id}:{activity_id}`, carrying `teaching_goal`, `language`, `difficulty`, and crucially **`paired_workbench: str | None`** — the link to a sim artefact, already nullable. The `activity_id` it overlays currently resolves to a platform-seeded skill/lesson.

The gap: a teacher can *configure* a seeded activity but cannot *create* one. This doc adds a teacher-owned **activity definition**. Two viable shapes (Q1 — decide at M0):

- **(A) Promote `ActivityConfig` to be the definition** for non-sim, teacher-authored activities: when `activity_id` is teacher-minted (not platform-seeded), the config row *is* the activity. Lowest new-surface cost; reuses the shipped overlay + access-control field.
- **(B) New `Activity` entity** the config points at. Cleaner separation, more surface.

**Recommendation: (A) for v1.1.** The composite-key + `owner_id` access protocol already exist; non-sim activities need no artefact registry entry. Revisit (B) if/when branching across classes or a marketplace lands (v2).

### Data-model extension

Extend `ActivityConfig` (camelCased in Firestore, `populate_by_name=True` already set):

```python
WorkbenchType = Literal["app", "drawing", "sensor", "video", "notebook", "none"]

class ChecklistItem(BaseModel):
    id: str                      # stable slug (storage key)
    label: str                   # Danish/English display text

class QuizOption(BaseModel):
    id: str
    label: str
    correct: bool = False        # server-side only; never serialized to student render

class QuizItem(BaseModel):
    id: str
    prompt: str
    options: list[QuizOption]    # 2–6
    explanation: str = ""        # shown after answer (formative)

class MaterialRef(BaseModel):
    doc_id: str                  # existing artifact/doc id (AILANG Parse pipeline)
    label: str

# added to ActivityConfig:
workbench_type: WorkbenchType = Field(default="none", alias="workbenchType")
checklist: list[ChecklistItem] = Field(default_factory=list)
quiz: list[QuizItem] = Field(default_factory=list)
materials: list[MaterialRef] = Field(default_factory=list)
source_activity_id: str | None = Field(default=None, alias="sourceActivityId")  # branching provenance
```

Notes:
- `paired_workbench` (existing) + `workbench_type="app"` together select a sim; `workbench_type="none"` is the chat-only concept activity (M0).
- `QuizOption.correct` is **never** included in the student-facing A2UI payload — grading is server-side (Axiom 10).
- `checklist` generalizes what `ProgressChecklist.tsx` already anticipates: its docstring says *"v0.1 hardcodes Boldkast a/b/c/d in the caller; v1 will source this from skillMetadata.subParts."* This doc makes `subParts` the teacher-authored `checklist`.

### Teacher authoring surface

Builder at `/teacher/activities/new` and `/teacher/activities/[id]` (the `[id]` page already exists at 642 LOC with a "Parameters" wireframe tab — extend it). Sections, each an A2UI/React form block:

```
┌─ New activity ──────────────────────────────────────────┐
│  Name        [ Energibevarelse — gruppe 7B            ]  │
│  Language     (•) Dansk   ( ) English                   │
│  Difficulty   (•) Standard ( ) Guided                   │
│                                                         │
│  Workbench    [ None ▾ ]   None · Sim · Drawing ·       │
│                            Notebook · (Sensor/Video v1.2)│
│   └ if Sim:   [ pick from artefact library ▾ ]          │
│                                                         │
│  Lesson prompt (Socratic teaching goal)                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Guide students to discover energy conservation… │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Progress checklist        [+ add step]                 │
│   1. Identify the system            [×]                 │
│   2. List energy transformations    [×]                 │
│                                                         │
│  Quiz (optional)           [+ add question]             │
│   Q1  What is conserved? ( ) Force (•) Energy …         │
│                                                         │
│  Materials   [ + attach PDF / problem set ]             │
│                                                         │
│             [ Save draft ]   [ Publish to class ▾ ]     │
└─────────────────────────────────────────────────────────┘
```

First-run / empty state (Axiom 11): the builder opens with the **concept-dialogue path pre-selected** and one example checklist row, so a teacher is never staring at a blank form — the "happy path" to a working no-workbench activity is the default.

### Student rendering (per workbench type)

| `workbench_type` | Student surface | Rail |
|---|---|---|
| `none` | Chat-only Socratic dialogue (lesson prompt drives the tutor) | existing chat |
| `app` | Sim in `workspace` (unchanged from today) | MCP App |
| `drawing` | Excalidraw/tldraw board (1.J Type 2) | MCP App (v1.1) |
| `notebook` | Structured-field lab notebook (1.J Type 5) | A2UI form |
| `sensor` / `video` | (1.J Type 3 / 4) | **v1.2** — out of scope here |

Plus two **platform** surfaces layered on any type:
- **Quiz** → A2UI MCQ card rendered inline in chat. Student selects → submit → **server grades** → A2UI feedback card shows correct/incorrect + the teacher's `explanation` (formative). Result emitted to OTel/BQ. Empty state: if `quiz=[]`, no card renders. Error state: malformed item → degrade to plain list (Axiom 5).
- **Progress checklist** → existing `ProgressChecklist`, items now from `checklist`. Loading state: render skeleton rows until config resolves; never a blank pane.

Designed states for every surface (Axiom 11 hard-fail guard): **empty** (no quiz / no checklist → graceful absence, chat still works), **loading** (skeleton), **error** (degrade to plain text). Target viewport: the ~700px workspace pane; the quiz card and checklist are single-column and reflow on mobile-portrait (shared phone is in scope per the mobile tab layout already shipped).

### Quiz mechanism — teacher-authored declarative MCQ (the chosen fork)

Two quiz mechanisms exist in AIPLA; this doc ships the first and is explicit about the boundary:

1. **Teacher-authored declarative MCQ (this doc, v1.1):** fixed items the teacher writes; A2UI-rendered; server-graded; deterministic; zero LLM tokens; fully observable. This is the "activity has a quiz workbench" case from the brief.
2. **Tutor-driven adaptive quiz (KineBot, existing):** the tutor *generates* questions adaptively in-conversation. Different mechanism, already covered by the tutor; **not** what teacher-authoring needs.

Keeping these distinct avoids conflating "teacher made a quiz" with "the AI is quizzing the student" — they have different provenance (Axiom 2), different cost (Axiom 4), and different observability shapes.

### Curriculum-driven authoring (9 June — breadth-over-depth)

Per the 9 June steer (*coverage of the possibility space beats depth on any one bet* — `notes/2026-06-09-curriculum-content-uses.md`), the [curriculum-library](curriculum-library.md) is not just a citation source for the **Materials** picker — it is the **source that makes each new activity cheap to author and measure**, which is what lets the team run many thin probes. Three capabilities live here (the library supplies the corpus + retrieval; the *logic* is authoring-side):

- **#4 Auto-drafted rubric / DRA (the biggest breadth-multiplier).** From the activity's topic + level, retrieve the matching *faglige mål* + *kernestof* and **draft the `checklist`** (and the `dra_map` for [1.K](../v1.0.0-pilot/dra-activity-framework.md)). The teacher edits and accepts — it is a *draft*, not an auto-grade (Axiom 2). This is what makes every activity inherit a measuring stick without hand-authoring; the [notes-summary](end-of-class-notes-summary.md), exit-ticket, and analytics all measure against it.
- **#5 Level calibration (A/B/C).** The activity's `level` (A/B/C) injects the level-specific læreplan scope into the tutor prompt so depth scales to the student (no A-deep tangents with a C student, no trivially-shallow A activity). A field + an InstructionProvider injection, not a new surface.
- **#6 Coverage / gap map.** Map the teacher's existing activities against the *kernestof* → a "covered vs gaps" view that **points at the next probe**. Cheap (one pass over the corpus vs the activity list), doubles as a research instrument, and is the single most strategy-aligned thing to build early. A teacher-view panel + a `aiplatform activity coverage` CLI.

These are **gated on [curriculum-library](curriculum-library.md) landing** (which now runs on **managed ADK RAG — no pgvector build to wait on**; just needs the B/C corpus parsed), so they sequence after the core builder (M0–M3) but can come **much earlier than originally feared**. Per the breadth steer they are **high-value-as-soon-as-unblocked**, not bottom-of-backlog. See M7/M8.

### Per-activity RAG source selection (15 June — first-class authoring control)

15 June sharpened the authoring flow with an explicit teacher control: when authoring an activity,
the teacher **selects which sources feed it** — the activity's RAG inputs — from the A/B/C curriculum
library and their own uploads [M, 15 June]. The ask is *"which curriculum PDFs / uploads are in scope
for **this** activity"*, surfaced as a **selectable, visible set**, not a global corpus.

**Most of this already ships — the 15-June work is making it first-class, not new retrieval plumbing.**
The per-activity scoping landed with [curriculum-library](curriculum-library.md) (1.1.25 M3):

- The activity's `materials: list[MaterialRef]` field **is** the source set. Note the shipped shape
  is `MaterialRef(doc_id, origin)` — the `origin` is cached at citation time so the grounding
  preamble can name the source without an extra read. (The earlier `MaterialRef(doc_id, label)` sketch
  in the *Data-model extension* section above is superseded by the shipped `origin` field; reconcile
  on the next edit of that block.)
- [`build_curriculum_retrieval_tool(materials)`](../../../../backend/adk/curriculum_retrieval.py)
  builds a **single `VertexAiRagRetrieval` tool with `rag_file_ids` scoped to only the cited docs'
  files** — and returns `None` (graceful degradation) when `materials` is empty, the corpus env var
  is unset, or none of the cited docs are RAG-ingested yet. So retrieval is **deny-by-default at the
  activity level**: the tutor reaches only this activity's sources, never the open corpus.
- The builder `MaterialsSection` + `curriculumApi.ts` (1.1.25 M4) are the picker that writes `materials`.

So the **per-activity → pgvector/store mapping** the 15-June note asks us to resolve is already
resolved: scoping is `rag_file_ids` filtering on the single **managed ADK RAG corpus** (ADR-010;
[parent 1.3 pgvector](../SEQUENCE.md) is deferred to the Year-2 self-hosting swap — the retrieval
interface is backend-agnostic, so the activity-level scope carries over unchanged).

**What the 15-June ask still wants (the first-class refinements):**

1. **A visible, editable "Sources for this activity" panel** in the builder — the selected set shown
   as a list the teacher can review and prune per activity, not a control buried in an advanced tab.
   The de-mock (1.1.28) already lit up this picker against real `/api/activity-configs`; this makes
   the *selection* legible.
2. **Per-source include/exclude at author time** with a clear default (cite nothing → tutor uses its
   general physics knowledge ungrounded; cite ≥1 → grounded + attributed). Surface which sources are
   ingested vs pending so the teacher knows what's actually retrievable.
3. **Confirm the framing in the student-facing attribution** — the grounding preamble already tells
   the tutor to attribute to `origin`; the lesson-author resolved-prompt preview ([lesson-author-surface.md](lesson-author-surface.md),
   1.1.27) is where the teacher *sees* that the cited sources made it into the prompt.

Net: this is a **builder-UX sharpening on shipped retrieval scoping**, not a new subsystem — it folds
into the Materials picker + M7/M8 work, not a separate row.

### CLI surface

Per the CLI-affordance rule, ship the commands with the feature (CLI is `aiplatform`, the AIPLA tool):

| Command | Purpose |
|---|---|
| `aiplatform activity list [--class <id>]` | List a teacher's activities |
| `aiplatform activity get <id>` | Print one activity definition (JSON) |
| `aiplatform activity new --type none\|app\|drawing\|notebook [--from <id>]` | Create / branch (`--from` = duplicate) |
| `aiplatform activity push <file>` | Upsert from a local JSON/YAML definition (authoring-as-code for power users / fixtures) |

Each is a thin Click subcommand over the CRUD API (~0.1–0.25d each). Backlink: [local-dev-cli](../../v6.1.0/local-dev-cli.md). No new local process → no `services.yaml` change.

## API changes

> **Reconciled with shipped reality (TAA-1 sprint, M0.0).** The surface already exists as `backend/protocols/activity_config_routes.py` → **`/api/activity-configs`** (composite-key `{teacher_uid}:{class_id}:{activity_id}` upsert; `POST`=201, `PATCH`, `DELETE`, `GET`; body `ActivityConfigUpsert` with `extra="forbid"`; owner-only via `_assert_owns`). **We extend that route, not a new `/api/activities`.** Concretely: `POST /api/activity-configs` becomes the "create" path — `activityId` becomes **optional in the body**, and when absent the backend **mints** one under a `teacher:` slug namespace; `title` is added so created activities have a display name. The `*/duplicate` branch verb (M3) and a list endpoint stay as below. **Q1 (definition shape) is hereby answered (A): promote `ActivityConfig`.** The original `/api/activities` sketch is retained below for the M3+ verbs that don't yet exist.

| Endpoint (sketch — see reconciliation note above) | Change | Auth |
|---|---|---|
| `POST /api/activity-configs` (no `activityId` → mint) | **M0** — create teacher-owned activity; extend body with `workbenchType`/`title` | teacher JWT |
| `PATCH /api/activity-configs/{teacher_uid}/{class_id}/{activity_id}` | **exists** — update definition (generalized upsert) | teacher JWT (owner) |
| `POST /api/activities/{id}/duplicate` | **M3** — branch (sets `source_activity_id`) | teacher JWT (owner) |
| `DELETE /api/activities/{id}` | **New** — soft-delete | teacher JWT (owner) |
| `POST /api/activities/{id}/quiz/grade` | **New** — server-side grade a submission; returns per-item correctness + explanations | student (group) session |
| `GET /api/activities/{id}` | extend payload with `workbenchType`, `checklist`, `quiz` (**without** `correct` flags), `materials` | student or teacher |

The student-facing `GET` strips `QuizOption.correct`; grading happens only via the `grade` endpoint (Axiom 9/10).

## Migration

- Additive Firestore fields with defaults — existing `ActivityConfig` rows read back unchanged (`workbench_type` defaults to `none` for legacy rows, but legacy rows with `paired_workbench` set should backfill to `app`; one-shot migration script, idempotent).
- No BQ breaking change: add an `activity_events` table (or extend `chat_turns`) for quiz responses + checklist ticks — decide alongside [student-engagement-signals.md](student-engagement-signals.md) so the two don't double-instrument.
- Feature-flag the teacher builder route behind a teacher-tier flag so it can ship dark and be enabled per-teacher during the pilot.
- Rollback: route flag off + fields ignored; no data loss.

## Milestone phasing

Ordered so **M0 is independently valuable and lands before the 2026-06-29 freeze**, and each later milestone is shippable on its own through the pilot-iteration window.

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** | **No-workbench concept activity, end-to-end.** `workbench_type` + CRUD `POST/PUT` + teacher builder (name, lang, difficulty, lesson prompt) + `aiplatform activity new/list`. Teacher creates a chat-only Socratic activity, mints a code, student joins. | **~1.5d** | none | **pre-freeze** |
| M1 | **Teacher-authored checklist.** Generalize `ProgressChecklist` to `checklist`; builder checklist editor. | ~1d | none | post-freeze |
| M2 | ~~**Quiz (declarative MCQ).**~~ **RE-HOMED 2026-08-17 → [question-set-element.md](question-set-element.md) (1.1.78).** Designed here 2026-06-08, never built: it waited on "JB/AR on quiz format", and so did the *widget*, which that decision does not gate. It ships as the `questionSet` **workspace element** (not an inline A2UI card — see 1.1.78 *Standards compliance* for why A2UI was rejected), with the `QuizOption` model below reused as-is and the answer-key strip made **registry-driven** (`ElementSpec.redact`) rather than a hand-written branch. **Do not build this row.** | — | — | superseded |
| M3 | **Branching + materials.** `duplicate` endpoint + `--from`; attach existing parsed docs as `materials`. | ~1d | none | post-freeze |
| M4 | **Drawing / notebook workbench types** (1.J Type 2 / 5). | ~2–3d | which type first (JB/AR) | pilot-iteration |
| M5 | **Observability + engagement wiring.** Quiz/checklist events → BQ; co-design with engagement-signals. | ~1d | aligns 1.1.17 | pilot-iteration |
| **M6** | **Equipment co-design (9 June §A).** Teacher describes the lab kit they *have* and what's *missing* ("we have a ramp + photogate but no force sensor"); the AI proposes a **workbench element** to fill the gap — a [notebook](offline-lab-workbench.md)/quiz/checklist activity that works with the available kit, or flags where a sim ([offline-lab](offline-lab-workbench.md) / jitt.dk artefact) substitutes for the missing instrument. A *suggestion* surface in the builder, not autonomous authoring — the teacher edits and accepts. Uses curriculum **#8** equipment-matching. | ~2d | JB/AR on the suggestion scope + the equipment vocabulary | pilot-iteration |
| **M7** ⭐ | **Auto-drafted rubric / level calibration (9 June breadth — curriculum #4 + #5).** From topic + A/B/C level, retrieve *faglige mål* + *kernestof* → **draft the `checklist`/`dra_map`** (teacher edits, not auto-graded) + inject level scope into the tutor prompt. The biggest breadth-multiplier: every activity inherits a measuring stick without hand-authoring. | ~2d | [curriculum-library](curriculum-library.md) landed (**ADK RAG — no pgvector wait**; B/C parsed); JB/AR rubric framing | pilot-iteration (high-value-as-unblocked) |
| **M8** ⭐ | **Coverage / gap map (9 June breadth — curriculum #6).** Map the teacher's activities against the *kernestof* → "covered vs gaps" teacher view + `aiplatform activity coverage`. **Points at the next probe** — the most strategy-aligned early build; doubles as a research instrument. | ~1–1.5d | [curriculum-library](curriculum-library.md) landed | pilot-iteration (high-value-as-unblocked) |

**Curriculum-library wiring (cross-cutting, via [curriculum-library.md](curriculum-library.md)):** the **Materials** picker browses the A/B/C corpus that doc stands up; M7/M8 consume its retrieval for rubric-drafting + the coverage map. All three sequence *with* curriculum-library (gated on 1.3 pgvector + B/C parsing), not blocking M0–M3. The `materials` field already carries the `MaterialRef`s; the library resolves them.

**If the team is consumed by other P1 items:** M0 ships standalone (teachers get from-scratch non-sim activities — the brief's headline ask), and M1–M8 absorb into the 2026-08-14 → 09-15 pilot-iteration weeks. **Breadth-over-depth note:** M7 (auto-rubrics) and M8 (coverage map) are the *strategy-aligned* pieces — pull them forward to "build as soon as curriculum-library unblocks," ahead of the heavier per-type workbench work (M4), because they make every *other* probe cheaper and measurable.

## Testing strategy

- **Backend (pytest):** `ActivityConfig` round-trip with new fields + legacy back-compat; CRUD route auth (owner-only PUT/DELETE; cross-teacher 403); `grade` endpoint correctness + that `GET` never leaks `correct`; quiz-spec validation (2–6 options, ≥1 correct) and malformed-spec rejection.
- **Frontend (vitest):** builder form validation + draft/publish; quiz A2UI render *without* correctness leaking into DOM; quiz feedback render; `ProgressChecklist` sourcing items from config (regression-guard the Boldkast hardcoded path → config path); empty/loading/error states for each surface.
- **E2E / manual (LOCAL_MODE):** teacher creates a no-workbench activity (M0 acceptance, <5 min), mints code, anon student joins, has a Socratic chat. M2: author 3-item quiz, student answers, BQ shows responses.
- **Eval:** the lesson prompt still obeys the verbosity + Socratic constraints (1.1.1) — reuse the existing guard.

## Human gates (tee up to JB/AR now)

1. **JB/AR — quiz format** (gates M2): MCQ only for v1.1? Single- vs multi-select? Is `explanation` shown always, or only on wrong answers? Formative framing (consistent with [student-engagement-signals.md](student-engagement-signals.md): formative, not sanctionary).
2. **JB/AR — which workbench type ships after `none`** (gates M4): drawing board vs lab notebook first, based on pilot lesson plans.
3. **JB — materials retention** posture for teacher-uploaded curriculum extracts (reuse the [student-multimodal-upload.md](student-multimodal-upload.md) image-retention decision rather than re-deciding).

## Open questions

- **Q1 — definition shape:** ~~promote `ActivityConfig` (A) vs new `Activity` entity (B)~~ **ANSWERED (A) in TAA-1 M0.0** — `ActivityConfig` is promoted; a teacher-minted `activity_id` (under a `teacher:` slug namespace) makes the config row the activity definition. Revisit (B) only if cross-class reuse / marketplace lands (v2).
- **Q2 — class binding:** does an authored activity belong to one class or can a teacher reuse it across their classes? (Per-class is simplest; cross-class reuse is a v2 marketplace seed.)
- **Q3 — quiz schema naming:** align `QuizItem`/`QuizOption` field names with any emerging A2UI form convention before locking, to avoid a rename later (Axiom 6 follow-through).
- **Q4 — grading visibility:** are quiz scores part of the teacher session report / engagement tab, or student-private formative only? (Pedagogical — JB/AR.)

## Risks

- **Scope vs freeze (primary).** Full builder > one sprint. Mitigated by the M0-first phasing; the risk is *descoping discipline*, not technical.
- **Cohort comparability.** Teacher-authored activities diverge across classes — same research concern flagged in [teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) Q3. Capture the authored definition in the session report so research can control for it.
- **Quiz ≠ sanction.** A teacher-authored MCQ can read as a test. Framing + the formative `explanation` keep it aligned with the engagement-signals stance ("improve the lesson, don't grade the student").
- **Builder bloat on the student bundle.** Avoided by code-splitting the teacher route (Axiom 10) — verify the student bundle is unchanged in CI bundle-size check.

## Success criteria

- [ ] Teacher creates a no-workbench concept activity and a student completes a Socratic session against it (M0).
- [ ] `aiplatform activity new --type none` and `... list` work end-to-end.
- [ ] Teacher authors a ≥3-item quiz; student answers; server grades; responses in BigQuery; `correct` flags never reach the student payload (M2).
- [ ] `ProgressChecklist` renders teacher-authored items (Boldkast path still green) (M1).
- [ ] Branch (`duplicate` / `--from`) produces an editable copy with `source_activity_id` set (M3).
- [ ] Every student surface has a designed empty / loading / error state; no blank void at ~700px (Axiom 11).
- [ ] Net axiom score ≥ +4 maintained; SECURE-by-construction mitigations implemented as specified.

## Related documents

- [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) — workbench type system (1.J); the source of `workbench_type`
- [teacher-artefact-parameters.md](../post-pilot/teacher-artefact-parameters.md) — tier-2 bounded knobs (complementary; pilot-gated)
- [teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md) — tier-3 code authoring (Year-2; the "author a new sim" path explicitly excluded here)
- [teacher-ui.md](../v1.0.0-pilot/implemented/teacher-ui.md) — Phase 2 `ActivityConfig` parent surface
- [student-engagement-signals.md](student-engagement-signals.md) — quiz/checklist events feed the engagement tab; co-design the BQ shape
- [curriculum-library.md](curriculum-library.md) — the A/B/C corpus the **Materials** picker cites (9 June §A library half)
- [offline-lab-workbench.md](offline-lab-workbench.md) — a `notebook` activity type M6 co-design proposes; consumes 1.J Type 5
- [tutor-personas.md](tutor-personas.md) — the `interaction_style` field rides this builder's activity-config surface
- [mcp-app-artefact skill](../../../../.claude/skills/mcp-app-artefact/SKILL.md) — the sim-authoring runbook (the MCP-App side of the A2UI/MCP split)
- [june-15-feedback.md](june-15-feedback.md) — the 15-June check-in map; this doc absorbs its "teacher chooses RAG inputs" item
- ADR-015 (unified multi-surface UI) + ADR-013 (artefact safety) — scoping-site `architecture.qmd`
