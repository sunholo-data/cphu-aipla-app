# Sprint Plan: ACTFACET — Faceted Activity Library (1.1.61)

## Summary

Give activities the same organising axes documents already have — `tags`,
`subject`, `level` — where most of an activity's facets are **inherited at read
time from the materials it cites**, plus the search / facet-chip / pagination
surface Materials already ships.

**Duration:** ~2.5 days (M1 ~1d · M2 ~1d · M3 ~0.5d)
**Scope:** Fullstack
**Dependencies:** none blocking — 1.1.58/1.1.60 shipped the vocabulary, the facet-count semantics and `FacetRow`
**Risk Level:** Low–Medium (one response-shape break; one known data-loss footgun to guard)
**Design Doc:** [activity-faceted-library.md](activity-faceted-library.md)

## Current Status Analysis

### Baseline (verified 2026-08-05, before any change)
- Backend: **2667 passed, 1 skipped, 0 failed** (`make test-fast`, 20s).
  The `test_tenant_context` failures noted in older sprint notes no longer
  occur; the OTLP `ConnectionError` in stderr is exporter noise, not a failure.
- Frontend: **183 files / 1500 tests passed**, `next build` green (41 static pages).
- Envs: dev/test/prod all on v0.1.10, smoke green.

### Recent velocity
92 commits / ~15k insertions in 14 days — but heavily ops-weighted (env cuts,
promote pipeline, guides). Feature-work velocity is the better guide here, and
1.1.58 (the direct analogue: 6 milestones, model + filter + facets + chips +
CLI) landed in ~3.5 days. This sprint is that shape at roughly two-thirds scale,
because the vocabulary, the facet semantics and the chip component already exist.

### What we build on
- `db/curriculum._apply_filters` — pure, no I/O, called repeatedly with one facet
  omitted. Exactly the shape `_apply_activity_filters` needs.
- `db/curriculum.facets_for_teacher` — the `others(**omit)` + `tally()` pair that
  produces narrowed counts. Directly portable.
- `_load_shared` — process-global TTL cache (120s) over the shared corpus; the
  inheritance pass needs no new Firestore reads beyond what Materials already does.
- `MaterialsSection.FacetRow` / `ActiveChip` — the chip idiom, currently private
  to a 1099-line component.

## Proposed Milestones

### Milestone 1 — Backend: model, inheritance, filters, facets
**Scope:** backend · **Estimated:** ~400 impl + ~250 tests = ~650 LOC · **Duration:** ~1d

**Tasks:**
- [ ] Extract `backend/db/models/taxonomy.py` — `StxLevel`, `SUBJECTS`, `PHYSICS_AREAS`, `MAX_TAGS`, `MAX_TAG_LEN`, `MAX_SUBJECT_LEN`, `normalize_tags`, `normalize_subject`. Re-export from `curriculum.py` so no existing import breaks (~100 new / ~10 shim)
- [ ] `Activity` gains `tags` / `subject` / `level`, normalised on every write path (~20)
- [ ] `resolve_inherited_facets(activities, docs_by_id)` — union of cited docs' tags/subject/level, keyed off the CALLER's visible set (~45)
- [ ] `_apply_activity_filters` — level (+`__unlevelled__`), subject, tags-AND, free-text over title+teachingGoal+tags, matching own ∪ inherited (~60)
- [ ] `facets_for_activities` — `{subjects, levels, tags}` with narrowed counts (~75)
- [ ] `GET /api/activities`: `q`, `tags[]`, `subject`, `level`, `limit`, `offset`; response → `{activities,total,limit,offset}` (~45)
- [ ] `GET /api/activities/facets` (~25)
- [ ] `ActivityUpsert` + PATCH `addTags`/`removeTags`; `_serialize` emits `inherited*` (~40)
- [ ] Backend tests (~250) — see Testing

**Files:** `db/models/taxonomy.py` (new) · `db/models/{activity,curriculum}.py` · `db/activities.py` · `protocols/activity_routes.py` · `tests/`

**Acceptance:**
- Activity citing a `Fysik` doc matches `?subject=Fysik` with no activity-level subject set
- Re-tagging the doc changes what the activity matches, with **zero writes to the activity**
- Shared catalogue inherits only from `ownerScope == "shared"` docs (ACL test)
- `make lint && make test-fast` green, no regression from the 2667 baseline

