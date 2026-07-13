# Sprint Plan: TAGS-1 — Curriculum Library Tags (1.1.58 M1)

## Summary

Add freeform **tags** to the curriculum library: a `tags` field on `CurriculumDoc`,
tags folded into the browse search, a tag facet + per-row tag editing in the
teacher Materials browser, and CLI parity. First slice of the
[curriculum-faceted-browse](curriculum-faceted-browse.md) faceted-browse feature
(M0 search fix already shipped, commit `42417d9`).

**Duration:** ~0.75 day
**Scope:** Fullstack (backend model + routes, CLI, frontend)
**Dependencies:** M0 search fix (shipped); [1.1.25 curriculum-library](curriculum-library.md); [1.1.52](copilot-curriculum-selection.md) (`summary`)
**Risk Level:** Low — additive optional field, no migration, established patterns
**Design Doc:** [curriculum-faceted-browse.md](curriculum-faceted-browse.md) (M1)

## Current Status Analysis

### Existing Implementation (touch points, verified 2026-07-13)
- **Model:** [`CurriculumDoc`](../../../../backend/db/models/curriculum.py#L26) — add `tags` here.
- **Filter:** [`list_curriculum_for_teacher`](../../../../backend/db/curriculum.py#L65) — M0 already builds the `q` haystack; extend to include tags + a `tags` AND filter.
- **Routes:** [`curriculum_routes.py`](../../../../backend/protocols/curriculum_routes.py) — `browse_curriculum` (L83, add `tags` param), `ingest_curriculum` (L134, add `tags` Form), + two NEW routes (`PATCH /{doc_id}`, `GET /facets`).
- **CLI:** [`commands/curriculum.py`](../../../../cli/aiplatform/commands/curriculum.py) — add `tag` command; `--tag` on `list`.
- **FE client:** [`curriculumApi.ts`](../../../../frontend/src/lib/curriculumApi.ts) — add `tags` to `CurriculumDoc` + `BrowseCurriculumParams`, `patchCurriculumDoc`, `listCurriculumFacets`.
- **FE UI:** [`MaterialsSection.tsx`](../../../../frontend/src/components/teacher/MaterialsSection.tsx) — tag chips on rows (L338 meta line), a tag facet chip row, per-row edit-tags.
- **Tests:** [`test_curriculum_routes.py`](../../../../backend/tests/api_tests/test_curriculum_routes.py) (M0 tests to extend), [`test_cli_curriculum.py`](../../../../cli/tests/test_cli_curriculum.py), FE `MaterialsSection` tests.

### Validation rules (decided here)
- ≤ 20 tags/doc; each tag ≤ 40 chars; **lowercased + trimmed on write**; empties dropped; de-duplicated.
- Tag filter is **AND** (every selected tag must be present). Search (`q`) includes tags in the haystack (OR-ish substring, per M0 multi-term AND across the full haystack).

## Milestones

### Milestone 1: Backend — model + filter + facets/PATCH routes
**Scope:** backend · **Goal:** tags exist, are searchable, filterable, editable, and enumerable.

**Tasks:**
- [ ] `tags: list[str] = Field(default_factory=list)` on `CurriculumDoc` + a `normalize_tags()` helper (lowercase/trim/dedupe/cap) (~20 LOC)
- [ ] Extend `list_curriculum_for_teacher`: add `tags: list[str] | None` param (AND filter); fold `' '.join(d.tags)` into the `q` haystack (~15 LOC)
- [ ] `browse_curriculum`: accept repeatable `tags` query param → pass through (~5 LOC)
- [ ] `ingest_curriculum`: optional `tags` Form (comma-split → normalize) (~8 LOC)
- [ ] `PATCH /api/curriculum/{doc_id}` — set tags; owner-or-shared ACL (mirror delete/summarize ACL); 404 no-existence-leak; returns updated doc (~40 LOC)
- [ ] `GET /api/curriculum/facets?scope=` — distinct sorted tags across the ACL-scoped set (~20 LOC)
- [ ] Tests: filter AND, search-includes-tags, normalize rules, PATCH ACL (own ok / shared ok / other-teacher 403 / student 403 / 404), facets distinctness + ACL (~120 LOC)

**Acceptance:**
- [ ] `list_curriculum_for_teacher(tags=["lab"])` returns only docs tagged `lab`
- [ ] Searching a tag substring via `q`/`topic` returns the doc
- [ ] PATCH rejects a student (403), another teacher's private doc (403), unknown doc (404)
- [ ] `facets` never returns a tag the caller can't see
- [ ] `cd backend && make lint && make test-fast` green

### Milestone 2: CLI — `curriculum tag` + `list --tag`
**Scope:** backend/CLI · **Goal:** tags are settable + filterable without a browser.

**Tasks:**
- [ ] `aiplatform curriculum tag <doc_id> [--add T]… [--remove T]… [--set T]…` → GET current doc? No — PATCH takes the final list; `--add/--remove` compose against the doc's current tags fetched via a `GET /{id}`… **simpler:** PATCH accepts `{tags: [...]}` (full set) AND `{addTags, removeTags}` deltas → CLI sends deltas so no read-modify-write race (~35 LOC)
- [ ] `--tag` (repeatable) option on `curriculum list` (~5 LOC)
- [ ] `aiplatform curriculum facets [--scope]` (thin, dogfoods the endpoint) (~10 LOC)
- [ ] Tests in `test_cli_curriculum.py` (mock the HTTP client) (~40 LOC)

**Acceptance:**
- [ ] `aiplatform curriculum tag <id> --add lab --add exam` sets both
- [ ] `aiplatform curriculum list --tag lab` filters
- [ ] `cd cli && <test cmd>` green

### Milestone 3: Frontend — tag chips + facet + edit
**Scope:** frontend · **Goal:** a teacher sees, filters by, and edits tags in Materials.

**Tasks:**
- [ ] `curriculumApi.ts`: `tags` on `CurriculumDoc`; `tags?: string[]` on `BrowseCurriculumParams` (→ repeatable `tags` qs); `listCurriculumFacets()`; `patchCurriculumDoc(docId, {addTags?, removeTags?, tags?})` (~40 LOC)
- [ ] `MaterialsSection.tsx`: render tag chips on each row (meta area, L338); a **tag facet chip row** (from `facets`, click = toggle, AND); active-tag chips reflected in the query; a small per-row "edit tags" popover (add/remove) calling PATCH + optimistic refresh (~150 LOC)
- [ ] Debounce is deferred to M4 (search box rework); this milestone reuses the existing topic input
- [ ] Vitest: chip toggle updates query; edit-tags calls PATCH; facet row renders from mocked facets; no-facets → no chip row (~90 LOC)

**Acceptance:**
- [ ] Tags show on rows; clicking a tag chip filters the list (AND with level)
- [ ] Editing a doc's tags persists (PATCH) and the row updates
- [ ] `cd frontend && npm run quality:check` green

## Day-by-Day Breakdown

### Day 1 (single day, TDD throughout)
- **AM:** M1 backend (model → filter → routes), tests first per unit. Checkpoint: `make test-fast` green, PATCH/facets curl-verified against a local backend.
- **Midday:** M2 CLI (fast — thin wrappers), tests green.
- **PM:** M3 frontend client + MaterialsSection chips/edit, vitest green, `quality:check` green.
- **Close:** commit per milestone (`feat(curriculum): TAGS-1 M1/M2/M3`), push dev (auto-deploy), browser-verify a tag round-trip on deployed dev.

## Success Metrics
- Backend + CLI + FE tests green (CI parity: `make lint`, `make test-fast`, `npm run quality:check`).
- A teacher can tag → filter-by-tag → combine with level, and search finds a tag. Verified in the browser on dev.
- No migration, no seed (no SKILL.md change).

## Notes / Decisions
- **PATCH takes deltas (`addTags`/`removeTags`) AND/OR a full `tags` set** — deltas avoid a CLI read-modify-write race; the FE edit popover can send either.
- Tag normalization lives in ONE place (`db/models/curriculum.py`) and is applied on every write path (ingest, PATCH) so the store is always canonical-form.
- Facets computed from the already-fetched ACL set — no separate index, no extra store (keeps it honest re: what the teacher can see).

---

# Sprint 2: TAGS-1 continuation — subject facet, folders, UX unify (1.1.58 M2–M4)

**Duration:** ~3 days · **Scope:** Fullstack · **Decision taken:** keep BOTH `topic`
(freeform) and `subject` (faceted) — additive, reversible (design-doc open-question resolved).

## M2 — Subject facet (~0.75d)
Mirrors tags. `subject: str \| None` (≤60) on `CurriculumDoc`; a soft `SUBJECTS`
vocab (Danish stx areas; free entry allowed). Filter by subject (exact) in
`list_curriculum_for_teacher`; ingest `subject` Form; extend the doc PATCH to set
`subject`; `facets` returns `{tags, subjects}`. CLI `curriculum set --subject` +
`list --subject`. FE: subject facet chips + row meta + per-row set-subject select.
**Acceptance:** subject filters + combines (AND) with level/tags; facets lists visible subjects; CI green.

## M3 — Folders (~1.5d)
`CurriculumFolder` model + `curriculum_folders` collection **keyed by `ownerScope`**
(flat, no nesting). `folderId`/`folderName` on `CurriculumDoc`. Assign via PATCH —
**asserts `folder.owner_scope == doc.owner_scope`** (ACL parity, the crux).
Endpoints `GET/POST /api/curriculum/folders` (ACL-scoped) + folder filter on browse.
`doc_count` computed on list (no denormalised counter to drift). CLI `folder new/list`
+ `set --folder`. FE: folder rail (chips incl. "Unfiled") + move-to-folder + designed states.
**Acceptance:** folder filters; teacher-2 can't see/assign into teacher-1's private folder; scope-mismatch assign → 4xx; CI green.

## M4 — Faceted-browse UX unify (~0.75d)
Relabel search "Topic" → "Search materials"; an **active-filter chip row**
(level/subject/tag/folder, each removable) + **Clear all**; the **no-match** state
echoes the active filters + Clear all (never a blank void). Debounce already shipped (1.1.59).
**Acceptance:** each facet echoes as a removable chip; Clear all resets; no-match shows the filters + a way back; CI green.

## Notes
- One PATCH endpoint (`PATCH /api/curriculum/{id}`) grows to set tags/subject/folder — not three endpoints.
- Folders reuse the flat `db/folders.py` shape but re-keyed to `ownerScope` (NOT `users/{uid}`) so folder ACL == doc ACL by construction.
- `facets` stays a single endpoint returning all facet vocabularies (`tags`, `subjects`); folders have their own endpoint (they carry ACL + counts).
