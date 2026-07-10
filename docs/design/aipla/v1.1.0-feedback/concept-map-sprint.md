# Sprint CONCEPT-1 — living concept map demo slice + chat-native checkpoints

**Design doc:** [living-concept-map.md](living-concept-map.md)
**Sprint ID:** `CONCEPT-1` · **Created:** 2026-07-10 · **Estimated:** 2 days (~1,700 LOC incl. tests)
**Gate call:** M asked for the demo on 2026-07-10 — that *is* the UX-coherence gate opening; the design
doc's status flips to **committed / in build** with this sprint.
**Scope decision (M, 2026-07-10):** the chat-native **checkpoint slice** (the "quiz element that helps the
AI assess") is **pulled forward** from design-M2 into this sprint. The *passive* `mark_concept` LLM-judge
check-off + reconciling pass + teacher coverage + eval calibration stay OUT (they're the calibration long
pole the design doc says not to ship as a casual probe).

## Goal

A deployable demo on dev where a teacher (or the authoring co-pilot) authors a prerequisite concept map
with per-node check questions; a student sees the map read-only in the workspace; the tutor runs a
checkpoint **in conversation**; a passed checkpoint lights the node up on the student's map with
`evidence.kind="checkpoint"` and a visible card in the chat.

## Milestones

### M0 — data model + registry + BOTH stores (backend, ~280 LOC)

The 422 lesson applied from the start: `concept_map` threads through **both** activity stores in one
milestone.

- `backend/db/models/activity_config.py`:
  - `CheckQuestion(id, prompt, options: list[QuizOption] = [], expected_answer: str = "", explanation: str = "")`
    — the 1.1.19 `QuizItem` shape with an `expected_answer` field for chat-native judging (options optional:
    the tutor asks in its own voice; a form-quiz element remains 1.1.19's own thing).
  - `ConceptNode(id, label, level: StxLevel|None, dra: str|None, check_questions: list[CheckQuestion] = [])`
  - `ConceptEdge(from_/alias "from", to, kind="prerequisite")`
  - `ConceptMapElement(nodes, edges)` with validators: edge refs must resolve; **cycle-guard** (reject
    non-DAG); bounded sizes (≤30 nodes, ≤60 edges, ≤5 check questions/node — 1.1.38 bounded-input rule).
  - `ELEMENT_REGISTRY["conceptMap"] = ElementSpec(kind="conceptMap", field="concept_map", max_items=1, render="workspace")`
- Thread `concept_map: list[ConceptMapElement]` (cap 1, consistent with solution/document) through:
  `ActivityConfig`, `Activity`, `ActivityUpsert`, `_activity_from_body`, `_activity_to_config`.
  The existing guard test `test_every_element_field_is_present_on_all_activity_models` enforces this.
- Frontend mirror: `frontend/src/lib/activityElements.ts` gains `conceptMap` (lock-step consistency tests).

**Accept:** model validators reject cycles/dangling edges/oversize; round-trip through both stores
(create → 200, no 422); guard + consistency tests green.

### M1 — teacher authoring + student read-only render (frontend, ~500 LOC)

- `frontend/src/components/teacher/ConceptMapEditor.tsx` — **list mode** (the on-ramp): add/remove/reorder
  nodes, per-node "depends on" multi-select (cycle-guarded client-side), per-node check-questions
  sub-editor (prompt + expected answer + optional explanation).
- `frontend/src/components/workspace/ConceptMapGraph.tsx` — **shared auto-layout SVG display** (topological
  layers, no drag-editing — deferred per plan; scrolls in its own container at ~700px). Used by both the
  editor (preview) and the student view.
- `frontend/src/components/workspace/ConceptMapView.tsx` — student read-only render (WorkbenchTabs mount),
  takes a `nodeStates` prop (wired in M3; `not_yet` default). Empty/loading states designed (Axiom 11).
- `useActivityBuilder`: `conceptMap` state + `setConceptMap` (full-overwrite payload discipline).
- Builder pages (`[id]` + `new`) mount the editor; **dark flag `NEXT_PUBLIC_CONCEPT_MAP`** — Dockerfile
  ARG/ENV + `cloudbuild.yaml` `_CONCEPT_MAP: '1'` + `.env.example` (same conventions as
  `NEXT_PUBLIC_AUTHORING_COPILOT`; on for dev per "we always want to see the things we built").

**Accept:** teacher authors map + questions, saves, reloads intact; student sees the map read-only;
vitest covers editor + view + graph layout; `quality:check` green.

### M2 — co-pilot `propose_concept_map` diff tool (fullstack, ~380 LOC)

Co-authoring, not one-shot (the 2026-07-10 refinement): the tool takes the activity's **current** map and
proposes a **diff**.

- `backend/adk/authoring_tools.py`: `propose_concept_map(ops, activity_id, tool_context)` — owner-scoped,
  propose-only (never persists). Diff ops: `add_nodes` (nodes may carry `check_questions`), `add_edges`,
  `remove_nodes`, `relabel`, `set_check_questions`. Validation: apply ops to the current map server-side
  and reject if the **result** violates M0's validators (cycle, caps, dangling). Self-correcting errors
  (return current node ids on unknown-ref, like `set_artefact`'s catalogue).
- Register in `TOOL_REGISTRY` + authoring SKILL.md `metadata.tools` (**seed needed** on deploy).
- Frontend: `parseProposal` gains the `propose_concept_map` branch; `ProposalCard` renders a diff summary
  (+N nodes, +M edges, ~relabels, per-node question counts); `applyConceptMapDiff` pure util (unit-tested)
  applies ops to builder state; `applyCopilotProposal` routes to it.

**Accept:** owner gets a valid diff proposal; non-owner denied; cycle-producing diff rejected with a
self-correcting message; Apply patches the builder map; existing COPILOT tests stay green.

### M3 — chat-native checkpoints (fullstack, ~450 LOC)

- `backend/db/concept_progress.py` — Firestore store keyed `(group_id, activity_id)` →
  `{node_id: {status: not_yet|partial|demonstrated, evidence: {kind: "checkpoint", summary, turn_ref}, updated_at, prompt_version}}`.
- Tutor tools (student sessions):
  - `run_checkpoint(node_id)` — loads the session activity's map, returns the node's check questions +
    judging guidance (expected answers) **to the model**, which asks them one at a time in its own voice.
  - `record_checkpoint(node_id, passed, evidence_summary)` — writes node state (`demonstrated` on pass,
    `partial` otherwise) with `evidence.kind="checkpoint"`; group_id comes from the session JWT (never a
    param).
- Context: extend `backend/adk/teacher_focus.py` injection — when the activity has a concept map, inject
  the node list + current statuses + "checkpoints available" guidance so the tutor knows when to offer one.
- API: `GET /api/activities/{activity_id}/concept-progress` — **group-token auth** (`fetchWithAuth`,
  the ADR-001 corner; student's own group only). Teacher/owner read included for the builder preview.
- SKILL.md: add both tools to `problem-set-hints` + `concept-dialogue` templates (**manual seed after
  deploy — the recurring gotcha**).
- Frontend: student chat renders a **checkpoint card** when a `record_checkpoint` tool event appears in
  the AG-UI stream ("✓ *vektorer* — demonstrated: decomposed the 30° launch"); `ConceptMapView` refetches
  node states at turn end (NO Firestore `onSnapshot` — group JWTs are denied by client-SDK rules).

**Accept:** e2e in tests — tutor tool returns questions; record writes state; GET returns it under a group
token; card renders from a stream fixture; map lights up on refetch; pytest + vitest green.

### M4 — demo seed + deploy + verify (ops, ~100 LOC)

- Extend `backend/onboarding/demo_seed.py` (or a sibling seed) with a demo activity carrying a small
  physics map (e.g. vektorer + trigonometri → projektilbevægelse) + 1–2 check questions per node.
- Deploy dev → `make seed ENV=dev` (skill-template change!) → `make seed-demo-codes ENV=dev` if needed →
  browser smoke: author → propose → student view → checkpoint → light-up.

**Accept:** the full demo loop clicks through on deployed dev; smoke findings logged.

## Sequencing

M0 → M1 → M2 → M3 → M4 (M2 and M3 are independent after M1 but share `authoring_tools`/chat surfaces with
a parallel process active on dev — run serially, rebase before each push).

## Risks

| Risk | Mitigation |
|---|---|
| **Axiom-10 leak:** expected answers ride tool results over the AG-UI stream — a determined student can read SSE frames | Accepted for the formative dev demo; logged as a known limitation in the design doc; follow-up: strip tool-result payloads from student-visible frames before pilot |
| Checkpoint feels like grading | Formative copy ("the AI's read — confirm it"); `partial` never renders as failure; orientation framing |
| Group JWT auth corners (the 4×-shipped bug) | GET endpoint tested under a group token; no `onSnapshot`; group_id from JWT not params |
| Missed seed after SKILL.md change | M4 explicitly runs `make seed ENV=dev`; CI seed-reminder as backstop |
| Two-store drift | Guard test extended in M0 before any UI exists |
| Graph unreadable at ~700px | List-first; SVG in `overflow-x auto`; node cap 30 |

## Quality gates

Per milestone: `cd backend && make lint && make test-fast` · `cd frontend && npm run quality:check`.
Commits straight to `dev` (rebase onto origin/dev first — parallel process active), conventional messages,
one commit per milestone.