### Milestone 2 — Frontend: shared FacetRow, activities + catalogue
**Scope:** frontend · **Estimated:** ~450 impl + ~200 tests = ~650 LOC · **Duration:** ~1d

**Tasks:**
- [ ] Extract `FacetRow` + `ActiveChip` → `components/teacher/ui/FacetRow.tsx`; re-point `MaterialsSection` (net ~0, moves ~140 out of a 1099-line file)
- [ ] Delete the hand-copied `SUBJECTS` at `MaterialsSection.tsx:178`; take the vocabulary from `/facets` (~25)
- [ ] `teacherApi.ts`: filter params + the `{activities,total,…}` response shape on `listActivities` / `listSharedCatalogue` (~60)
- [ ] Activities page: debounced search + facet strip + active chips + pagination (~180)
- [ ] Shared catalogue: same strip (~60)
- [ ] Per-activity facet editor + inherited chips (dimmed, paperclip, not removable) (~120)
- [ ] **`elementPayload()` carries `tags`/`subject`/`level`** + its test (~40)
- [ ] Frontend tests (~200)

**Files:** `components/teacher/ui/FacetRow.tsx` (new) · `MaterialsSection.tsx` · `app/teacher/activities/page.tsx` · `app/teacher/research/activities/page.tsx` · `lib/teacherApi.ts` · `hooks/useActivityBuilder.ts` · `__tests__/`

**Acceptance:**
- Tagging a document in Materials makes the citing activity findable under that tag with no activity edit
- Existing `MaterialsSection` tests pass **unchanged** after the extraction
- Saving from the builder cannot wipe facets set on the activities page, and a test says so
- `npm run quality:check` green, no regression from the 1500 baseline

### Milestone 3 — Co-pilot + CLI
**Scope:** fullstack · **Estimated:** ~180 impl + ~90 tests = ~270 LOC · **Duration:** ~0.5d

**Tasks:**
- [ ] `attach_material` passes `tags`/`subject`/`folder` to the browse (~30)
- [ ] `set_activity_facets` propose-only tool + `applyCopilotProposal` branch (~110)
- [ ] `aiplatform activity list --tag/--subject/--level/-q` + `activity set` (~40)
- [ ] Tests (~90)

**Acceptance:** the authoring co-pilot can find materials by tag/subject and file the activity it just authored; CLI mirrors the web contract.

## Cross-cutting risks

| Risk | Mitigation |
|---|---|
| **Full-overwrite POST wipes facets** — the documented footgun, already cost data twice | `elementPayload()` test in M2, written before the editor lands |
| **ACL leak via inheritance** — a published activity citing a private upload | Resolve against the CALLER's visible set; explicit test. Looks identical in single-teacher dev data, so the test is the only real check |
| **Response-shape break** on `GET /api/activities` | Both `teacherApi` callers updated in the same commit; `scripts/seed-guide-corpus.mjs` also reads this endpoint as a bare list and is NOT covered by CI — update it in M1 |
| **`FacetRow` extraction changes Materials** | Existing `MaterialsSection` tests must pass unchanged; treat any diff as a regression |

## Testing Strategy

**Backend (pytest)** — inheritance headline case; re-tag re-files with no activity write; own ∪ inherited union; tags AND; `__unlevelled__`; deleted cited doc contributes nothing; **ACL leak**; narrowed facet counts; facets ACL-scoped; `total` vs page length; `extra="forbid"` still holds.

**Frontend (vitest)** — `elementPayload` includes the three fields; `MaterialsSection` tests unchanged; inherited chips dimmed + non-removable; search debounced; empty/loading/no-match; subject options come from `/facets`.

## Quality Gates
- After M1: `cd backend && make lint && make test-fast`
- After M2: `cd frontend && npm run quality:check`
- Before push: both (CI parity — the fast variants miss tests and typecheck)
- `make check-cloudbuild`, `make audit-trust-cards`, skill catalogue — unchanged by this sprint but run in CI

## Out of scope (from the design doc's Non-Goals)
Folders for activities · a second taxonomy · full-text search over activity element bodies · per-artefact default tags for sim-only activities (open question 2).
