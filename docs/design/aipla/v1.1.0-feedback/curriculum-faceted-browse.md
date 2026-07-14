# Curriculum Library — Faceted Browse (folders + tags + subject + search)

**Status**: Implemented (M0–M4 SHIPPED 2026-07-13)
**Priority**: P2 (breadth probe — teacher library ergonomics)
**Estimated**: ~3–4 days (M0 shipped; M1 ~0.75d · M2 ~0.75d · M3 ~1.5d · M4 ~0.75d)
**Scope**: Fullstack (backend model + browse filter + ingest; frontend Materials browser; CLI)
**Dependencies**: [1.1.25 curriculum-library](curriculum-library.md) (`CurriculumDoc`, `curriculum_docs`, `MaterialsSection`, `aiplatform curriculum` CLI, RAG corpus), [1.1.52 copilot-curriculum-selection](copilot-curriculum-selection.md) (the `summary` field + `summarize` backfill this search now leans on)
**Created**: 2026-07-13
**Last Updated**: 2026-07-13
**Sequence**: 1.1.58

## Problem Statement

A teacher searched the Materials browser for "atomer" and got **zero results**
for a library that contains atomic-physics material. The "search" box did an
**exact, whole-string, case-insensitive equality on the `topic` metadata field
only** ([backend/db/curriculum.py:88](../../../../backend/db/curriculum.py#L88),
pre-fix) — so it matched neither the **title** ("Atomer og molekyler"), the
**summary**, nor a partial topic, and every teacher upload (which is
level-less and topic-less by design) was **invisible to search entirely**.

The user's second question — "can we also support folders or tags or metadata
and subjects?" — exposes that the curriculum library has exactly **two**
organising axes today (`level` A/B/C and a single freeform `topic` string) and
no way to group, tag, or subject-classify a growing corpus. As the shared
cleared corpus and per-teacher uploads accumulate, a two-filter browse over an
unstructured list does not scale for a teacher trying to find material.

**Current State:**
- **Search was broken** (exact `topic` equality). *Fixed in M0 — see below.*
- **No tags.** `CurriculumDoc` has no tags field; nothing to group cross-cutting
  themes (e.g. "exam-prep", "lab", "1.g", "Haka-kap-4") that don't fit A/B/C.
- **No subject facet.** `topic` is a single freeform string with no vocabulary,
  so "mechanics" / "mekanik" / "Newton" fragment the same subject.
- **No folders.** Curriculum docs are a flat ACL-scoped list. A folder system
  *exists* but only for `parsed_documents` (the student-upload feedback viewer,
  a different collection) — it is not wired to `CurriculumDoc`.
- **The browse fires on every keystroke** with no debounce
  ([MaterialsSection.tsx:58-81](../../../../frontend/src/components/teacher/MaterialsSection.tsx#L58-L81)).

**Impact:**
- **Who:** every teacher using the Materials browser (authoring surface) — and,
  transitively, the authoring co-pilot's `attach_material`, which reads the same
  metadata. A search that returns nothing reads as "the library is empty / broken".
- **How significant:** major friction on the core authoring loop. Not a data-loss
  bug, but it makes the library feel unusable at the exact moment a teacher tries
  to use it. Fits the [UX-coherence gate](../../../../CLAUDE.md) — a probe only
  counts if a teacher can actually use it.

## Goals

**Primary Goal:** Make the teacher Materials browser a **faceted library** — a
single free-text search box (title + topic + summary + tags) plus removable
**facet chips** for level, subject, tag, and folder — so a teacher can find any
document in a growing corpus in one or two interactions.

**Success Metrics:**
- Searching any substring of a doc's title / topic / summary / tag returns it
  (the "atomer" case passes). *(M0 — done)*
- A teacher can tag a doc, filter by that tag from a chip, and combine it with a
  level/subject filter (AND across facets).
- A teacher can put docs in a folder and browse a folder, with the folder ACL
  identical to the doc ACL (shared folders for the shared corpus, private folders
  per teacher).
- Zero UX-only rework: the empty / loading / no-match / active-filter states are
  specified here, before the UI is built.

**Non-Goals:**
- **Full-text / semantic search over document *content*.** That is the RAG path
  ([curriculum_retrieval.py](../../../../backend/adk/curriculum_retrieval.py)) and
  its teacher-scoped extension is [1.1.52 Phase 2](copilot-curriculum-selection.md),
  deliberately gated behind clearance/privacy sign-off. This doc is **metadata
  browse only**.
- **Hierarchical (nested) folders.** Flat folders only, matching the existing
  `parsed_documents` precedent. Nesting is YAGNI until asked for.
- **A shared cross-teacher tag taxonomy.** Tags are freeform strings; a curated
  vocabulary is a later slice if fragmentation becomes a problem.
- **Moving the filter off in-memory Python** to Firestore composite indexes. The
  browse already fetches the ACL-scoped set and filters in Python; that is fine at
  current corpus size (see Performance). Called out as a known scaling limit.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../../docs/product-axioms.md). Net score must be >= +4. Max 2 conflicts (-1) allowed.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Faster find; adds input debounce (currently fires per-keystroke) + a loading state on the browse. |
| 2 | EARNED TRUST | 0 | Metadata organisation; no factual claims or AI-generated data presented as fact. |
| 3 | SKILLS, NOT FEATURES | 0 | Teacher library-management surface, orthogonal to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Optional subject suggestion reuses the *existing* cheap ingest summary pass (no new reasoning-model call); search itself is zero-LLM string matching. |
| 5 | GRACEFUL DEGRADATION | +1 | All new fields optional + default-empty; legacy docs (no tags/subject/folder) still list and search. No facet = full list; no folder = "unfiled". |
| 6 | PROTOCOL OVER CUSTOM | 0 | Internal Firestore metadata + query params; no protocol boundary. Reuses the existing flat-folder pattern rather than inventing one. |
| 7 | API FIRST | +1 | All facets are query params on the single `GET /api/curriculum`; web browse, the CLI, and the co-pilot share one contract. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Covered by existing request instrumentation. |
| 9 | SECURE BY CONSTRUCTION | +1 | Folders reuse the doc's `ownerScope` ACL key (deny-by-default preserved): a shared folder is writable only by the shared-corpus admin path, a private folder only by its owner. No new trust surface; tags/subject are owner-scoped free text validated on length. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Filtering stays in the backend; the frontend sends params and renders rows/chips. No client-side filtering logic. |
| 11 | USABLE BY DESIGN | +1 | Teacher surface. Empty / loading / no-match / active-filter-chip states are specified up front (below), before build. |
| | **Net Score** | **+7** | Threshold: >= +4 |

**Conflict Justifications:** None (no axiom scored -1).

## Design

### Overview

Add three optional, owner-scoped organising fields to `CurriculumDoc` —
`tags: list[str]`, `subject: str | None`, and a flat folder pointer
(`folder_id` / `folder_name`) — thread them through the single ingest
constructor and the single in-memory browse filter, and rebuild the Materials
filter bar as a **search box + removable facet chips**. Folders get a small
`curriculum_folders` collection keyed by the same `ownerScope` ACL as the docs
themselves, so folder visibility can never diverge from document visibility.

The search box (M0) is already a multi-term substring match; M1–M4 add the
facet dimensions and the chip UX around it.

### M0 — Search fix (SHIPPED 2026-07-13, commit `1b7a52f`)

[backend/db/curriculum.py](../../../../backend/db/curriculum.py) `list_curriculum_for_teacher`
now does a case-insensitive **substring** match with multi-word AND semantics
across `title + topic + summary`:

```python
if topic:
    needles = topic.lower().split()
    docs = [d for d in docs
            if all(term in f"{d.title} {d.topic or ''} {d.summary}".lower()
                   for term in needles)]
```

No schema change, no indexing — the list already fetches the ACL-scoped set and
filters in Python. Tests in
[test_curriculum_routes.py](../../../../backend/tests/api_tests/test_curriculum_routes.py)
(`test_search_matches_substring_and_title_and_summary`,
`test_search_multi_term_is_and`). M1 extends the haystack to include `tags`.

### Data Model Changes

[backend/db/models/curriculum.py](../../../../backend/db/models/curriculum.py) — add to `CurriculumDoc`:

```python
# 1.1.58 — cross-cutting freeform labels (exam-prep, lab, "1.g", chapter refs).
# Owner-set, searchable, and surfaced as facet chips. Lowercased on write.
tags: list[str] = Field(default_factory=list)
# 1.1.58 — a coarse subject area from a SOFT vocabulary (see SUBJECTS below).
# Distinct from `topic` (freeform, fine-grained): subject is the facet a teacher
# filters by; topic stays the free label. Optional — legacy/unfiled docs have none.
subject: str | None = Field(default=None, max_length=60)
# 1.1.58 — flat folder membership, denormalised like ParsedDocument.folderId.
# The folder's ownerScope MUST equal this doc's ownerScope (enforced on assign).
folder_id: str | None = Field(default=None, alias="folderId")
folder_name: str | None = Field(default=None, alias="folderName")
```

All optional / default-empty → **no backfill required**; legacy docs list and
search unchanged.

**Subject vocabulary** (soft — suggested chips, free entry still allowed so we
don't block a teacher on a missing category). A module constant, Danish stx
physics areas, e.g.:

```python
SUBJECTS = [
    "Mekanik", "Termodynamik", "Elektromagnetisme", "Bølger og optik",
    "Atom- og kernefysik", "Kvantefysik", "Astrofysik", "Relativitet",
    "Eksperimentel metode",
]  # not a Literal — free entry allowed; these seed the facet chips
```

**New collection — `curriculum_folders`** (flat, ACL-scoped by `ownerScope`):

```python
class CurriculumFolder(BaseModel):
    folder_id: str = Field(alias="folderId")
    name: str = Field(min_length=1, max_length=120)
    owner_scope: str = Field(alias="ownerScope", max_length=200)  # "shared" | teacher uid
    doc_count: int = Field(default=0, alias="docCount")
    created_at: datetime = Field(alias="createdAt")
```

Deliberately mirrors the existing flat `Folder`
([backend/db/folders.py](../../../../backend/db/folders.py#L21-L29)) but keyed by
`ownerScope` (top-level collection) rather than `users/{uid}/folders`, so a
folder inherits the doc ACL exactly (`list_curriculum_for_teacher` already scopes
by `ownerScope`).

### Backend Changes

**Filter — [backend/db/curriculum.py](../../../../backend/db/curriculum.py) `list_curriculum_for_teacher`.** Extend the signature and the in-memory block:

```python
def list_curriculum_for_teacher(
    teacher_uid, *, level=None, q=None, subject=None,
    tags=None, folder_id=None, scope=None,
) -> list[CurriculumDoc]:
    ...  # ACL fetch unchanged
    if level:    docs = [d for d in docs if d.level == level]
    if subject:  docs = [d for d in docs if d.subject == subject]
    if folder_id: docs = [d for d in docs if d.folder_id == folder_id]
    if tags:     docs = [d for d in docs if set(t.lower() for t in tags) <= set(d.tags)]  # AND
    if q:        # M0 haystack + tags
        needles = q.lower().split()
        docs = [d for d in docs
                if all(term in f"{d.title} {d.topic or ''} {d.summary} {' '.join(d.tags)}".lower()
                       for term in needles)]
    ...
```

`topic` param kept as a back-compat alias for `q` (the co-pilot / CLI still pass
`topic`); the web UI moves to `q`. Multi-select within `tags` = AND (narrowing);
`subject` / `folder_id` / `level` are single-value.

**Browse endpoint — [backend/protocols/curriculum_routes.py](../../../../backend/protocols/curriculum_routes.py) `GET /api/curriculum`.**
Add query params `q`, `subject`, `tags` (repeatable), `folder`. Teacher-only ACL
unchanged (403 for group/student tokens).

**New folder + facet endpoints** (all teacher-only, ACL by `ownerScope`):

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET`  | `/api/curriculum/folders?scope=` | list folders visible to the teacher (shared + own) |
| `POST` | `/api/curriculum/folders` | create a folder (owner_scope = teacher uid, or `shared` via the admin path) |
| `GET`  | `/api/curriculum/facets?scope=` | distinct subjects + tags present in the visible set, for chip population |
| `PATCH`| `/api/curriculum/{doc_id}` | set `tags` / `subject` / `folder_id` on a doc (owner check; assigning a folder asserts `folder.owner_scope == doc.owner_scope`) |

`facets` is computed from the already-fetched ACL set (no extra store) so the
chip row only ever shows subjects/tags the teacher can actually see.

**Ingest — [curriculum_routes.py `POST /api/curriculum/ingest`](../../../../backend/protocols/curriculum_routes.py#L134).**
Add optional `Form()` params `subject`, `tags` (comma-split), `folder_id`; pass
them into the single `CurriculumDoc(...)` construction
([~L192](../../../../backend/protocols/curriculum_routes.py#L192)). Optionally,
the existing ingest summary pass ([~L189](../../../../backend/protocols/curriculum_routes.py#L189))
can *suggest* a `subject` from the `SUBJECTS` list in the same cheap call (no new
model call, no auto-commit — the teacher confirms). EARNED-TRUST-safe because
it's a suggestion the teacher accepts, never a silent classification.

### Frontend Changes

**Type — [frontend/src/lib/curriculumApi.ts](../../../../frontend/src/lib/curriculumApi.ts#L20-L38).**
Add `tags: string[]`, `subject: string | null`, `folderId: string | null`,
`folderName: string | null` to `CurriculumDoc`; add `q`, `subject`, `tags[]`,
`folder` to `BrowseCurriculumParams`; add `listCurriculumFolders`,
`listCurriculumFacets`, `patchCurriculumDoc`.

**Modified — [MaterialsSection.tsx](../../../../frontend/src/components/teacher/MaterialsSection.tsx).**
Rebuild the filter bar
([L251-L296](../../../../frontend/src/components/teacher/MaterialsSection.tsx#L251-L296))
as **search box + facet chips**:

```
┌────────────────────────────────────────────────────────────┐
│  🔍 [ Search materials…            ]        [ Upload ]      │  ← q, debounced 250ms
│  Level: (A)(B)(C)   Subject: (Mekanik)(Optik)…   + Tags ▾   │  ← facet chips, click = toggle
│  Folders: (All)(Haka kap. 4)(Exam 2024)…                   │  ← folder rail (chips)
├────────────────────────────────────────────────────────────┤
│  Active: [Level A ✕] [Subject: Optik ✕]   Clear all        │  ← removable active-filter chips
├────────────────────────────────────────────────────────────┤
│  … result rows (title · origin · Level · subject · tags) … │
└────────────────────────────────────────────────────────────┘
```

- Chip source: `listCurriculumFacets()` (subjects + tags actually present) +
  `listCurriculumFolders()`. Level chips are static A/B/C.
- Selecting chips builds the browse query; **within a facet** multi-select tags =
  AND; **across facets** = AND. Active filters echo as removable chips (reuse the
  existing cited-materials chip pattern at
  [L136-L249](../../../../frontend/src/components/teacher/MaterialsSection.tsx#L136-L249)).
- Result rows extend the existing meta line to show `subject` + tag chips
  ([L321-L373](../../../../frontend/src/components/teacher/MaterialsSection.tsx#L321-L373)).
- Per-row overflow menu → set subject / tags / move to folder (calls `PATCH`).
- **Debounce** the search input at 250ms (kills the per-keystroke fetch).

**Designed states (USABLE BY DESIGN):**
- **Loading:** row skeletons, not a spinner-void; keep the filter bar interactive.
- **Empty library (no docs at all):** "No materials yet — upload your first" + the
  Upload affordance.
- **No match (filters/search return nothing):** "No materials match [Level A ·
  Optik · 'atomer']" with a one-click **Clear all** — never a blank void, always a
  way back. This is the exact state the original bug dumped the teacher into with
  no explanation.
- **Unfiled:** docs with no folder appear under an "Unfiled" chip, never hidden.

### CLI Surface

Extend the existing `aiplatform curriculum` CLI (from 1.1.25):

```
aiplatform curriculum folders [--scope shared|mine]        # list folders
aiplatform curriculum folder new "<name>" [--shared]       # create
aiplatform curriculum tag <doc_id> --add lab --add exam    # edit tags
aiplatform curriculum set <doc_id> --subject Optik --folder <id>
aiplatform curriculum browse --q atomer --subject Optik --tag lab   # dogfood the facet query
```

Each is a Click subcommand over an httpx call to the endpoints above (~0.15d
each), so the facets are testable without a Firebase token + curl-by-hand.

### API Changes

| Method | Endpoint | Description | Breaking? |
|--------|----------|-------------|-----------|
| GET | /api/curriculum | + `q`, `subject`, `tags[]`, `folder` params (`topic` kept as alias) | No |
| GET | /api/curriculum/folders | list ACL-scoped curriculum folders | No (new) |
| POST | /api/curriculum/folders | create a folder | No (new) |
| GET | /api/curriculum/facets | distinct subjects + tags in the visible set | No (new) |
| PATCH | /api/curriculum/{doc_id} | set tags / subject / folder | No (new) |
| POST | /api/curriculum/ingest | + optional `subject`, `tags`, `folder_id` form fields | No |

### Architecture Diagram

```
[Teacher] → MaterialsSection (search box + facet chips)
                │  q, subject, tags[], folder, level, scope
                ▼
        /api/proxy → GET /api/curriculum  (teacher-only ACL)
                │
                ▼
      list_curriculum_for_teacher  ── ownerScope fetch ──▶ Firestore curriculum_docs
                │  in-memory filter: level → subject → folder → tags(AND) → q(substring)
                ▼
        sorted rows (title, origin, level, subject, tags)

      facet chips ◀── GET /api/curriculum/facets (distinct subject/tags in visible set)
      folder rail ◀── GET /api/curriculum/folders (ownerScope-scoped)   curriculum_folders
```

## Implementation Plan

### M0 — Search fix (~SHIPPED)
- [x] Substring + multi-term AND over title/topic/summary — commit `1b7a52f`
- [x] Tests (`test_search_*`)

### M1 — Tags (~0.75d) — SHIPPED 2026-07-13 (TAGS-1)
- [x] `tags` field on `CurriculumDoc` + `normalize_tags` + include in the `q` haystack
- [x] Ingest `tags` form param + `PATCH /api/curriculum/{id}` (full-set or add/remove deltas)
- [x] `GET /api/curriculum/facets` distinct-tags (ACL-scoped)
- [x] FE: tag chips on rows + tag facet chips (AND) + per-row inline edit
- [x] `aiplatform curriculum tag` / `facets` / `list --tag` + tests
- Sprint: [curriculum-faceted-browse-sprint.md](curriculum-faceted-browse-sprint.md)

### M2 — Subject facet (~0.75d) — SHIPPED 2026-07-13
- [x] `subject` field + `SUBJECTS` vocab + `normalize_subject` + browse/ingest/PATCH wiring
- [x] FE: subject facet chips + row meta + per-row set-subject `<select>`
- [x] `aiplatform curriculum set --subject` + `list --subject` + tests
- (subject suggestion in the ingest summary pass — deferred; optional micro-feature)

### M3 — Folders (~1.5d) — SHIPPED 2026-07-13
- [x] `CurriculumFolder` model + `curriculum_folders` CRUD (keyed by `ownerScope`)
- [x] `folderId`/`folderName` on `CurriculumDoc`; PATCH assign asserts scope-match (400/404)
- [x] `GET`/`POST /api/curriculum/folders`, folder filter + `UNFILED` sentinel, live `docCount`
- [x] FE: folder rail (All/Unfiled/folders+counts/New) + per-row move-to-folder (same-scope only)
- [x] `aiplatform curriculum folder new/list` + `set --folder` + tests

### M4 — Faceted browse UX unify (~0.75d) — SHIPPED 2026-07-13
- [x] Search box relabel (`topic`→"Search materials"); debounce already shipped in 1.1.59
- [x] Active-filter chip row (level/subject/tag/folder, each removable) + Clear all
- [x] No-match state echoes filters + Clear all (never a dead end)
- [x] Verified end-to-end on deployed dev (2026-07-13) via the real `/api/proxy` path + a Firebase teacher token: "atomer" returns 4 docs (incl. real "Atomer (Mathematicus)" shared docs — the title-match the old exact-topic bug missed); facets reflect tag+subject writes; folder create→assign→filter with live docCount; private→shared-folder assign guarded (400). React render covered by 30 vitest + prod build.

### M5 — Folder delete (~0.25d) — SHIPPED 2026-07-14
- [x] `DELETE /api/curriculum/folders/{id}` — owner-or-shared ACL (404 missing/not-yours, 403 student); **unfiles** its docs (clears folderId/folderName) rather than deleting them; returns `{deleted, unfiled}`
- [x] `delete_curriculum_folder` in db (queries `folderId ==`, clears + saves each, removes folder row)
- [x] CLI `aiplatform curriculum folder delete <id> [--yes]`
- [x] FE: delete × on each folder chip, `window.confirm` ("N docs will be unfiled, not deleted"), refresh on success
- Closes the create/list-but-no-delete gap found during the M4 deploy verify.

## Migration & Rollout

**Database Migrations:** None required — all new doc fields are optional /
default-empty. `curriculum_folders` is a new empty collection. No backfill; a
teacher tags/folders opportunistically. Optional one-off: an
`aiplatform curriculum suggest-subjects` backfill that runs the cheap classifier
over existing docs (teacher confirms in bulk) — deferred, not a blocker.

**Feature Flags:** None. Ships behind the normal `dev` → verify → promote flow.
Each milestone is independently shippable (M1 tags without M3 folders is useful).

**Rollback Plan:** Revert the milestone's commit. Optional fields on existing
docs are ignored by the pre-change browse; the new collection is inert if unused.

**Environment Variables:** None.

**Seed note:** No SKILL.md template change → no `make seed` needed. If the
subject-suggestion prompt lives in a skill template, re-seed per the CLAUDE.md
rule.

## Testing Strategy

### Backend Tests (pytest)
- [ ] Tag filter is AND across multiple tags; case-insensitive
- [ ] Subject exact-match filter; unknown subject → empty, doesn't crash
- [ ] Folder filter returns only that folder's docs; scope-mismatch assign → 4xx
- [ ] Folder ACL: teacher A cannot list / assign into teacher B's private folder
- [ ] `facets` returns only subjects/tags in the caller's visible (ACL-scoped) set
- [ ] `q` haystack includes tags (M1) — extend the M0 tests
- [ ] Legacy doc (no tags/subject/folder) still lists, searches, and sorts

### Frontend Tests (Vitest + RTL)
- [ ] Facet chip toggle updates the browse query (AND across facets)
- [ ] Active-filter chips render + individual remove + Clear all
- [ ] Search input debounces (one fetch per settle, not per keystroke)
- [ ] No-match state renders the active filters + Clear all (never a blank void)
- [ ] Loading skeleton + empty-library states render

### Manual / Browser (aitana-frontend-verify)
- [ ] "atomer" returns the atomic-physics doc on deployed dev *(M0 acceptance)*
- [ ] Tag a doc, filter by that tag chip, combine with Level A → correct narrowing
- [ ] Create a folder, move a doc, browse the folder; second teacher can't see it

## Security Considerations

- **ACL parity is the crux.** A folder's `owner_scope` must equal its docs'
  `owner_scope`; `PATCH` assign asserts this and the endpoint ACLs identically to
  the doc browse (teacher sees shared + own; students 403). This is why folders
  are keyed by `ownerScope`, not `users/{uid}` — so folder visibility can never
  drift from document visibility (SECURE BY CONSTRUCTION).
- **Shared-corpus writes** (creating a `shared` folder, tagging a shared doc) go
  through the same admin/clearance path as shared-doc ingest — a regular teacher
  can create private folders and tag their own docs only.
- Tags/subject are owner-scoped free text; validate length (tag ≤ 40, subject ≤
  60, ≤ 20 tags/doc), lowercase tags on write. No tag/subject reaches a model
  context unsanitised beyond the existing browse rendering.
- Students never touch this surface (teacher-only endpoints) — no anon-group path
  to wire, but the 403 is asserted in tests per the recurring anon-group rule.

## Performance Considerations

- The browse **fetches the ACL-scoped set and filters in Python** (unchanged from
  today). Fine while a teacher's visible corpus is O(hundreds). **Known scaling
  limit:** past ~low-thousands of docs, move the high-selectivity facets
  (`ownerScope` + `subject` + `folder_id`) to Firestore composite `where` queries
  and keep only `q`/`tags` in memory. Flagged, not built.
- `facets` recomputes from the same fetched set — no extra round trip.
- FE: 250ms debounce removes the per-keystroke fetch storm; bundle impact is chip
  rendering only (<20KB), within THIN CLIENT budget.

## Success Criteria

- [ ] Backend tests passing (`cd backend && make test-fast`)
- [ ] Frontend tests passing (`cd frontend && npm run test:run`)
- [ ] Lint + typecheck clean (backend `make lint`; frontend `npm run quality:check`)
- [ ] "atomer" returns results on deployed dev *(M0)*
- [ ] Tag + subject + folder each filter, combine (AND), and echo as removable chips
- [ ] Folder ACL verified: no cross-teacher folder visibility
- [ ] No-match state always offers a next step (Clear all) — never a blank void
- [ ] CLI: `aiplatform curriculum browse --q --subject --tag` works end-to-end

## Open Questions

- **Subject: soft vocab or hard `Literal`?** This doc proposes **soft** (chips +
  free entry) to avoid blocking on a missing category. If fragmentation appears in
  the pilot, tighten to a curated list. (Recommend soft for v1.)
- **`topic` vs `subject`:** keep both (topic = freeform fine label, subject =
  faceted coarse area), or collapse `topic` into `subject`? Proposed: **keep both**
  — `topic` already carries data and the co-pilot reads it. Revisit if teachers
  find the distinction confusing.
- **Shared-folder governance:** who curates folders on the shared cleared corpus?
  Assumed the same M/JB clearance path as shared-doc ingest. Confirm.

## Related Documents

- [1.1.25 curriculum-library](curriculum-library.md) — the `CurriculumDoc` model, browse, RAG corpus, and CLI this extends
- [1.1.52 copilot-curriculum-selection](copilot-curriculum-selection.md) — the `summary` field the search leans on; Phase 2 is the content-search boundary this doc stays clear of
- [backend/db/folders.py](../../../../backend/db/folders.py) — the flat `parsed_documents` folder pattern reused (separate stack, UI-pattern reference)
- ADR-010 (RAG retrieval boundary) — why content search is out of scope here
