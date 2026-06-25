# Activity element palette — an extensible set of teacher-authorable workbench elements

**Status:** M0 (registry) + M1 (data table) + M2 (chart) + M3 (calculator) + M4 (note) **SHIPPED 2026-06-22**, end-to-end — the **v1.1 palette is complete** (4 new elements on the registry). M5 (observability) planned. (P1, v1.1 — phased; each element an independent thin probe.)
**Last Updated:** 2026-06-17 (17 June teacher check-in — Aswin: *"more guided form actions"* + M: more elements than just the checklist)
**Priority:** **P1** — the activity-element layer is currently **one** live element (checklist). Teachers want to assemble richer activities (data tables, charts, calculators, inline documents) without a developer. This is the **breadth multiplier on the activity-element axis**: it makes *adding the next element type* a bounded, repeatable recipe rather than a bespoke build.
**Estimated:** ~1d M0 registry substrate + ~1–2d per element (table, chart, calculator, document) — each independently shippable
**Scope:** Fullstack — `backend/db/models/activity_config.py` (element models + registry) + `backend/protocols/activity_config_routes.py` (validation) + new A2UI / React workspace element renderers under `frontend/src/components/workspace/elements/` + `frontend/src/app/teacher/activities/` (per-element editors) + `frontend/src/lib/teacherApi.ts` (types) + `aiplatform activity` CLI parity
**Dependencies:** [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — the parent builder; this generalises its `checklist`/`quiz`/`materials` fields into a registry); [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J — the workbench *type* layer this element layer sits on top of); [offline-lab-workbench.md](offline-lab-workbench.md) (1.1.24 — the data-table element shares its wire shape and ground-truth checking); [documents-workbench-surface.md](documents-workbench-surface.md) (1.1.33 — the document element reuses its render + `MaterialRef`); [curriculum-library.md](curriculum-library.md) (1.1.25 — `MaterialRef`); ADR-015 (unified multi-surface UI / A2UI), ADR-013 (artefact safety) in the scoping site
**Source:** 17 June teacher check-in note ([june-17-feedback.md](june-17-feedback.md)) + M's framing: *"create more elements teachers can include (checklist at the moment) — upload documents, tables, charts, calculator, etc."*

> **Read this with [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19).** That doc is the umbrella for *"a teacher creates an activity from scratch"* and already owns the first three elements as **fixed fields** (`checklist` shipped, `quiz` designed, `materials` shipped). This doc is the **substrate underneath them**: it reframes the element layer from "a handful of hardcoded fields" into a **bounded element registry** so the next element (table / chart / calculator / document) is an additive entry, not a schema rewrite. The companion [activity-authoring-assistant.md](activity-authoring-assistant.md) (1.1.39) is the AI co-pilot that *assembles* elements from this palette for a non-technical teacher — it consumes this doc.

> **Follow-ups (2026-06-22).** Two authoring-UX additions on top of the palette:
> (1) **Starter templates SHIPPED** — [`activityTemplates.ts`](../../../../frontend/src/lib/activityTemplates.ts) + [`TemplatePicker`](../../../../frontend/src/components/teacher/TemplatePicker.tsx): quick-default activities (concept-dialogue, measurement-lab+chart, **kastebevægelse/Boldkast companion** — vinkel vs. rækkevidde, calculator, energy-note) a teacher picks and modifies, so the builder is never a blank form. The Boldkast template is a **projectile-motion companion** (data-table + chart + reflection that pairs with the Boldkast sim — not a config of the sim, which is its own skill). Physics content is JB/AR-reviewable starter material.
> (2) **Live preview mode DESIGNED** — [activity-preview-mode.md](activity-preview-mode.md) (1.1.40): an in-builder pane that renders the workspace elements exactly as a student sees them, live + interactive, reusing the shipped `WorkspaceElements`. Complements [1.1.27](lesson-author-surface.md) (prompt + trial chat).

## Why this exists

