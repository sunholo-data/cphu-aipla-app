# Sprint Plan: SIMPLIFY-REFACTOR — Simplification & DRY refactor

## Summary

Execute the simplification/DRY refactor from the audit: dedupe the API-client +
route layers, unify the parallel element-type definitions, and decompose the
five god-files — **behind the 145-test characterization net already in place**.
Net stays green throughout; every big rock is gated on a named prerequisite.

**Duration:** ~16 working days (~3.2 weeks) solo · **Scope:** Fullstack (independent FE + BE tracks)
**Dependencies:** Phase 1 safety net — **DONE** (`8b85e1e`)
**Risk Level:** Low for Phase 2, Medium (item-gated) for Phase 3
**Design Doc:** [simplification-refactor-audit.md](simplification-refactor-audit.md)

> **This is a refactor, not a feature sprint.** Success = behavior unchanged,
> code simpler. LOC delta is net-negative (we delete duplication). The pace is
> set by *verification*, not output — so every milestone ends on a green net +
> lint + typecheck, and the four risky god-files each carry an explicit
> prerequisite before the cut.

## Current Status Analysis

### Recent Velocity
- 21-day window: 413 commits, +68k / −9k LOC — very high solo throughput.
- Recent work is exactly this subsystem (activities/teacher), so familiarity is high.
- **Refactor caveat:** raw velocity overstates capacity here — careful behavior-
  preserving edits + verification run slower than greenfield feature work. Plan
  is paced conservatively against that, not the headline rate.

### Existing safety net (what we build on)
- **Netted, safe to cut:** `teacherApi.ts` (T1), `useActivityBuilder`/`ActivityBuilderBody` (T4),
  chat page mount + auth-token selection (T2, jsdom-reachable), dual-auth reject
  + route table (T3, T5b). Plus pre-existing gold-standard suites: `group_id_auth`,
  `authoring_tools`, `useSkillAgent` (1094 lines), `agent.py`, `activity_config`.
- **Not yet netted (prereqs below):** chat-page runtime (SSE/refresh/doc-inject/layout),
  `useSkillAgent` per-event branches, activities/voice ownership, `_extract_document_ids`,
  `create_agent` composition (eval-gated).

## Proposed Milestones

Two independent tracks (FE / BE) — can interleave. Phase 2 first (low risk),
then Phase 3 big rocks in dependency order.

---

### M1 — Phase 2 FE quick wins
**Scope:** frontend · **Risk:** Low · **Duration:** ~1.5 days · **Net:** T1 covers F3
**Goal:** Kill the cheapest, highest-clarity FE duplication.

