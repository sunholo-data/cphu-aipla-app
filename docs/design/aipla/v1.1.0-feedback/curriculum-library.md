# Curriculum library — referenceable A/B/C curriculum corpus for authoring + grounding

**Status:** Planned (P1, design-doc stage) — **un-gated by the ADK-RAG decision** (2026-06-09); no longer waits on pgvector infra
**Last Updated:** 2026-06-09 (retrieval backend → ADK RAG; pgvector deferred to Year-2 local variant)
**Priority:** **P1 — breadth multiplier** (9 June check-in). Teachers want a **referenceable library of common curriculum PDFs, organised by stx level (A / B / C)**, sourced from shared Danish curriculum material (uvm.dk) plus their own uploads, that they can cite when authoring activities — and that the tutor can ground answers in.
**Estimated:** ~3–4d (A/B/C taxonomy + ingestion + ADK RAG corpus + ACL + authoring picker). **No separate vector-DB build** — ADK RAG (Vertex AI RAG Engine) is managed, so this is no longer gated on standing up pgvector.
**Scope:** Fullstack — ADK RAG corpus + A/B/C taxonomy + ingestion via AILANG Parse + the ADK RAG retrieval tool (ACL-scoped) + class/level ACL + a "cite materials" picker in the activity builder + tutor grounding hook.
**Dependencies:** **ADK RAG (Vertex AI RAG Engine, managed) is the v1 retrieval backend — no pgvector spend now.** The retrieval layer is **swap-shaped**: pgvector on Multivac ([1.3 `rag-pgvector-setup.md`](../SEQUENCE.md)) becomes the **Year-2 local/on-prem variant** (per `self-hosting.qmd`), not a v1 prerequisite. ADR-004 (AILANG Parse — deterministic ingestion of the 13 formats); ADR-010 (RAG); [teacher-activity-authoring.md](teacher-activity-authoring.md) (1.1.19 — `materials` references resolve into this library); [student-multimodal-upload.md](student-multimodal-upload.md) (1.1.7 — teacher uploads reuse the same retention posture)
**Source brief:** [`june-09-feedback-sprint-brief.md` §A](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md)