The platform architecture already draws the line this doc builds on. From [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md#L30):

> Each workbench type provides **one interactive student surface** … It does **not** provide instructions, procedure checklists, AI chat, quizzes, **data tables**, or formula references. Those are AIPLA's job.

So there are two layers, and the user's ask is squarely about the second:

| Layer | What it is | Where it lives | State today |
|---|---|---|---|
| **Workbench *type*** | The single interactive surface (`app` sim / `drawing` / `notebook` / `sensor` / `video` / `none`) | [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) (1.J), `workbench_type` on `ActivityConfig` | `app`/`none` live; rest designed |
| **Platform *elements*** | Composable things layered on **any** surface: checklist, quiz, **data table, chart, calculator, inline document** | `ActivityConfig` fields + `frontend/src/components/workspace/*` | **Only `checklist` is live**; `quiz` designed (1.1.19 M2); `materials` shipped |

The element layer is currently **three special-cased fields**:

```python
# backend/db/models/activity_config.py (today)
checklist: list[ChecklistItem]      # SHIPPED — ProgressChecklist.tsx
materials: list[MaterialRef]        # SHIPPED — DocumentsPanel.tsx (1.1.25)
# quiz: list[QuizItem]              # DESIGNED, not built (1.1.19 M2)
```

Every new element under that model is a new field + a new render branch + a new editor + a new validator, re-derived each time. That is exactly the "each feature ships its own slice and stops at its own boundary" pattern called out in [documents-workbench-surface.md](documents-workbench-surface.md#L21). The fix is to make the element layer a **registry** once, so the marginal cost of element N is a small, mechanical entry — the same move [teacher-ui-consolidation.md](teacher-ui-consolidation.md) (1.1.26) made for teacher config panels, applied to activity elements.

## Goals

**Primary goal:** A teacher composes an activity from a **palette of vetted element types** — checklist, data table, chart, calculator, inline document — each authored in the builder, rendered deterministically in the student workspace, and readable by the Socratic tutor. Adding the *next* element type is a documented ~1-day recipe, not a schema rewrite.

**Success metrics:**

- A teacher adds a **data table** (teacher-defined columns) to an activity; a student fills it in; the tutor can reference the entered values — end-to-end, no developer.
- Adding a brand-new element type to the platform is a **single registry entry + one renderer + one editor**, demonstrated by shipping four elements (table, chart, calculator, document) against the same recipe.
- Every element has a designed **empty / loading / error** state and reflows in the ~700px workspace pane on a shared phone (Axiom 11).
- The teacher-entered formula in the calculator element **cannot execute arbitrary code** (Axiom 9 — safe-evaluator construction, see Security).
- Zero new storage systems and zero new wire protocols — elements extend `ActivityConfig` and ride the existing `iframe-context` / A2UI state paths.

**Non-goals (explicit):**

- The **quiz** element — already owned by [teacher-activity-authoring.md](teacher-activity-authoring.md) M2 (this doc *re-homes* it onto the registry but does not re-design the quiz itself).
- Authoring *new sims / lab artefacts* (tier-3, [teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md), Year-2). Elements are **declarative and platform-rendered**; raw-HTML/JS authoring stays out.
- A fully free-form **`elements[]` composition array** with arbitrary ordering / multiple-of-a-kind / drag-reorder. v1.1 ships elements as additive *typed slots* (lowest migration risk); the array generalisation is the post-pilot evolution this registry makes cheap (see *The `elements[]` array — post-pilot evolution*).
- The **AI assembly** of elements — that is [activity-authoring-assistant.md](activity-authoring-assistant.md) (1.1.39).

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Elements render as deterministic A2UI / React platform components in the workspace pane — **no MCP-App iframe cold-start** (the optional document *preview* is the only iframe, and only on demand). |
| 2 | EARNED TRUST | +1 | Element **content** is teacher-authored (reviewable provenance); element **data** (table cells, calculator inputs) is the student's own work. The tutor *reads* this state, it does not fabricate or auto-grade it (the checklist precedent — student-driven, agent never decides "done"). |
| 3 | SKILLS, NOT FEATURES | +1 | The headline: adding an element type becomes a **bounded registry recipe**, not a developer feature each time. The palette is a breadth multiplier — every future probe inherits cheaper elements. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Table entry, chart rendering, and calculator evaluation are **deterministic — zero LLM tokens**. The tutor reads the resulting state; no reasoning model is spent where arithmetic suffices. |
| 5 | GRACEFUL DEGRADATION | +1 | Per-element fallbacks: malformed table spec → plain rows; chart with no data → the underlying table; invalid calculator formula → element disabled with a teacher-visible validation error, never a student-facing crash; empty element list → chat-only activity still works. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Elements render through **A2UI** and report state via the existing **`iframe-context`** path the checklist already uses; definitions extend the **Pydantic `ActivityConfig`** schema. The registry is an internal *pattern*, not a new wire protocol. |
| 7 | API FIRST | +1 | Element CRUD rides the existing `/api/activity-configs` upsert; `aiplatform activity` gets element parity. The web builder and any future channel render the same contract. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Element interactions (table commits, calculator evaluations, document opens) become OTel spans → `chat_turns` / `activity_events` in BigQuery; feeds [student-engagement-signals.md](student-engagement-signals.md). |
| 9 | SECURE BY CONSTRUCTION | 0 | The calculator's **teacher-entered formula is evaluated user input** — the one real risk. Held to **neutral by construction**, not discipline: a whitelisted safe-expression grammar (no `eval`/`Function`/`__import__`), server-side validation at author time, and the registry's hard rule that **every element is declarative** (no raw HTML/script/iframe — that capability is reserved for tier-3 with its own ADR-013 review). See Security. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Element definitions, validation, and calculator evaluation live backend (the formula is graded server-side, like the quiz `correct` flag); the frontend renders state only. The teacher builder is a code-split teacher-only route — student bundle unaffected. |
| 11 | USABLE BY DESIGN | +1 | Every element has a designed empty / loading / error state and a single-column ~700px reflow specified **before** build; the builder's per-element editor opens in a non-blank first-run state. |
| | **Net Score** | **+10** | Threshold: ≥ +4. SECURE held at 0 by construction (parallel to 1.1.19's reasoning). No student-facing −1; ≤ 2 axioms at −1. Hard-fail passes. |

## Standards compliance

Per Axiom 6, no custom protocol is introduced:

- **Student rendering:** A2UI declarative components / platform React components in the workspace pane (the same capability the checklist and teacher-config forms already use). The only iframe is the optional document *preview*, which reuses the **sandboxed artefact frame** (ADR-013) — no new renderer.
- **State reporting:** element interactions ride the existing **`POST /api/sessions/{id}/iframe-context`** path the checklist already pushes to (so the tutor's InstructionProvider sees element state with no new plumbing).
- **Element definition:** extends the existing Pydantic `ActivityConfig` (`backend/db/models/activity_config.py`) — a **discriminated set of typed element models**, not a new schema language.
- **Registry:** a backend `ELEMENT_REGISTRY: dict[str, ElementSpec]` (validator + default + max-size) and a frontend `elementRenderers: Record<ElementKind, Component>` — an internal dispatch pattern, the same shape as the existing sim dispatch in [workspaceContent.ts](../../../../frontend/src/app/chat/[...path]/workspaceContent.ts).

## Design

### The registry (M0 — the substrate)

Reframe the element layer from special-cased fields to a **registered element kind**. Each element is a small Pydantic model tagged with a `kind`; the registry maps `kind → (validator, max count, default render location)`. The three existing concerns become the first registry entries — the `checklist` shipped today and the `quiz` from 1.1.19 M2 are **not re-designed**, only re-homed.

```python
# backend/db/models/activity_config.py (extension)

ElementKind = Literal["checklist", "quiz", "table", "chart", "calculator", "document"]

class ChecklistElement(BaseModel):      # re-homes the shipped checklist
    kind: Literal["checklist"] = "checklist"
    items: list[ChecklistItem]          # existing ChecklistItem(id, label)

class TableColumn(BaseModel):
    id: str
    label: str
    unit: str = ""                      # e.g. "s", "m/s" — shown in the header, drives the units-loop
    kind: Literal["number", "text"] = "number"

class TableElement(BaseModel):
    kind: Literal["table"] = "table"
    title: str = ""
    columns: list[TableColumn]          # 1–8
    rows: int = Field(default=5, ge=1, le=50)   # teacher seeds an empty grid; student fills cells
    # ground-truth checking is the offline-lab (1.1.24) extension, NOT authored here

class ChartElement(BaseModel):
    kind: Literal["chart"] = "chart"
    title: str = ""
    chart_kind: Literal["scatter", "line", "bar"] = "scatter"
    source_table_id: str | None = None  # plot a TableElement the student filled; None = teacher static series
    x_col: str | None = None            # column ids when source_table_id is set
    y_col: str | None = None
    series: list[ChartPoint] = Field(default_factory=list)  # teacher static reference series

class CalculatorElement(BaseModel):
    kind: Literal["calculator"] = "calculator"
    title: str = ""
    mode: Literal["scientific", "formula"] = "formula"
    formula: str = ""                   # formula mode: "v = s / t" — safe-grammar validated (see Security)
    inputs: list[CalcInput] = Field(default_factory=list)   # named variables shown as fields

class DocumentElement(BaseModel):
    kind: Literal["document"] = "document"
    material: MaterialRef               # reuses the shipped MaterialRef(doc_id, origin, student_visible)
    inline: bool = True                 # show in the activity flow vs only in the Documents tab (1.1.33)
```

**The recipe to add element N** (the deliverable — this is "a way to add elements"):

1. Add `ElementKind` value + a Pydantic `<Name>Element` model with a `kind` discriminator + bounded fields (the registry rejects unbounded text/lists).
1b. **⚠ Thread the `list[<Name>Element]` field through ALL THREE activity stores — the ALS-1 split doubled the surface.** It's not enough to add it to `ActivityConfig`: also add it to the class-independent `Activity` model (`db/models/activity.py`) and the `ActivityUpsert` request body (`protocols/activity_routes.py`, `extra="forbid"`), and **map it in BOTH adapters** (`_activity_from_body` and `_activity_to_config`). Miss the `ActivityUpsert` field → the builder's `<field>: []` 422s with `extra_forbidden`; miss `_activity_to_config` → it creates fine but the student never sees the element. `test_every_element_field_is_present_on_all_activity_models` fails loudly on a missing **model** field, but the **adapter mappings aren't auto-checked** — add a POST→GET round-trip test (the 1.1.48 `document` regression was exactly this gap).
2. Register `ELEMENT_REGISTRY["<kind>"] = ElementSpec(model=..., max=..., render="workspace"|"inline")`.
3. Add a frontend renderer `elementRenderers["<kind>"]` (a workspace pane component) + the TS type mirror in `teacherApi.ts`.
4. **⚠ If a student INTERACTS with the element** (enters data, computes, writes, selects): the renderer MUST pass `sessionId`, and the component MUST push its state to the tutor via `useSimSnapshotPush(sessionId, "<kind>")` (commit-on-blur/change + catch-up-on-`sessionId`, like `WorkbenchTable`/`WorkbenchCalculator`/`SolutionElementMount`). The state lands in `mcp_app_context.<kind>.state`, which `wrap_with_iframe_context` injects into **every** agent's prompt — this is **NOT** MCP-app-specific. **Skip this and the AI never sees what the student did** (it was missed for the calculator until 1.1.45). Read-only elements (note) don't push. Use a `<kind>.commit`-style event name so it's *passive* context (no unprompted tutor reply); only fire a turn deliberately (the solution editor's "submit" does, via `onProactiveTrigger`).
5. Add a per-element builder editor block (reuse the `ElementEditor` shell from M0).
6. Add OTel span emission for the element's primary interaction.
7. Tests: round-trip + validation + render empty/loading/error + (if it ingests student input) the tutor-state push + the deterministic-check path.

This recipe, written down and exercised four times in this doc, **is** the breadth multiplier — it is the artefact a future teammate (or the [authoring assistant](activity-authoring-assistant.md)) follows.

### Storage shape — additive typed slots now, array later

v1.1 keeps the **typed-slot** storage that ships today (lowest migration risk): the existing `checklist`/`materials` fields stay, and `table`/`chart`/`calculator`/`document` arrive as parallel optional fields, each `list[<Name>Element]` (usually length 0 or 1 in v1.1). The registry — not the field list — is the source of truth for "what element kinds exist", so the eventual move to a single `elements: list[ActivityElement]` ordered array (below) is a data migration, not a redesign.

```python
# added to ActivityConfig (additive; legacy rows read back unchanged):
table: list[TableElement] = Field(default_factory=list)
chart: list[ChartElement] = Field(default_factory=list)
calculator: list[CalculatorElement] = Field(default_factory=list)
document: list[DocumentElement] = Field(default_factory=list)
```

### Where elements render

The platform elements populate the **workspace pane** (the ~700px surface that today shows the checklist or a sim), composed as a **stack or tabs** alongside the [Documents tab](documents-workbench-surface.md) (1.1.33). The one exception is **quiz**, which 1.1.19 M2 renders as an inline-chat A2UI card; the registry records this via the `render` field (`"workspace"` vs `"inline"`).

| Element | Render location | Rail | Notes |
|---|---|---|---|
| checklist | workspace pane | A2UI/React | existing `ProgressChecklist` |
| table | workspace pane | A2UI/React | student-fillable grid; commits via `iframe-context` |
| chart | workspace pane | A2UI/React (SVG/canvas) | plots a table or a teacher series; deterministic |
| calculator | workspace pane | A2UI/React | formula or scientific; server-evaluated formula |
| document | workspace pane / Documents tab | reuse 1.1.33 + ADR-013 preview | inline placement vs aggregated tab |
| quiz | **inline chat** | A2UI card (1.1.19 M2) | not re-designed here |

**Open question (Q1 — composition with a sim):** when `workbench_type="app"` (a sim owns the pane), how do platform elements coexist — tabs (`Sim | Table | Documents`), or a stacked secondary panel? Today the dispatch is one-or-the-other ([workspaceContent.ts](../../../../frontend/src/app/chat/[...path]/workspaceContent.ts)). The 1.1.33 Documents-tab direction (tabs in the workbench) is the natural answer; confirm before M1 so the table element lands into the right shell.

### The four new elements

**1. Data table** *(~1.5d; shares wire with 1.1.24 + 1.J Type 5).** A teacher defines columns (label + unit + number/text) and a row count; the student fills cells; the committed grid pushes to `iframe-context` so the tutor can reference entered values ("your third trial gives v = 2.1 m/s — does that fit?"). The **units header** carries the units-loop the multimodal guardrail (1.1.21) already establishes. This is the lightweight, A2UI version of the [Type-5 lab notebook](../v1.0.0-pilot/expanded-workbench-types.md) structured-fields surface; [offline-lab-workbench.md](offline-lab-workbench.md) (1.1.24) **extends** this same table with teacher-supplied ground-truth ranges + deterministic checking — so the table element ships the *wire shape and render*, and 1.1.24 adds the *checking layer* on top (no duplicate surface).

**2. Chart** *(~1.5d; pairs with the table).** Renders a deterministic chart in the workspace pane. Two modes: (a) **plot the student's table** (`source_table_id` + `x_col`/`y_col`) — e.g. the v-vs-t the student just logged; (b) a **teacher static reference series** (display-only). SVG/canvas, zero LLM. Distinct from sim-internal graphs (KineBot) and from in-chat streamed SVGs (1.1.15) — this is the *teacher-authorable, data-bound* chart. Degradation: no data yet → show the empty axes + the source table beneath.

**3. Calculator** *(~2d; the security-sensitive one — gated).** Two modes: (a) **scientific** — a generic bounded scientific calculator widget (no authoring); (b) **formula** (the pedagogically interesting one) — the teacher writes a formula like `v = s / t` and names the inputs; the student plugs in values and the element computes the result. The formula is **the** Axiom-9 surface (teacher input that gets evaluated) — see Security. Formula evaluation is **server-side** (Axiom 10), mirroring quiz grading: the student's inputs `POST` to an evaluate endpoint, the safe-evaluated result returns. Gated on JB/AR confirming the formula set real lessons need (and whether free-formula or a curated formula library is the v1.1 cut).

**4. Document (inline)** *(~0.5–1d; mostly reuse).** Surfaces a specific teacher-attached `MaterialRef` **inline at a point in the activity** (vs the aggregated [Documents tab](documents-workbench-surface.md)). This is deliberately the thinnest element — it is `MaterialRef` (shipped, 1.1.25) + `studentVisible=true` (1.1.33 M2) + the 1.1.33 render, exposed as an authorable element rather than a new store. Honest framing: **this element is ~90% reuse**; it exists in the palette for authoring symmetry, not because it needs new plumbing.

### The `elements[]` array — post-pilot evolution (signal, not committed)

Once teachers want **multiple of a kind**, **arbitrary ordering**, or **drag-reorder**, the typed-slot model is replaced by a single ordered `elements: list[ActivityElement]` discriminated union. Because the **registry already owns "what kinds exist"**, this is a one-shot, idempotent data migration (project each typed slot into an ordered array entry), not a redesign. Flag, don't build, in v1.1 — the pilot will say whether composition richness is actually wanted, consistent with the breadth-over-depth steer (ship many thin elements first; add composition only if lessons demand it).

### CLI surface

Per the CLI-affordance rule, element authoring gets `aiplatform activity` parity (extends the subcommands [teacher-activity-authoring.md](teacher-activity-authoring.md) defines):

| Command | Purpose |
|---|---|
| `aiplatform activity add-element <id> --kind table\|chart\|calculator\|document [--file spec.json]` | Add an element to an activity from a JSON/YAML spec |
| `aiplatform activity elements <id>` | List an activity's elements (kinds + summaries) |

Thin Click adapters over the existing `/api/activity-configs` upsert (~0.1–0.25d each).

## API changes

> **Extends `backend/protocols/activity_config_routes.py` → `/api/activity-configs`** (the same composite-key upsert 1.1.19 reconciled to). No new resource route; the element fields ride the existing `ActivityConfigUpsert` body (`extra="forbid"`, owner-only).

| Endpoint | Change | Auth |
|---|---|---|
| `POST` / `PATCH /api/activity-configs[/…]` | extend `ActivityConfigUpsert` with `table`/`chart`/`calculator`/`document`; per-kind server validation via `ELEMENT_REGISTRY` | teacher JWT (owner) |
| `GET /api/activity-configs/…` (+ student activity GET) | return elements; **strip any answer/ground-truth fields** (none in v1.1 table/chart; future-proof) | student or teacher |
| `POST /api/activities/{id}/calculator/{eid}/evaluate` | **New** — server-side safe-evaluate a formula calculator submission; returns the numeric result + per-input validation | student (group) session |

## Security

The calculator **formula** is the only new input that gets *evaluated* (the table/chart/document elements render data, they do not execute it). Held to Axiom-9 neutral **by construction**:

- **Safe grammar, never `eval`.** Formulas parse through a whitelisted arithmetic grammar (numbers, named variables, `+ - * / ^`, parentheses, a fixed function allowlist `sqrt/sin/cos/tan/ln/log/abs/exp`). No Python `eval`/`exec`/`Function`, no attribute access, no `__import__`. A vetted safe-expression evaluator (or a tiny hand-rolled shunting-yard) — decided at M3; whichever, it is **input-validated at author time** (the builder rejects an unparseable formula before save) and **re-validated server-side** at evaluate time.
- **Declarative-only registry rule.** The registry **forbids** any element kind whose config reaches a raw-HTML/script/iframe render. Teacher text becomes a label, a column header, or a formula token — never executable markup. That capability is deliberately reserved for tier-3 ([teacher-artefact-authoring.md](../post-pilot/teacher-artefact-authoring.md)) with its own ADR-013 review.
- **Same auth + injection boundary as today.** Authoring sits behind the existing teacher Firebase-auth gate; element content reaching the tutor prompt rides the **already-reviewed `{teacher_focus}` / `iframe-context` injection paths** — no new vector.
- **Bounded sizes.** Every element model caps its lists/strings (columns ≤ 8, rows ≤ 50, formula length, label length) — the registry enforces a per-kind `max`, so a malformed/oversized element is rejected, not rendered.

## Migration

- Additive Firestore fields with defaults — existing `ActivityConfig` rows read back unchanged (new element lists default empty). The shipped `checklist`/`materials` fields are untouched in v1.1 (the registry *describes* them; it does not rewrite them yet).
- BQ: element interactions extend the `activity_events` shape decided alongside [student-engagement-signals.md](student-engagement-signals.md) (1.1.17) — co-design so the two don't double-instrument.
- Feature-flag each element kind behind the teacher-tier flag so kinds ship dark and enable per-teacher during the pilot.
- Rollback: kind flag off + field ignored; no data loss. The `elements[]` array migration (post-pilot) is one-shot + idempotent + reversible (slots remain readable).

## Milestone phasing

Ordered so **M0 is the reusable substrate** and each element is an independent, JB/AR-pickable probe.

| MS | Deliverable | Est | Gate | Lands |
|---|---|---|---|---|
| **M0** ✅ | **Element registry substrate — SHIPPED 2026-06-22.** Backend `ELEMENT_REGISTRY` (`ElementKind`/`ElementSpec` with field/max/render) + a model-level cap validator on `ActivityConfig` (re-homes the shipped `checklist`, no behaviour change) + the typed frontend contract mirror (`frontend/src/lib/activityElements.ts`) consumed by the workspace dispatch + consistency/cap tests both ends + the **"add element N" recipe**. **Deliberately scoped to the registry/contract/validation substrate**; the uniform renderer-component interface + `ElementEditor` shell move to M1 (extracting them from a single element is premature — the table is the right second data point). | ~1d | none | **shipped** |
| **M1** ✅ | **Data table element — SHIPPED 2026-06-22.** End-to-end: backend `TableColumn`/`TableElement` + registry entry + route/DB; student-fillable grid (`WorkbenchTable`) committing via `iframe-context` (units header, sessionStorage, catch-up push); teacher column/row editor (`TableEditor`) in `/teacher/activities/new`; the uniform `elementRenderers` dispatch (the M0-deferred abstraction, landed at n=2). **Q1 resolved: stack, not tabs** (consistent with `DocumentsPanel`). Shares the wire shape [offline-lab](offline-lab-workbench.md) (1.1.24) extends. *The reusable `ElementEditor` builder shell is **deferred to the 3rd element*** — extracting it from one editor is premature (same n=1 discipline as M0). *Edit-page table editing + multi-table author UI also deferred* (create-flow + single-table for v1.1, matching the checklist). | ~2.5d | — | **shipped** |
| **M2** ✅ | **Chart element — SHIPPED 2026-06-22.** Deterministic SVG chart (`WorkbenchChart`: scatter / line / bar) that **auto-plots the activity's data table** (first two numeric columns), reactive to table edits via the `aipla:table-change` event; builder `ChartEditor` (title + type). *Scoped to auto-plot-the-table* — per-column selection + teacher static series deferred (avoids fragile chart↔table column-id coupling at author time). | ~1.5d | M1 (done) | **shipped** |
| **M3** ✅ | **Calculator element — SHIPPED 2026-06-22.** Teacher-authored **formula** calculator: `CalcInput`/`CalculatorElement` models; student `WorkbenchCalculator` (named inputs → live result); builder `CalculatorEditor` with **live formula validation**. The Axiom-9 boundary is a **hand-rolled safe-expression evaluator** ([`safeFormula.ts`](../../../../frontend/src/lib/safeFormula.ts) — whitelisted recursive-descent grammar, no `eval`/`Function`/property access; 13 adversarial cases incl. `constructor`/`require`/`a.b`/`__proto__` → all refused). *Deviations:* **client-side eval** (it's a tool, not a graded answer — instant + offline; the safe parser is the boundary, so no server `evaluate` endpoint); **formula mode only** (scientific deferred); the formula **content set** remains a JB/AR input (the *mechanism* is built, un-gated). | ~2d | safe-eval (in-house, no new dep) | **shipped** |
| **M4** ✅ | **Note element — SHIPPED 2026-06-22 (reinterpreted from "document").** The originally-planned *document* element (surface a `MaterialRef` inline) is **~90% redundant** with the shipped `materials` field + `DocumentsPanel` (1.1.33), so M4 instead ships the genuinely-additive **note / instructions** element — a teacher-authored **Markdown** reference card (`NoteElement` + `WorkbenchNote`, reusing `ChatMarkdown`; builder `NoteEditor`). This is the architecture's *"instructions / formula references are AIPLA's job"* element, distinct from uploaded materials. Inline-material-surfacing stays in 1.1.33. | ~1d | none | **shipped** |
| **M5** | **Observability + engagement wiring.** Element interactions → OTel → BQ; co-design with 1.1.17. | ~1d | aligns 1.1.17 | pilot-iteration |

**If the team is consumed by other P1 items:** M0 + M1 (table) are the high-value slice (a data-logging activity is the most-requested non-sim element after the checklist, and unblocks 1.1.24). M2–M5 absorb into the 2026-08-14 → 09-15 pilot-iteration weeks. Per the breadth steer, **the registry (M0) is the leverage** — it is what makes every later element, and the [authoring assistant](activity-authoring-assistant.md)'s `add_element` tool, cheap.

## Testing strategy

- **Backend (pytest):** each element model round-trips with `ActivityConfig` + legacy back-compat; registry validation (oversized/malformed element rejected; declarative-only rule enforced); calculator `evaluate` correctness + the safe-grammar refusing `eval`-class input (a fuzz/adversarial case set: `__import__`, attribute access, oversized expressions); `GET` strips any future answer fields.
- **Frontend (vitest):** per-element renderer empty/loading/error states; table commit → `iframe-context` payload shape; chart renders from a table + degrades to the table when empty; calculator input validation; builder per-element editor add/remove/validate; checklist regression-guard (the re-home must not change shipped behaviour).
- **E2E / manual (LOCAL_MODE):** teacher adds a table to an activity, mints a code, anon student fills it, tutor references a cell value (M1 acceptance). M3: teacher writes `v = s/t`, student computes, server evaluates.
- **Eval:** an activity with elements still obeys the verbosity + Socratic constraints (1.1.1) — reuse the guard.

## Human gates (tee up to JB/AR now)

1. **JB/AR — which elements real lessons need, and in what order** (gates M2–M4): the breadth-vs-depth call — build the table if every lab logs readings; skip charts if nobody plots; pick the formula set for the calculator. Let the pilot lesson plans choose, not us.
2. **JB/AR — calculator formula scope** (gates M3): free-form teacher formula vs a curated formula library; is the result shown always or on student request; single formula vs multi-step.
3. **Q1 — sim composition** (gates M1 placement): tabs vs stacked when a sim already owns the workspace pane (engineering can propose; JB/AR confirm the teacher-facing model).

## Open questions

- **Q1 — sim composition:** how platform elements coexist with an `app`-type sim in the workspace pane (tabs per 1.1.33 vs stacked). **Answered by [teacher-sim-resources.md](teacher-sim-resources.md) (1.1.41):** the **sim is the workbench surface** (`workbench_type="app"` + `artefact_id`) and the elements **layer on top** — the [preview](activity-preview-mode.md) (1.1.40) renders both; stacked-below for M0, tabs a later enhancement.
- **Q2 — table vs Type-5 notebook boundary:** the data-table element and the [Type-5 lab notebook](../v1.0.0-pilot/expanded-workbench-types.md) (1.J) overlap. Recommendation: the **table element is the notebook's structured-field primitive** — 1.J Type 5 becomes "a workbench surface composed of table element(s)", not a parallel implementation. Confirm so they don't fork.
- **Q3 — calculator eval location:** server-side `evaluate` (Axiom 10, consistent with quiz grading, auditable) vs client-side safe-eval (instant, offline-friendly on the shared phone). Recommendation: server-side for v1.1 (auditable + single safe-eval implementation); revisit if latency on the shared phone bites.
- **Q4 — `elements[]` array trigger:** what pilot signal promotes the post-pilot array migration (multiple-of-a-kind requested? reorder requested?). Capture as a pilot-review checkpoint.

## Risks

- **Over-building the palette before lessons need it (primary).** Mitigated by M0-first + JB/AR picking the element order from real lesson plans (breadth-over-depth: a probe only counts if a teacher uses it).
- **Calculator security.** A teacher formula is evaluated input. Mitigated by the safe-grammar + server-validation construction (Security section); M3 is gated until the evaluator is chosen and adversarially tested.
- **Forking the table with 1.J / 1.1.24.** Mitigated by Q2 — the table element is the shared primitive both consume, decided before M1.
- **Workspace-pane composition creep.** The pane becoming a tabbed multi-element surface risks clutter on a shared phone. Mitigated by the 1.1.33 tab pattern + the ~700px single-column reflow guard (Axiom 11).

## Success criteria

- [x] The "add element N" recipe is documented and exercised four times (table, chart, calculator, **note**) (M0–M4) — **shipped 2026-06-22** (the registry made each a mechanical add: model + spec + renderer + editor + tests).
- [x] A teacher adds a data table; a student fills it; the tutor references an entered value (M1) — **shipped 2026-06-22**.
- [x] A chart plots a student-filled table (M2) — **shipped 2026-06-22** (auto-binds the table's first two numeric columns).
- [x] A formula calculator evaluates (client-side safe parser; *not* server-side — deviation noted); the safe grammar refuses `eval`-class input under an adversarial test set (M3) — **shipped 2026-06-22** (13 adversarial cases).
- [x] M4 ships the **note** element (Markdown reference card, reusing `ChatMarkdown`) — **reinterpreted from "document"** (which was redundant with shipped `materials` + 1.1.33); inline-material-surfacing stays in 1.1.33. **Shipped 2026-06-22.**
- [x] The shipped checklist behaviour is unchanged after the registry re-home (regression-guarded) — **M0**.
- [ ] Every element has a designed empty / loading / error state; no blank void at ~700px (Axiom 11).
- [ ] Net axiom score ≥ +4 maintained; SECURE-by-construction mitigations implemented as specified.

## Related documents

- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19, the parent builder; this generalises its element fields into a registry
- [activity-authoring-assistant.md](activity-authoring-assistant.md) — 1.1.39, the AI co-pilot that assembles elements from this palette
- [expanded-workbench-types.md](../v1.0.0-pilot/expanded-workbench-types.md) — 1.J, the workbench *type* layer this element layer sits on; source of "data tables are AIPLA's job"
- [offline-lab-workbench.md](offline-lab-workbench.md) — 1.1.24, extends the table element with teacher ground-truth checking
- [documents-workbench-surface.md](documents-workbench-surface.md) — 1.1.33, the document element reuses its render + the Documents-tab composition pattern
- [curriculum-library.md](curriculum-library.md) — 1.1.25, the `MaterialRef` the document element surfaces
- [student-engagement-signals.md](student-engagement-signals.md) — 1.1.17, the BQ shape element interactions feed
- ADR-015 (unified multi-surface UI / A2UI) + ADR-013 (artefact safety) — scoping-site `architecture.qmd`
