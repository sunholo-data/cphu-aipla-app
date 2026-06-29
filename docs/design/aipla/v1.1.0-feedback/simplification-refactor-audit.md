# Simplification & Refactor Audit — AIPLA app

**Date:** 2026-06-29 · **Status:** audit only, no code changes yet · **Owner:** M

> Goal: make the codebase as simple as it can be (good DRY, best practices,
> safe test coverage) before the next iteration cycle. This doc is the audit
> + the **pre-refactor safety-net plan**. Refactors are gated on the safety
> net landing first — see [Sequencing](#sequencing-do-this-in-order).

## Bottom line

The codebase is **functionally healthy** — no broken auth, clean Pydantic v2,
two auth helpers correctly separated, `any`/dead-code rare, test hygiene good
(no flaky-test-hiding skips, no snapshot lock-in). The debt is **concentrated,
not diffuse**, and it clusters in exactly one place: the **activity / teacher
authoring subsystem** plus the **chat page** — which are also the highest-churn
files in the repo. Three independent things drive almost all of it:

1. **A god-file problem.** Five files carry far more than their share:
   `app/chat/[...path]/page.tsx` (1269 lines), `lib/teacherApi.ts` (1000),
   `auth/group_id_auth.py` (887), `adk/agent.py` (763), `fast_api_app.py` (736).
2. **A missing-abstraction problem.** The backend has no shared "load resource +
   assert caller owns it" guard, so ownership/ACL logic is hand-rolled 9+ times;
   the frontend has no shared API-response helper, so fetch+error boilerplate is
   copy-pasted across 4 clients.
3. **A parallel-definitions problem.** Every workbench-element type is defined
   2–3× (backend Pydantic → `teacherApi.ts` → `workspace/*Def`); they must stay
   in lockstep by hand, and a divergence is a silent data-loss bug.

**Test-coverage verdict for refactor safety:** strong where it matters for
security (the anon-group JWT machinery, authoring-tool owner-scoping,
`useSkillAgent`), **dangerously thin on the two biggest refactor targets**
(`teacherApi.ts` and the chat page have effectively no behavioral net), and
**two builder modules have zero tests**. High test *volume* (209 backend / 167
frontend files) masks the gaps because pages are tested with their API clients
fully mocked. **We are NOT safe to refactor the client layer or chat page today**
— four characterization tests close the gap (see [Safety net](#phase-1--safety-net-write-these-tests-first)).

---

## Cross-cutting theme: it's all the same subsystem

The same surface shows up as the top finding in all three audits:

| Audit | Top finding | Surface |
|---|---|---|
| Frontend | Element types defined 2–3× in parallel; create/edit page duplication; `useActivityBuilder` 15-way `useState` | activity authoring |
| Backend | No shared ownership guard; `activity_routes` / `activity_config_routes` clone the ACL block | activity routes |
| Coverage | `useActivityBuilder` + `ActivityBuilderBody` have **zero** tests; `teacherApi.ts` untested | activity authoring |

Churn data agrees: 8 of the top-12 most-edited files are activity/teacher
authoring. **Fixing this subsystem is the single highest-leverage move** — it
de-risks the most-changed code and removes a whole class of "edit-the-shape-in-
two-places" data-loss bugs.

---

## Frontend findings

Ranked by impact/effort. Full detail in the per-finding notes below the table.

| # | Finding | Files | Impact | Effort | Risk |
|---|---|---|---|---|---|
| F1 | `ChatShell` god component (~920 lines, 14 effects, 11 callbacks, 16+ state slices) | `app/chat/[...path]/page.tsx` | H | L | Med |
| F2 | Workbench-element types defined 2–3× in parallel | `lib/teacherApi.ts`, `components/workspace/*`, `lib/activityPreview.ts` | H | M | Low |
| F3 | `readJson`/`_ok` response+error helper copy-pasted across 4 API clients | `lib/{teacherApi,insightsApi,curriculumApi,costApi}.ts` | M | S | Low |
| F4 | `relativeTime` reimplemented inline 4× despite a canonical, better `lib/relativeTime.ts` | `teacher/classes/page.tsx`, `classes/[id]/page.tsx`, `SkillSessionPanel.tsx`, `DocumentHistoryPanel.tsx` | M | S | Low |
| F5 | Save-payload assembly + load-state machine duplicated between create and edit activity pages | `teacher/activities/{new,[id]}/page.tsx`, `hooks/useActivityBuilder.ts` | M | M | Med |
| F6 | `useSkillAgent` 343-line hook / 188-line subscription effect; two near-duplicate error classifiers | `hooks/useSkillAgent.ts` | M | L | High |
| F7 | `RoutedToolCall` 273-line component, 3-stage effect pipeline + 88-line inline callback that re-mounts the renderer | `components/protocols/MCPAppToolCallRouter.tsx` | M | M | Med |
| F8 | `useActivityBuilder` holds 15 discrete `useState`s; element state should be one object/reducer | `hooks/useActivityBuilder.ts` | M | M | Med |
| F9 | Repeated UI clusters: alert box (7×), empty-state (13×), toast timer (5×), session-row, export-button | teacher pages, chat page | M | S | Low |
| F10 | Insights/spend fetch is 3 ad-hoc effects on the classes dashboard | `teacher/classes/page.tsx` | L | M | Med |
| F11 | Orphan dev pages reachable only by direct URL | `app/dev/*` | L | S | Low |
| F12 | Defensive `as unknown as X` cast clusters from weak MCP/AG-UI upstream types | `MCPAppToolCallRouter.tsx`, `useSkillAgent.ts` | L | L | Med |

**Notes on the load-bearing ones:**

- **F1 — `ChatShell`.** Cleanest seam is the activity-config fetch (~L405–500):
  11 parallel `active{Checklist,Table,Chart,Calculator,Note,Solution,Document,Artefact,Materials,Persona}`
  state slices all set from one fetch and reset together. Extract
  `useActivityWorkbenchConfig(activityId)` returning one object. Further seams:
  `useSessionBootstrap`, `useSessionRestore`, `useMobileTabPersistence`, a
  `<DocBrowserPanel>`.
- **F2 — element types.** `lib/teacherApi.ts` defines the wire shape; `workspace/*`
  redefines the render shape (`TableElementDef`, `ChartElementDef`, …);
  `lib/activityPreview.ts` re-aggregates. The component versions' comments
  literally say "Mirrors `TableElement`". Collapse to one `lib/elementTypes.ts`,
  re-export from old sites to stage the migration.
- **F5/F8 — pair these.** Push payload assembly + validation into
  `useActivityBuilder` (`toSavePayload()`, `isFormValid()`), collapse its 15
  `useState`s into one reducer, and both create/edit pages become thin shells.
  ⚠ The activity-config POST is a **full overwrite** — a partial payload silently
  wipes data, so the round-trip test (T4) is mandatory before touching this.

## Backend findings

| # | Finding | Files | Impact | Effort | Risk |
|---|---|---|---|---|---|
| B1 | No shared "load resource + assert caller owns/can-read" guard; 9+ inline `owner_uid != user.uid` + researcher-bypass clones | `classes_routes`, `activity_routes`, `voice_routes`, `recording_routes`, `activity_config_routes`, `analytics/auth` | H | M | Med |
| B2 | `_assert_teacher` verbatim-cloned across route files | `classes_routes:114`, `analytics_routes:60`, `insights_routes:57`, `activity_routes:94`, `teacher_bootstrap_routes:30` | H | S | Low |
| B3 | `_serialize` (`model_dump(by_alias)`) + `_to/_from_firestore` mapper clones | `db/{classes,activities,activity_configs,chat_sessions}.py`; 6 route files | H | M | Low |
| B4 | Stale template literals in load-bearing app code (`aitana-multivac`) | `fast_api_app.py:74`, `app.py:32` | M | S | Low |
| B5 | `fast_api_app.py` god-module: startup guards + banners + wire body + stream handler + channel registration inline (736 lines) | `fast_api_app.py` | M | M | Med |
| B6 | `_class_for_user` duplicated verbatim across two route files | `voice_routes:100`, `recording_routes:55` | M | S | Low |
| B7 | Business logic in route handlers (proactive 7-gate tree, voice TTS pipeline) instead of a service layer | `proactive_routes:322-421`, `voice_routes:423-605` | M | M | Med |
| B8 | `adk/agent.py` `create_agent` god-function: ~10 tool-wiring concerns inline | `adk/agent.py:342-459` | M | M | Med |
| B9 | `query_documents` leaks `__id` sentinel; every caller strips it manually | `db/firestore.py:121` + 4 callers | M | S | Low |
| B10 | Collection-name magic strings not centralized (`"anon_groups"`, `"mcp_servers"`, …) | `auth/group_routes`, `db/classes`, `recording_routes`, `tools/documents/*` | L | S | Low |
| B11 | Per-file env-var reads bypass `config/gcp.py` | `adk/session.py`, `db/rag_corpus.py` | L | M | Low |
| B12 | Sync Firestore I/O inside `async def` handlers (no thread offload) | 26 call sites across routes | L | L | Med |

**Notes on the load-bearing ones:**

- **B1 — the central missing abstraction.** Every write route re-codes "load,
  404 if missing or non-owner, with a researcher bypass + OTel span."
  `classes_routes._load_owned`, `activity_routes._load_for_modify`, and the
  `voice_routes` trio are near-identical. Build `auth/ownership.py` with
  `load_owned(loader, id, user, kind)` / `load_readable(...)`, folding the
  researcher bypass + span in one place. This is also the **dual-path
  (teacher vs anonymous-group) ACL surface the repo has broken 4+ times** —
  centralizing it removes the recurring failure point.
- **B2 — `_assert_teacher`.** One `require_teacher` FastAPI dependency. Deletes
  5 clones, closes a dual-auth bug class. Easiest high-value win in the backend.
- **B4 — stale literals.** `fast_api_app.py:74` guards against prefix
  `"aitana-multivac"`, so a correctly-configured AIPLA boot (`aipla-*-2026`) logs
  a spurious STARTUP WARNING and a genuinely misconfigured one passes silently.
  `app.py:32` falls back to `"aitana-multivac-dev"`. Fix to `aipla-`.
  (Leave `aitana_platform` as the ADK app-name session key — renaming it breaks
  existing sessions.)

**Confirmed NOT problems** (don't pad the work list with these): no broken auth,
no Pydantic v1/v2 mixing (clean v2), no dead channels, ruff F401-clean.

---

## Test coverage & refactor-safety

### How to run coverage

| | Command | Tooling status |
|---|---|---|
| Backend (all) | `cd backend && uv run pytest tests/ --cov=. --cov-report=term-missing --cov-report=html` | `pytest-cov` is a dep but **no `make cov` target** — add one. |
| Backend (targeted) | `cd backend && uv run pytest tests/ -m "not slow and not integration" --cov=auth --cov=adk --cov=protocols --cov=db` | scope `--cov` to modules under refactor |
| Frontend (all) | `cd frontend && npm run test:coverage` (= `vitest run --coverage`) | configured in `vitest.config.ts` (v8). Confirm `@vitest/coverage-v8` installed. |

**Action:** add a `make cov` target before refactoring (per the repo's
"any multi-step workflow needs a make target" rule).

### Coverage-vs-risk map (refactor targets only)

| Area | Tests? | Behavioral or shallow? | Safe to refactor now? |
|---|---|---|---|
| `auth/group_id_auth.py` | Yes (614-line suite, ~32 cases) | **Behavioral, exemplary** | **Yes** |
| `auth/group_routes.py` | Yes (519 lines) | Behavioral (HTTP-layer gates) | **Yes** |
| `adk/agent.py` | Yes (475 lines + chain tests) | Behavioral (instruction composition, toolset) | **Mostly** (model-routing branches lighter) |
| `adk/authoring_tools.py` | Yes (362 lines, ~35 cases) | **Behavioral, excellent** (owner-scoping) | **Yes** |
| `protocols/activity_config_routes.py` | Yes (445 lines) | Behavioral + one real dual-auth test | **Yes** |
| `db/models/activity_config.py` | Yes | Behavioral (legacy load, camelCase round-trip) | **Yes** |
| `insights/aggregates.py` | Yes (396 lines) | Behavioral (composition + cross-tenant deny) | **Yes** |
| `protocols/classes_routes.py` | Yes (525 lines) | Behavioral on teacher paths; student-reject via **fake mock**, not real JWT | **Mostly** (dual-auth reject not pinned) |
| `protocols/activity_routes.py` | Yes (458 lines) | Same gap | **Mostly** |
| `fast_api_app.py` | Partial (scattered) | Behavioral but no single app-assembly test | **Caution** |
| `hooks/useSkillAgent.ts` | Yes (**1094 lines, 40+ cases**) | **Gold standard** | **Yes** |
| `providers/SurfaceRegistry.tsx` | Yes (~300 lines) | Behavioral | **Yes** |
| `app/teacher/classes` + `activities` pages | Yes | Behavioral at page level, **teacherApi fully mocked** | **UI-safe, contract-unsafe** |
| `app/chat/[...path]/page.tsx` (1269 lines) | **Barely** — only the error banner slice | ~90% (SSE, auth-token selection, surface mount, doc-inject) **untested** | **No** |
| `lib/teacherApi.ts` (1000 lines) | **No direct test** (mocked in 16 files) | None of its own logic tested | **No** |
| `lib/insightsApi.ts` (332 lines) | **No direct test** (mocked in 5 files) | None tested | **No** |
| `hooks/useActivityBuilder.ts` | **ZERO references** | Absent | **No** |
| `components/teacher/ActivityBuilderBody.tsx` | **ZERO references** | Absent | **No** |

### Test-quality smells (real, but bounded)

- **Volume-without-safety on the client layer (the headline).** `teacherApi.ts`
  is imported in 16 test files and `insightsApi.ts` in 5 — always `vi.mock`'d.
  Flipping a method's verb (POST→PATCH) or return shape leaves every page test
  green. The page tests assert internal logic against a stub, not the client
  contract.
- **God-file "covered" by a sliver.** The chat page's `workspaceContent.test.ts`
  (16 lines) tests one boolean helper; `chat-error-display.test.tsx` covers only
  the error path. File-count tallies make the page look tested; it isn't.
- **12 backend assertion-free tests** (`*_never_raises`, `*_swallows_failures`) —
  legitimate (the behavior IS "does not raise") but weak nets; add a cheap
  `returns None`-style assertion where possible.
- **Clean hygiene otherwise:** 6 backend skips, all legitimately credential/live-
  gated; no `.todo`/`xit`; no snapshot lock-in (tests assert DOM text/roles and
  call-args, so they survive markup-only refactors). The problem is **breadth**
  (client layer + chat page), not lock-in.

---

## Sequencing (do this in order)

### Phase 1 — Safety net (write these tests FIRST)

Ranked by (risk × churn × current-gap). These convert "high test volume" into
"actually safe to cut." Nothing in Phase 2/3 starts until the matching test
lands.

- **T1 — `lib/__tests__/teacherApi.test.ts` (characterization/golden-master).**
  Highest value. For each method, pin: exact URL built, HTTP verb (the
  POST-vs-PATCH and `act-*`-vs-legacy branch is real business logic), request
  body shape, error mapping. Mock only `fetchWithTeacherAuth` (transport);
  assert on its call args. **Gates F2, F3, F5.**
- **T2 — chat page behavioral test for the uncovered 90%.** Before decomposing
  `ChatShell`: pin (a) **which auth token the stream uses** — group token for
  students vs teacher token (the repeatedly-shipped dual-auth bug bites here),
  (b) surface mounting on a tool-call event, (c) doc-injection / `threadId`
  resume. Use the `aitana-frontend-verify` Chrome-MCP harness if jsdom can't
  carry the SSE stream. **Gates F1.**
- **T3 — real-group-JWT rejection integration test.** `test_classes_route.py`
  and `test_activity_routes.py` reject students via a fake `is_teacher=False`
  object, not a real anon-group token. Mint a real group JWT via `join_group()`,
  hit `POST /api/classes` + `POST /api/activities` (expect reject) and
  `/api/activity-configs/active` (expect accept). **Gates B1, B2.**
- **T4 — `useActivityBuilder` + `ActivityBuilderBody` unit tests (currently
  zero).** Pin element add/remove/reorder and that `elementPayload()` emits the
  COMPLETE element+sim set (the full-overwrite footgun). **Gates F5, F8.**
- **T5 (lower) — `lib/insightsApi.ts` direct test; `fast_api_app.py` app-assembly
  test** (assert the route table + per-route auth dependency so a refactor can't
  silently drop a route or its guard). **Gates B5.**

### Phase 2 — Quick wins (safe now; low-effort, low-risk, high-clarity)

These have an adequate net already or are pure mechanical helpers:

- **F4** — delete 4 inline `relativeTime` copies → import `lib/relativeTime.ts`.
- **F3** — single `lib/apiResponse.ts` `readJson<T>` (keep per-client error
  subclasses via an opts mapper). *(after T1)*
- **F9** — extract `<AlertBox>`, `<EmptyState>`, `useToast()`, `<SessionRow>`,
  `<ExportButton>`.
- **B2** — `require_teacher` dependency, delete 5 clones. *(after T3)*
- **B4** — fix `aitana-multivac` → `aipla-` prefix guard + fallback.
- **B6** — fold `_class_for_user` into `db/classes.py`.
- **B9** — stop leaking `__id` from `query_documents` (return `(id, data)`).
- **B10** — consolidate duplicate collection-name constants.
- **F11** — confirm-and-prune `app/dev/*` orphan pages.

### Phase 3 — Big rocks (structural; gated on Phase 1 tests)

- **F2** — unify element types into one `lib/elementTypes.ts`. *(after T1)*
- **F5 + F8** — payload assembly/validation into `useActivityBuilder`, collapse
  15 `useState`s; create/edit pages become thin shells. *(after T1, T4)*
- **F1** — decompose `ChatShell`, starting with `useActivityWorkbenchConfig`.
  *(after T2)*
- **F6** — split `useSkillAgent` subscription into per-event handlers + merge the
  two error classifiers; extend branch tests first (high risk — streaming core).
- **B1** — `auth/ownership.py` load-and-assert guard; migrate all 9+ sites.
  *(after T3)* — highest-leverage backend change.
- **B5** — decompose `fast_api_app.py`; lift `stream_skill` +
  `_StreamSkillRequest` into `protocols/stream_routes.py`. *(after T5)*
- **B7/B8** — service layer for proactive gates + voice pipeline; refactor
  `create_agent` tool assembly behind a green `make eval` gate.

---

## What I'm NOT proposing

- Merging `fetchWithAuth` / `fetchWithTeacherAuth` — intentionally separate
  (group vs Firebase token); merging them re-introduces the dual-auth bug.
- Renaming the `aitana_platform` ADK app-name session key — load-bearing for
  existing sessions.
- Chasing the sync-in-async Firestore I/O (B12) now — real but a latency concern
  only under concurrency we don't yet have; do opportunistically.