**Tasks:**
- [ ] F4: delete 4 inline `relativeTime` copies → import `lib/relativeTime.ts` (`teacher/classes/page.tsx`, `classes/[id]/page.tsx`, `SkillSessionPanel.tsx`, `DocumentHistoryPanel.tsx`)
- [ ] F3: new `lib/apiResponse.ts` `readJson<T>(resp, msg, opts?)` with an error-mapper opt; migrate `teacherApi`/`insightsApi`/`curriculumApi`/`costApi` to it (keep each client's error subclasses)
- [ ] F3: add `lib/__tests__/apiResponse.test.ts` (ok / 404 / 409 / 500)
- [ ] F9: extract `<AlertBox>`, `<EmptyState>`, `useToast()`, `<SessionRow>`, `<ExportButton>`; migrate the 7/13/5 call sites

**Acceptance:** full safety net green · `npm run quality:check:fast` clean · zero behavior change (visual diff on the migrated surfaces)
**Risks:** F9 touches many call sites — Mitigation: one component per commit, re-run net after each.

### M2 — Phase 2 BE quick wins
**Scope:** backend · **Risk:** Low–Med · **Duration:** ~1 day · **Net:** T3 covers B2
**Goal:** Remove route-layer clones; fix the stale startup guard.

**Tasks:**
- [ ] B4: `fast_api_app.py:74` + `app.py:32` `aitana-multivac` → `aipla-` (startup guard currently misfires)
- [ ] B2: one `require_teacher` FastAPI dependency; replace the 5 `_assert_teacher` clones
- [ ] B6: fold the duplicated `_class_for_user` into `db/classes.py` (`voice_routes`, `recording_routes`)
- [ ] B9: stop leaking `__id` from `query_documents` — return `(id, data)`; update 4 callers
- [ ] B10: consolidate `"anon_groups"` / `"mcp_servers"` literals onto module constants

**Acceptance:** `cd backend && make lint && make test-fast` green (incl. T3) · no route dropped
**Risks:** B2 is auth — Mitigation: T3 (real-group-JWT reject) must stay green; B9 touches query plumbing — keep firestore/query tests green.

### M3 — F2 element-type unification *(Phase 3)*
**Scope:** frontend · **Risk:** Low–Med · **Duration:** ~1 day · **Net:** T1 + T4 · **Depends:** —
**Goal:** Collapse the 2–3× parallel element types to one source.

**Tasks:**
- [ ] New `lib/elementTypes.ts` as the single definition (Checklist/Table/Chart/Calc/Note/Solution/Document)
- [ ] Re-export from `teacherApi.ts` + `workspace/*` + `activityPreview.ts` to stage migration; delete the `*Def` redefinitions
- [ ] Confirm `tsc` resolves all consumers to the shared type

**Acceptance:** net green · `tsc` clean · no `*Def` redefinition remains
**Risks:** FE/BE shape drift — Mitigation: T1/T4 pin the round-trip; this milestone removes the *FE* duplication only (BE Pydantic stays the wire source).

### M4 — F5 + F8 builder consolidation *(Phase 3)*
**Scope:** frontend · **Risk:** Med · **Duration:** ~2 days · **Net:** T4 (pins full-overwrite) · **Depends:** M3
**Goal:** Thin the create/edit pages; one state model in the builder.

**Tasks:**
- [ ] F5: move save-payload assembly + validation into `useActivityBuilder` (`toSavePayload()`, `isFormValid()`); both pages call it
- [ ] F8: collapse the 15 `useState`s into one `useReducer`; remove the exhaustive-deps disable
- [ ] Make `activities/new` and `activities/[id]` thin shells over the hook

**Acceptance:** T4 green (esp. `elementPayload()` emits the COMPLETE set — the data-loss guard) · both pages save identically to before
**Risks:** ⚠ activity-config POST is a **full overwrite** — a dropped field wipes data. Mitigation: T4 is the gate; do NOT merge if its complete-payload assertion isn't green.

### M5 — F1 ChatShell decomposition *(Phase 3)*
**Scope:** frontend · **Risk:** Med–High · **Duration:** ~2.5 days · **Net:** T2 (mount + auth-token) · **Depends:** —
**Prerequisite (gate):** **Chrome-MCP verification pass** (`aitana-frontend-verify`) capturing the behaviors jsdom can't — live SSE round-trip (group token → 200), token-refresh mid-stream, doc-injection inlining, mobile-tab/resize layout, MCP-app-iframe → synthetic turn. Record a before-baseline; re-run after.

**Tasks:**
- [ ] **Gate:** run the Chrome-MCP baseline on student + teacher chat (the residual list in the audit)
- [ ] Add a `<Suspense>` boundary (page uses React 19 `use(params)` with none today)
- [ ] Extract `useActivityWorkbenchConfig(activityId)` — collapses the 11 `active*` slices + 1 effect
- [ ] Extract `useSessionBootstrap`, `useSessionRestore`, `useMobileTabPersistence`, `<DocBrowserPanel>`
- [ ] Re-run the Chrome-MCP pass; diff against baseline

**Acceptance:** T2 green · Chrome-MCP after == before on all residual behaviors · `ChatShell` < ~400 lines
**Risks:** runtime behavior the unit net can't see. Mitigation: the Chrome-MCP gate is mandatory before AND after; extract one seam per commit.

### M6 — F6 useSkillAgent split *(Phase 3)*
**Scope:** frontend · **Risk:** High · **Duration:** ~2 days · **Net:** 1094-line suite · **Depends:** —
**Prerequisite (gate):** **extend per-event branch tests** so each of the 11 AG-UI event types (RUN lifecycle, TEXT_MESSAGE, TOOL_CALL_*, REASONING_*, CUSTOM_EVENT/latency) is individually asserted before the subscription is touched.

**Tasks:**
- [ ] **Gate:** add the missing per-event-branch assertions to `useSkillAgent.test.tsx`
- [ ] Split the 188-line subscription effect into named per-event handlers
- [ ] Merge `classifyError` + `classifyRunError` → `classifyStreamError(err, {isRunError})`
- [ ] Collapse the repeated `setIsLoading(false)+setRunStarted(false)` resets

**Acceptance:** every event-branch test green before and after · no streaming regression
**Risks:** streaming core, stale-closure prone. Mitigation: branch tests first (the gate); small commits; consider a Chrome-MCP smoke on a real stream.

### M7 — B1 ownership guard *(Phase 3)*
**Scope:** backend · **Risk:** Med · **Duration:** ~2 days · **Net:** T3 · **Depends:** M2 (B2)
**Prerequisite (gate):** **backfill ownership tests for activities + voice** (classes already covered) — 404-for-non-owner, 404-for-missing, owner-200, researcher-bypass-200-with-span — so all migrated sites are pinned.

**Tasks:**
- [ ] **Gate:** add the activities + voice ownership api_tests
- [ ] New `auth/ownership.py`: `load_owned(loader, id, user, kind)` / `load_readable(...)` folding researcher-bypass + OTel span once
- [ ] Migrate the 9+ inline sites (`classes_routes`, `activity_routes`, `voice_routes`, `recording_routes`, `activity_config_routes`)

**Acceptance:** all ownership tests green on every migrated route · enumeration-resistance preserved (404 not 403 for non-owner)
**Risks:** dual-path teacher/student ACL. Mitigation: T3 + the new backfill are the net; migrate one route file per commit.

### M8 — B5 fast_api_app split *(Phase 3)*
**Scope:** backend · **Risk:** Med · **Duration:** ~1.5 days · **Net:** T5b (route tripwire) · **Depends:** —
**Prerequisite (gate):** **`_extract_document_ids` unit test** — pin the priority logic (`fast_api_app.py:469-506`) before moving it.

**Tasks:**
- [ ] **Gate:** add the `_extract_document_ids` priority test
- [ ] Split into `app_factory.py` (app + routers), `startup_checks.py` (env guards), `channels/bootstrap.py`
- [ ] Move `_StreamSkillRequest` + `_extract_*` + `stream_skill` → `protocols/stream_routes.py`

**Acceptance:** T5b route-table green (no route/auth-dep dropped) · `_extract_document_ids` test green · app boots
**Risks:** silent route drop. Mitigation: T5b is the tripwire; assert the route table after each move.

### M9 — B7 / B8 service layer + create_agent *(Phase 3)*
**Scope:** backend · **Risk:** Med–High · **Duration:** ~2 days · **Net:** unit + **eval** · **Depends:** —
**Prerequisite (gate):** **`make eval` green baseline** before touching `create_agent`; re-run green after.

**Tasks:**
- [ ] **Gate:** capture `make eval` baseline
- [ ] B7: extract `proactive/gates.py` (decision object) + `voice/service.py` (resolve→cache→synthesize→cost); routes become thin
- [ ] B8: refactor `create_agent` tool assembly behind `_assemble_tools(md, user, activity_id)`
- [ ] Re-run `make eval`; compare to baseline

**Acceptance:** unit tests green · **`make eval` == baseline** (no agent-quality regression) · routes call services
**Risks:** agent construction is the hot path. Mitigation: eval gate before+after; gate-fail = revert.

## Week-by-Week Breakdown

| Week | Milestones | Outcome |
|---|---|---|
| **Week 1** | M1, M2, M3 | All quick wins shipped + FE element types unified. Low-risk foundation done. |
| **Week 2** | M4, M7, (start M5 gate) | Builder consolidated; backend ownership guard in. Run the M5 Chrome-MCP baseline. |
| **Week 3** | M5, M8 | ChatShell decomposed (verified); fast_api_app split. |
| **Week 4 (partial)** | M6, M9 | The two highest-risk cuts last, each behind its gate: useSkillAgent split + service layer/create_agent (eval-gated). |

## Quality Gates

After each milestone:
```bash
# Frontend milestones
cd frontend && npm run quality:check          # CI parity: tests + build (NOT the :fast variant)
# Backend milestones
cd backend && make lint && make test-fast
```
After Phase 3 FE god-files (M5, M6): a Chrome-MCP pass via `aitana-frontend-verify`.
After M9: `cd backend && make eval` must match baseline.

## Success Metrics
- [ ] Full safety net + all new gate tests green at every milestone boundary
- [ ] Net LOC delta negative (duplication removed); no god-file > ~400 lines
- [ ] Zero behavior change — Chrome-MCP before==after on chat; `make eval` == baseline
- [ ] `npm run quality:check` + `make lint && make test-fast` clean

## Dependencies
- Phase 1 safety net — DONE (`8b85e1e`)
- M4 depends on M3 · M7 depends on M2 (B2) · M5/M6/M8/M9 each depend on their own gate test/pass

## Open Questions
- **Calendar.** Today is 2026-06-29 — week 27 is the M+JB holiday freeze (06-29→07-05),
  pilot starts 2026-08-14 (~6.5 weeks out). A ~3.2-week refactor fits with buffer.
  Recommend: zero-risk quick wins (M1/M2) are freeze-safe; schedule the big rocks
  for mid-July so early August is left to stabilize before pilot. **M to confirm
  the calendar.**
- Prune `app/dev/*` orphan pages (F11) — confirm they're truly dead before deleting.

## Notes
- Deferred audit items (`listAccessibleSkills` error type, `classId`-on-edit) are
  folded into M1/M4 naturally; not separate work.
- Sprint-state JSON (`.claude/state/sprints/sprint_SIMPLIFY-REFACTOR.json`) tracks
  execution, but per project experience it drifts — verify "done" against git +
  code, not the flags.