> **Split out from teacher-activity-authoring (1.1.19) deliberately.** The 9 June brief folds the curriculum library *and* the equipment co-design into "design doc A (teacher-activity-authoring)." This doc takes the **library** half — a genuine standalone subsystem (storage, taxonomy, ingestion, ACL, retrieval) consumed by authoring *and* by runtime tutor grounding. The **co-design** half (AI proposes the missing workbench element around a teacher's equipment) stays a milestone in [teacher-activity-authoring.md](teacher-activity-authoring.md), because it is an authoring interaction, not a corpus. Two focused docs beat one sprawling one.

> **Breadth-over-depth steer (9 June meeting; `notes/2026-06-09-curriculum-content-uses.md`).** Year 1 is about **discovering which interfaces are worth pursuing** — *coverage of the possibility space beats polish on any single bet.* That reframes this corpus from "reference material" into a **breadth multiplier**: it drops the marginal cost of every new activity (grounding, rubric, and level-calibration come for free), so the team can run **many thin probes** instead of hand-building each. This is a standing project principle (`aipla-breadth-over-depth`). Two of the uses below — **#6 coverage/gap map** and **#4 auto-drafted rubrics** — *operationalise* the strategy (they say where to probe next and keep each probe measurable), so they are pulled forward as the earliest-build pieces.

## Problem

Two gaps from the 9 June session:

1. **No shared curriculum to cite.** When a teacher authors an activity ([1.1.19](teacher-activity-authoring.md)) they have nothing to point the tutor at except a free-text goal and ad-hoc uploads. Danish stx physics has a **common curriculum** (uvm.dk material, the Haka/matematikfysik problem sets) that every teacher works from. It should be a **library** — organised by the **A / B / C level structure** that is how Danish stx is actually stratified — that teachers reference rather than re-upload.
2. **No grounding source for the tutor.** Without a corpus, tutor answers are ungrounded (Axiom 2 risk). A cited curriculum library lets the tutor answer "per your level-B syllabus, …" with provenance.

The 3 June brief already flagged "teacher activity creation from scratch" as needing its own design; 9 June makes the **A/B/C curriculum corpus** the concrete, separable piece of it.

## Goals

**Primary goal:** A curriculum library — common A/B/C material plus per-teacher/per-class uploads — that a teacher can **browse and cite** when authoring an activity, and that the tutor can **retrieve from with provenance** at run time, with access scoped by level and class.

**Success metrics:**
- A teacher authoring an activity can attach one or more curriculum documents from the **A/B/C-organised** library (or upload their own) as `materials` in under a minute.
- The tutor, on an activity with cited materials, answers with **source attribution** ("from the level-B mechanics chapter you attached") — citation rate carries the Axiom-2 KPI.
- Access is scoped: a teacher sees the shared A/B/C corpus + their own/class uploads; a student's tutor retrieves only from the activity's cited materials.
- Ingestion is **deterministic** (AILANG Parse, zero LLM tokens) for the 13 supported formats.

**Non-goals:**
- The Strand-C **2010 national-exam archive** — that is copyright/IP + GDPR-gated and lives in Strand C scoping ([Part 3 of the brief](file:///Users/mark/Documents/clients/cph-uni/strand-a-pedagogical-bot/prototypes/june-09-feedback-sprint-brief.md)); **not** ingested here until cleared.
- The graph-DB / concept-extraction layer (Strand C, deferred per parent SEQUENCE 1.3 exclusion).
- AI-generated curriculum content — the library holds **human-authored, provenance-bearing** material only.
- The equipment co-design interaction (stays in [1.1.19](teacher-activity-authoring.md)).

## Uses — the corpus as a breadth multiplier

The 9 June note enumerates how the A/B/C *læreplan + vejledning* corpus and the *matematikfysik* experiment catalogue get used. The library is **one store feeding many surfaces** — which is exactly why it earns its own doc. Three were team-identified; eight more surfaced in the 9 June session. Each row names the **consumer** so the cross-cutting wiring is explicit:

| # | Use | What it does | Primary consumer doc |
|---|---|---|---|
| 1 | **Per-activity context** | Teacher pulls focused curriculum context into an activity so the AI stays on-scope | [1.1.19](teacher-activity-authoring.md) `materials` |
| 2 | **Currency grounding** | Tutor references the *current Danish* curriculum, not stale/non-Danish training data | this doc (retrieval) |
| 3 | **Inspiration + co-authoring** | Generate new activities *with* the teacher | [1.1.19](teacher-activity-authoring.md) authoring |
| **4** | **Auto-drafted rubrics / DRAs** ⭐ | Turn *faglige mål* + *kernestof* into the "concepts covered" checklist per topic+level. The ground-truth measuring stick for [notes-summary](end-of-class-notes-summary.md), exit-ticket, analytics. **Biggest breadth-multiplier — every activity inherits a rubric without hand-authoring.** Bridges to the exam-archive "standards" fork | [1.1.19](teacher-activity-authoring.md) (checklist/DRA gen) + [1.K dra-framework](../v1.0.0-pilot/dra-activity-framework.md) |
| 5 | **Level calibration (A/B/C)** | Scope + difficulty scale to the student's level via the level-specific læreplan (don't go A-deep with a C student) | [1.1.19](teacher-activity-authoring.md) (level on activity) + tutor prompt |
| **6** | **Coverage + gap map** ⭐ | Map existing activities against the *kernestof* → what's covered, where the holes are. **Whole job is to point at the next probe** — the single most strategy-aligned thing to build early; doubles as a research instrument | [1.1.19](teacher-activity-authoring.md) (teacher view) + research |
| 7 | **Exam-format alignment** | The *vejledninger* describe how stx actually examines (written + oral, criteria) — ground oral-exam-prep + written-exam tools in *that*, not a generic "exam" | future exam-prep skills (3-June excluded list) |
| 8 | **Equipment-aware experiment matching** | Given a teacher's kit, suggest which *matematikfysik* experiments are runnable + co-design the workbench | [1.1.19 M6 co-design](teacher-activity-authoring.md) + [offline-lab](offline-lab-workbench.md) |
| 9 | **Misconception seeding** | The *vejledninger* flag typical student difficulties → seed DRA critical aspects + the misconception-pair skill | [1.K dra-framework](../v1.0.0-pilot/dra-activity-framework.md) + [2.5 analytics-rubric](../post-pilot/session-analytics-rubric.md) |
| 10 | **Danish terminology / notation grounding** | Match the exact stx terms, symbols, units students see in class + on exams | tutor prompt; representations thread |
| 11 | **Eval content domain** | Curriculum + exams as the per-level scope for the capability-floor eval (can model X handle A- vs C-level Danish physics?) | [1.5 capability-floor eval](../SEQUENCE.md) |

**⭐ Pulled forward (operationalise breadth-over-depth):** **#6 coverage/gap map** (cheap — one pass over *kernestof* vs the activity list; points at the next probe) and **#4 auto-drafted rubrics** (keeps each thin probe assessable without hand-authoring, so breadth doesn't cost measurement). Per the 9 June note, **#4–#6 live in [teacher-activity-authoring.md](teacher-activity-authoring.md)** — this library is their *source* (the corpus + retrieval); the rubric-generation, level-calibration, and coverage-map *logic* sit in the authoring doc.

**Parsing dependency:** #4, #7, #9 depend on the **B/C curriculum being parsed/translated** (open action in the base note `notes/2026-06-09-AR-followup-curriculum-experiments.md`). The A-level material is ready first; B/C rubric/exam/misconception uses follow once parsed.

## Axiom Alignment

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Retrieval adds a step to grounded turns; mitigated by ADK RAG retrieval being fast and scoping to only the cited docs. Not on the no-tools fast path. |
| 2 | EARNED TRUST | +1 | **The headline win.** The tutor grounds answers in cited curriculum with **source attribution** — directly serves the >90% citation KPI; replaces ungrounded recall with provenance. |
| 3 | SKILLS, NOT FEATURES | +1 | "Cite a curriculum doc" is a builder affordance on the activity skill — no developer to wire a corpus per topic. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Ingestion is **deterministic AILANG Parse** (zero tokens, ADR-004); embeddings are a cheap model; the reasoning model only consumes retrieved chunks. Right tool per stage. |
| 5 | GRACEFUL DEGRADATION | +1 | Retrieval miss / RAG unavailable → tutor falls back to ungrounded answer **with a visible "no source found" note** rather than failing; un-parseable upload → AILANG Parse falls back to Gemini per ADR-004. |
| 6 | PROTOCOL OVER CUSTOM | +1 | Retrieval via the **standard ADK RAG tool** (optionally MCP-wrapped); ingestion via AILANG Parse; no bespoke retrieval protocol. **Backend is swap-shaped** (ADK RAG → pgvector/local) behind one interface. |
| 7 | API FIRST | +1 | Library CRUD + retrieval are API/MCP surfaces; CLI ingests and queries; the builder picker is one client. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Retrieval calls emit OTel spans (query, docs hit, scores) → BigQuery; "which curriculum chunks get cited most" is a research + content-gap signal. |
| 9 | SECURE BY CONSTRUCTION | 0 | New data store + retrieval. **Neutral by construction:** ACL by level/class enforced in the query (deny-by-default — a student's tutor can only retrieve the activity's cited docs); teacher uploads inherit the 1.1.7 retention posture; corpus stays inside the GCP/Multivac trust boundary (no egress). Copyright gate on what may be ingested. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Retrieval, ranking, ACL all backend; the builder picker renders a list, the tutor consumes chunks. |
| 11 | USABLE BY DESIGN | +1 | The A/B/C browse/cite picker has empty (no materials yet → "browse shared library or upload"), loading, and error states designed; level filter is the teacher's real mental model. |
| | **Net Score** | **+9** | Threshold: ≥ +4. |

**Conflict Justifications:**
- **#9 (0, not −1):** a new corpus + retrieval would normally pull negative. Held neutral: ACL is enforced **in the retrieval query** (deny-by-default by level/class), not by UI; the store is inside the Multivac/GCP boundary (no egress); ingestion is copyright-gated; student-side retrieval is restricted to the activity's explicitly-cited docs (no open-corpus access from a student session).

## Standards compliance

- **Retrieval backend (swap-shaped):** **ADK RAG (Vertex AI RAG Engine, managed corpus) for v1** — chunking, embeddings, and ANN are managed by the platform; zero vector-DB ops. The retrieval is exposed as the standard ADK RAG tool the tutor agent already speaks. **pgvector/Multivac ([1.3](../SEQUENCE.md)) is the Year-2 local/on-prem swap** (UCPH self-hosting, `self-hosting.qmd`) behind the same retrieval-tool interface — the taxonomy/ingestion/ACL layer is backend-agnostic, so the migration is a provider swap, not a rewrite.
- **Ingestion:** AILANG Parse (ADR-004) for the deterministic formats → ADK RAG corpus; the same parse pipeline 1.1.7/teacher-upload uses.
- **Retrieval interface:** the ADK RAG retrieval tool (Axiom 6 — standard tool interface), ACL-scoped per call. (If a thin MCP wrapper is wanted for cross-channel reuse, it wraps the same ADK RAG tool — no new protocol.)
- **Citation in materials:** `MaterialRef` from [1.1.19](teacher-activity-authoring.md) resolves to a library document id — no new reference shape.

## Design

### Taxonomy — A/B/C is first-class

```python
StxLevel = Literal["A", "B", "C"]   # Danish stx physics stratification

class CurriculumDoc(BaseModel):
    id: str
    title: str
    level: StxLevel                  # the teacher's primary organising axis
    topic: str | None = None         # "mechanics", "electromagnetism", …
    source: Literal["shared", "teacher_upload"]
    owner_scope: str                 # "shared" | class tag "class:<uid>:<id>" | teacher uid
    origin: str                      # provenance: "uvm.dk", "Haka Fysik", teacher name — for citation
    doc_artifact_id: str             # AILANG-Parse output (ingested into the ADK RAG corpus)
    copyright_status: Literal["cleared", "teacher_owned", "pending"]  # ingestion gate
```

- **Shared corpus** (`source="shared"`, `owner_scope="shared"`): the common A/B/C uvm.dk-sourced material, ingested once, visible to all teachers. Only `copyright_status="cleared"` docs enter it.
- **Teacher/class uploads** (`source="teacher_upload"`): scoped to the uploading teacher or a class tag, inherit 1.1.7 retention; `copyright_status="teacher_owned"`.
- **The A/B/C level is the primary browse axis** — it is how teachers think and how access naturally stratifies.

### Ingestion

```
PDF / docx / … ──► AILANG Parse (deterministic, ADR-004) ──► text + structure
                        │
                        └─ ADK RAG ingest (managed chunk + embed) into the corpus,
                           tagged {level, topic, owner_scope, doc_id}
```

`aiplatform curriculum ingest <file> --level B --topic mechanics --origin "Haka Fysik" [--shared]`. Shared ingestion requires `--copyright cleared` (a guard, not a checkbox — refuses `pending`).

### Retrieval + ACL

Retrieval via the **ADK RAG tool** (optionally MCP-wrapped as `curriculum-retrieve` for cross-channel reuse). **ACL is applied to the query** (corpus/filter scoping), deny-by-default:

- **Teacher authoring context:** may retrieve `shared` ∪ `their own/class` docs (browse + cite).
- **Student tutor context:** may retrieve **only the cited `materials` of the running activity** — never the open corpus. The activity's `MaterialRef` list is the allow-list; the MCP call is scoped to those `doc_id`s.

Every retrieval returns chunks **with `origin`** so the tutor cites provenance (Axiom 2).

### Authoring picker (in the 1.1.19 builder)

In the activity builder's **Materials** section:

```
  Materials   [ + cite from library ]  [ + upload ]
   Library  ▸ Level [ B ▾ ]  Topic [ mechanics ▾ ]
            ☐ Energi og arbejde (uvm.dk, B)
            ☑ Frihjuls-forsøg (Haka Fysik, B)
   Uploaded ☑ my-worksheet.pdf  (you, teacher_owned)
```

Cited docs become the activity's `materials` (`MaterialRef` → library `doc_id`). Empty state: "Browse the shared A/B/C library or upload your own." (Axiom 11.)

### Tutor grounding hook

When an activity has `materials`, the tutor agent gets the `curriculum-retrieve` MCP tool **scoped to those doc ids**. The skill prompt instructs: prefer cited material, **cite the `origin`**, and if nothing relevant is retrieved, say so rather than inventing (Axiom 2/5).

## API / MCP changes

| Surface | Change | Auth/ACL |
|---|---|---|
| ADK RAG retrieval tool (opt. `curriculum-retrieve` MCP wrap) | **New** — RAG query over the corpus, ACL-scoped per call | teacher scope or activity-cited allow-list |
| `POST /api/curriculum/ingest` | **New** — ingest a doc (AILANG Parse → ADK RAG corpus), copyright-gated for shared | teacher (admin for `--shared`) |
| `GET /api/curriculum?level=B&topic=…&scope=…` | **New** — browse the library (ACL-filtered) | teacher |
| `GET /api/activities/{id}` | `materials` already present (1.1.19) — resolve to library docs | student/teacher |

## CLI surface

| Command | Purpose |
|---|---|
| `aiplatform curriculum ingest <file> --level A\|B\|C [--topic] [--origin] [--shared --copyright cleared]` | ingest into the library |
| `aiplatform curriculum list [--level B] [--topic mechanics] [--scope shared\|mine]` | browse |
| `aiplatform curriculum query "<q>" --level B` | test retrieval + provenance from CLI (ops/eval parity) |

Backlink: [local-dev-cli](../../v6.1.0/local-dev-cli.md).

## Migration

- A managed ADK RAG corpus + `CurriculumDoc` metadata in Firestore. No vector-DB schema to own in v1; the Year-2 pgvector swap re-ingests the same parsed docs behind the same retrieval interface.
- Seed the shared corpus from **cleared** uvm.dk material only; everything else starts `teacher_upload`.
- Rollback: disable the `curriculum-retrieve` tool + hide the picker; activities with `materials` fall back to ungrounded (with the "no source" note).

## Testing strategy

- **Backend (pytest):** ingestion (AILANG Parse → ADK RAG corpus ingest); ACL — a student session **cannot** retrieve non-cited docs (deny-by-default assertion); shared ingestion refuses `copyright_status=pending`; retrieval returns `origin` for citation.
- **Frontend (vitest):** library picker filters by A/B/C + topic; cite adds a `MaterialRef`; empty/loading/error states.
- **Eval:** on an activity with cited materials, the tutor cites the `origin` (Axiom-2 citation rate); on no-retrieval, it says "no source" rather than inventing.
- **E2E (LOCAL_MODE):** ingest a fixture level-B PDF → author an activity citing it → student asks a syllabus question → tutor answers with the cited origin.

## Human gates (tee up to JB/M)

1. **JB/M — copyright clearance** for the shared corpus (uvm.dk licence terms; Haka/matematikfysik PDFs). **Hard gate** — only cleared material enters `source="shared"`. This is the same copyright thread as the Strand-C exam archive; keep them aligned.
2. **JB — A/B/C topic taxonomy** below level (which topics, Danish labels) — the controlled vocabulary teachers browse by.
3. **Prerequisite, not a human gate:** an ADK RAG corpus provisioned (small, managed — not the pgvector build). pgvector/local is a Year-2 swap, not a v1 prerequisite.

## Open questions

- **Q1 — shared-corpus curation:** who is the editor of `source="shared"` (admin/researcher role 1.1.5)? Recommend `role:researcher`/admin-only writes to shared; teachers write only their own scope.
- **Q2 — retrieval granularity for students:** whole-doc vs chunk-level allow-list when scoping to an activity's `materials`? Recommend doc-level allow-list, chunk-level ranking within.
- **Q3 — overlap with [student-multimodal-upload.md](student-multimodal-upload.md):** a teacher upload here vs a student image upload there share the AILANG Parse path but differ in retention (curriculum is **retained + indexed**; student images are **not**). Keep the two retention postures explicit and separate.
- **Q4 — embeddings model + EU residency:** confirm the ADK RAG / Vertex embedding model runs in-region (ADR-005/007).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Copyright on shared material** | High | `copyright_status` ingestion gate; only `cleared` enters shared; JB/M clearance is a hard gate; aligns with Strand-C archive thread |
| ACL leak — student retrieves uncited corpus | Medium | ACL **in the query**, deny-by-default; student scope = activity's cited allow-list only; pytest asserts |
| ADK RAG limits (corpus size, EU-region availability, per-query cost) | Medium | Managed service — validate corpus size + EU region early; swap-shaped to pgvector/local if limits bite (Year-2 path already designed) |
| Ungrounded fallback hides a retrieval bug | Low | Visible "no source found" note + retrieval span in BQ surfaces silent misses |

## Success criteria

- [ ] A/B/C-organised library browsable by a teacher; shared corpus + own/class uploads, ACL-correct.
- [ ] Ingestion via AILANG Parse → ADK RAG corpus; shared ingestion refuses non-cleared docs.
- [ ] ADK RAG retrieval (opt. `curriculum-retrieve` MCP wrap), ACL-scoped (teacher = shared∪own; student = activity-cited only).
- [ ] Builder Materials picker cites library docs into an activity's `materials`.
- [ ] Tutor on a cited activity answers **with `origin` provenance**; "no source" note on miss.
- [ ] Student session cannot retrieve non-cited corpus (pytest).
- [ ] `aiplatform curriculum ingest/list/query` work end-to-end.
- [ ] `npm run quality:check` + `make lint` + `make test-fast` green.

## Related documents

- ADK RAG (Vertex AI RAG Engine) — the **v1 managed retrieval backend** (no pgvector spend); [1.3 `rag-pgvector-setup.md`](../SEQUENCE.md) is the **Year-2 local/on-prem swap**, not a v1 prerequisite (`self-hosting.qmd`)
- [teacher-activity-authoring.md](teacher-activity-authoring.md) — 1.1.19; `materials` resolve here; **uses #4 rubrics / #5 level-cal / #6 coverage-map logic live there** (this library is their source); equipment co-design (M6) too
- [dra-activity-framework.md](../v1.0.0-pilot/dra-activity-framework.md) — 1.K; consumes the læreplan-derived rubrics (#4) + misconception seeds (#9)
- [session-analytics-rubric.md](../post-pilot/session-analytics-rubric.md) — 2.5; misconception/DRA vocabulary (#9) feeds the analytics rubric
- [offline-lab-workbench.md](offline-lab-workbench.md) — Haka/matematikfysik procedure PDFs become cited materials; equipment matching (#8)
- [end-of-class-notes-summary.md](end-of-class-notes-summary.md) + exit-ticket — measure notes against the rubric the corpus generates (#4)
- [student-multimodal-upload.md](student-multimodal-upload.md) — 1.1.7; shares the AILANG Parse path (different retention posture)
- [1.5 capability-floor eval](../SEQUENCE.md) — uses curriculum + exams as the per-level eval domain (#11)
- ADR-004 (AILANG Parse) + ADR-010 (RAG/pgvector) — scoping-site `architecture.qmd`
- Strand-C 2010 exam archive — the copyright-gated corpus explicitly **out of scope** here; exam-format alignment (#7) bridges to it
- `notes/2026-06-09-curriculum-content-uses.md` + `notes/2026-06-09-AR-followup-curriculum-experiments.md` — the source notes (scoping site, private)
