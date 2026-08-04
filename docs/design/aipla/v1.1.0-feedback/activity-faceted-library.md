# Activity Library — Faceted Browse (tags, subject, level; inherited from materials)

**Status**: Planned
**Priority**: P2 (teacher library ergonomics — the activity-side twin of 1.1.58)
**Estimated**: ~2–2.5 days (M1 backend ~1d · M2 frontend ~1d · M3 co-pilot ~0.5d)
**Scope**: Fullstack (backend model + list filter + facets endpoint; frontend activities + catalogue; co-pilot tools)
**Dependencies**: [1.1.58 curriculum-faceted-browse](curriculum-faceted-browse.md) (the `tags`/`subject`/`level` vocabulary, `normalize_tags`, the facet-count semantics, `FacetRow`), [1.1.25 curriculum-library](curriculum-library.md) (`MaterialRef`, the `materials` array)
**Created**: 2026-08-04
**Last Updated**: 2026-08-04
**Sequence**: 1.1.61

## Problem Statement

1.1.58 gave **documents** four organising axes — `level` (A/B/C), `subject`
(broad class), `folder` (within-subject taxonomy) and freeform `tags` — plus a
free-text search and narrowed facet counts. 1.1.60 closed the capture gap so
uploads actually carry them, and `bd18936` promoted Materials to a top-level
destination so filing is reachable without inventing an activity.

**Activities got none of it.** `Activity`
([backend/db/models/activity.py:63](../../../../backend/db/models/activity.py#L63))
has no `tags`, no `subject`, no `level`. `GET /api/activities`
([backend/protocols/activity_routes.py:189](../../../../backend/protocols/activity_routes.py#L189))
accepts exactly three params — `owner`, `scope`, `published` — with no `q`, no
filters, no pagination and no sort. The activities page
([frontend/src/app/teacher/activities/page.tsx](../../../../frontend/src/app/teacher/activities/page.tsx))
holds no filter state at all; its only `.filter()` calls dedupe shared-vs-own
and drop optimistically-deleted rows.

So the library a teacher builds *in* is unsearchable, while the library they
draw *from* is fully faceted. That asymmetry gets worse in exactly the place it
matters most: the **cross-teacher shared catalogue** (`?published=true`), which
is a discovery surface with no way to discover anything except by scrolling
every teacher's published activities.

**Current State:**
- **No metadata on activities.** Nothing to filter, group, or search by.
- **No search.** Not even title substring.
- **No pagination.** `list_activities_by_owner` returns everything; the shared
  catalogue returns every published activity across all teachers.
- **Documents already carry the answer.** An activity cites its materials in a
  flat `materials: list[MaterialRef]`
  ([activity_config.py:37](../../../../backend/db/models/activity_config.py#L37)),
  and every one of those docs is already tagged, subjected and levelled. The
  metadata exists; it just isn't reachable from the activity side.

**Impact:**
- **Who:** every teacher with more than a handful of activities, and *especially*
  any teacher browsing the shared catalogue.
- **How significant:** moderate and compounding. Not a correctness bug — it is
  the [UX-coherence gate](../../../../CLAUDE.md) applied to sharing: publishing
  activities is a shipped probe, but a catalogue nobody can search is a probe
  that doesn't count. It also blunts 1.1.58: a teacher who carefully files a
  document gets no benefit when looking for the activity that uses it.

## Goals

**Primary Goal:** Make the activity library and the shared catalogue **faceted
in the same idiom as Materials** — one free-text box plus removable chips for
subject, level and tag — where an activity's facets are **mostly inherited from
the materials it cites**, so the library organises itself as a by-product of
filing documents.

**Success Metrics:**
- An activity citing a `Fysik` / `Mekanik` document is findable under `Fysik`
  **without anyone tagging the activity**.
- Re-tagging a document re-files every activity citing it, with no backfill job
  and no reconciliation step.
- A teacher can search the shared catalogue by subject + tag and get a usable
  shortlist.
- Zero migration: the feature is useful on existing data the moment it ships.

**Non-Goals:**
- **Folders for activities.** Documents live in one folder; activities cite many
  documents and would inherit a set, which is not what a folder means. Tags
  already cover cross-cutting grouping. Revisit only if asked for.
- **A separate activity taxonomy.** One vocabulary or the facets stop composing.
- **Full-text search over activity content** (elements, teaching goal bodies).
  Title + teaching-goal + tags is the haystack; RAG stays for documents.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../../docs/product-axioms.md). Net score must be >= +4. Max 2 conflicts (-1) allowed.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Inherited facets resolve against the already-TTL-cached shared corpus (`_load_shared`); adds pagination to a list that currently returns unbounded rows. Debounced search from the start (1.1.58 shipped it un-debounced and had to fix it). |
| 2 | EARNED TRUST | +1 | Inherited facets are rendered as **visibly inherited** (dimmed, paperclip-marked, with the citing doc named on hover), never silently merged with what the teacher typed. "Why is this tagged Mekanik?" is answerable from the chip. |
| 3 | SKILLS, NOT FEATURES | 0 | Teacher library-management surface, orthogonal to the skill abstraction. |
| 4 | RIGHT MODEL, RIGHT MOMENT | +1 | Zero LLM calls. Inheritance is a set union over data that already exists; search is string matching. |
| 5 | GRACEFUL DEGRADATION | +1 | All new fields optional/default-empty. An activity with no materials and no tags still lists, searches by title, and sorts. A cited doc that has been deleted contributes nothing rather than erroring. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Internal Firestore metadata + query params; no protocol boundary. Deliberately reuses 1.1.58's shapes rather than inventing a second facet contract. |
| 7 | API FIRST | +1 | Facets are query params on the existing `GET /api/activities`; the web library, the shared catalogue and the co-pilot's material/activity lookups share one contract. |
| 8 | OBSERVABLE BY DEFAULT | 0 | Covered by existing request instrumentation. |
| 9 | SECURE BY CONSTRUCTION | +1 | Inheritance is ACL-aware by construction: in the **shared catalogue** an activity inherits only from `ownerScope == "shared"` docs, so a teacher's private upload can never leak its tags to another teacher through an activity that cites it. See Security. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Filtering and inheritance stay server-side; the client sends params and renders rows/chips. No client-side merge logic. |
| 11 | USABLE BY DESIGN | +1 | Extracting `FacetRow` makes Materials and Activities one visual idiom rather than two lookalikes. Empty / loading / no-match / active-chip states specified below before build. |
| | **Net Score** | **+8** | Threshold: >= +4 |

**Conflict Justifications:** None (no axiom scored -1).

## Design

### Overview

Three changes, in dependency order:

1. **`Activity` gains `tags`, `subject`, `level`** — what the teacher explicitly
   set, and only that.
2. **Inherited facets are computed at read time** from the activity's cited
   `materials`, returned as separate fields, and matched by the filters as a
   union with the teacher-set ones.
3. **`GET /api/activities` grows the 1.1.58 param set** plus a
   `/facets` sibling, and the frontend reuses the extracted `FacetRow`.

### The core decision: derive at read, don't copy at attach

The obvious implementation of "auto-assign tags when a document is attached" is
to copy the doc's tags onto the activity in `attach_material`. **Don't.**

| | Copy-at-attach | **Derive-at-read (chosen)** |
|---|---|---|
| Existing activities | Need a backfill pass | Useful immediately |
| Doc re-tagged later | Activity goes stale silently | Activity re-files itself |
| Reconciliation job | Needed, and will drift | None |
| Teacher override | Indistinguishable from inherited | Cleanly separable |
| Cost | One extra write | One set union over a cached read |

The decisive argument is 1.1.60's own postmortem: `subject` was added to the
model in 1.1.58 M2 and **no write path ever populated it**, so the facet showed
one chip for two and a half weeks and the test suite stayed green because every
test exercised the read path. A stored, separately-maintained copy of another
record's metadata is that same shape of bug waiting to happen. A derived value
cannot drift from its source because it has no independent existence.

The cost is real but small: resolving `materials[].docId` against the visible
doc set on every list. That set is already a process-global TTL cache
(`_load_shared`, [backend/db/curriculum.py:57](../../../../backend/db/curriculum.py#L57)),
activities-per-teacher are in the tens, and `_apply_filters` is already a pure
in-memory pass. This is the same shape as `CurriculumFolder.doc_count`, which
the 1.1.58 design deliberately computes on list and never persists *"so it can't
drift"* — the precedent is in the codebase.

### Data Model Changes

`backend/db/models/activity.py` — three optional fields, reusing the curriculum
vocabulary verbatim:

```python
# 1.1.61 — the teacher's OWN facets. Deliberately NOT a copy of the cited
# documents' metadata: that is derived at read time (see inherited_* on the
# API response). These three are only what a teacher explicitly set, so an
# override is always distinguishable from an inheritance.
tags: list[str] = Field(default_factory=list)
subject: str | None = Field(default=None, max_length=MAX_SUBJECT_LEN)
level: StxLevel | None = None
```

Normalisation is shared, not re-implemented. `SUBJECTS`, `MAX_TAGS`,
`MAX_TAG_LEN`, `MAX_SUBJECT_LEN`, `normalize_tags`, `normalize_subject` and
`StxLevel` move from `backend/db/models/curriculum.py` into a new
`backend/db/models/taxonomy.py`, which both models import. Curriculum re-exports
them so no existing import breaks.

**Frontend duplication must be closed in the same change.** `SUBJECTS` is
currently hand-copied into
[MaterialsSection.tsx:178](../../../../frontend/src/components/teacher/MaterialsSection.tsx#L178).
Adding a second consumer makes that a three-way sync. The vocabulary is already
returned by `GET /api/curriculum/facets` as `{value,label,count}` — the pickers
read it from there, and the hardcoded array is deleted.

### Inheritance semantics

For each activity, resolve its `materials` where `kind == "curriculum"` against
the caller's visible doc set and union the facets:

```
inheritedTags     = ∪ doc.tags        for each cited, visible doc
inheritedSubjects = { doc.subject }    (a set — an activity may cite Fysik + Matematik)
inheritedLevels   = { doc.level }      (a set — may cite an A and a B doc)
```

Note the plurals. A document has one `subject` and one `level`; an activity has
a *set* of each, because it cites several documents. The activity's own
`subject`/`level` stay singular — that is the teacher's answer to "what is this
activity", and it wins in display when set.

A filter matches on the union:

```
matches(subject=S) ⟺ activity.subject == S  or  S ∈ inheritedSubjects
```

Cited docs the caller cannot see, and cited docs that have been deleted,
contribute nothing. They are skipped silently — a dangling `docId` is a normal
consequence of deleting a document, not an error state for the activity list.

### Backend Changes

- **`backend/db/models/taxonomy.py`** (new) — the shared vocabulary + normalisers.
- **`backend/db/models/activity.py`** — the three fields; `normalize_tags` /
  `normalize_subject` applied on every write path.
- **`backend/db/activities.py`** — `_apply_activity_filters(activities, docs_by_id, …)`,
  a pure function mirroring `curriculum._apply_filters` (level / subject / tags-AND
  / free-text over `title + teachingGoal + tags`), and
  `facets_for_activities(...)` mirroring `curriculum.facets_for_teacher` with the
  same **narrowed-count** semantics (options from the whole visible set, counts
  from the set filtered by every facet *except* the one being counted).
- **`backend/protocols/activity_routes.py`** —
  - `ActivityUpsert` gains `tags` / `subject` / `level`. It is `extra="forbid"`,
    so this is required before the frontend can send them.
  - `PATCH` gains `addTags` / `removeTags`, mirroring `_DocPatch`.
  - `GET /api/activities` gains `q`, `tags` (repeatable, AND), `subject`,
    `level` (incl. the `__unlevelled__` sentinel), `limit` (≤200, default 50),
    `offset`; response becomes `{activities, total, limit, offset}`.
  - `GET /api/activities/facets` — `{subjects, levels, tags}`, same params.
  - `_serialize` adds `inheritedTags` / `inheritedSubjects` / `inheritedLevels`.

**Response-shape break.** `GET /api/activities` currently returns a bare list;
paginating makes it an object. Both callers (`listActivities`,
`listSharedCatalogue` in `teacherApi.ts`) are updated in the same commit. The
seed script `scripts/seed-guide-corpus.mjs` also reads this endpoint as a list
and must be updated — it is exercised by `make seed-guide-corpus`, not by CI.

### Frontend Changes

- **Extract `FacetRow` + `ActiveChip`** from `MaterialsSection.tsx` (1099 lines)
  into `components/teacher/ui/FacetRow.tsx`. The 1.1.60 commit already describes
  it as *"one chip idiom for all four facets"*; this makes that true across two
  pages instead of one component. Net line reduction.
- **`app/teacher/activities/page.tsx`** — search box (debounced, per Axiom 1) +
  facet strip + active-filter chips + infinite scroll, matching Materials.
- **The shared catalogue** gets the same strip. This is the highest-value
  surface: cross-teacher discovery is currently scroll-only.
- **Per-activity facet editor** — subject `<select>`, level chips, tag add/remove,
  mirroring the Materials row editor. Inherited chips render dimmed with a
  paperclip and a tooltip naming the citing document; they are not removable
  (remove the citation, or set an override).

### API Changes

| Method | Route | Change |
|---|---|---|
| GET | `/api/activities` | **+** `q`, `tags[]`, `subject`, `level`, `limit`, `offset`; response now `{activities,total,limit,offset}` |
| GET | `/api/activities/facets` | **new** — `{subjects,levels,tags}` as `[{value,label,count}]` |
| POST | `/api/activities` | **+** `tags`, `subject`, `level` on `ActivityUpsert` |
| PATCH | `/api/activities/{id}` | **+** the same, plus `addTags` / `removeTags` |

### CLI Surface

`aiplatform activity list` gains `--tag/--subject/--level/-q`, and
`aiplatform activity set --tag/--subject/--level`, mirroring
`aiplatform curriculum`. One contract, three clients (Axiom 7).

## Implementation Plan

### M1 — Backend (~1d)
1. Extract `taxonomy.py`; re-export from `curriculum.py`; no behaviour change.
2. Add the three fields + normalisation on write.
3. `_apply_activity_filters` + `facets_for_activities` + inheritance resolution.
4. Widen `GET /api/activities`, add `/facets`, extend `ActivityUpsert`/PATCH.
5. Tests (below) — including the ACL leak case, written first.

### M2 — Frontend (~1d)
1. Extract `FacetRow`/`ActiveChip`; re-point `MaterialsSection` at them (no
   visual change — snapshot the existing tests first).
2. Delete the hardcoded `SUBJECTS`; read the vocabulary from `/facets`.
3. Activities page: search + facets + chips + pagination.
4. Shared catalogue: same strip.
5. Row editor + inherited-chip rendering.
6. **`elementPayload()` guard** — see Migration.

### M3 — Co-pilot (~0.5d)
`attach_material` ([authoring_tools.py:581](../../../../backend/adk/authoring_tools.py#L581))
passes only `level`/`topic` to the browse. Extend it to `tags`/`subject`/`folder`
so the authoring co-pilot can find materials the way a teacher now can, and add
a `set_activity_facets` proposal so it can file the activity it just authored.

## Migration & Rollout

**Database Migrations:** None. All three fields are optional and default-empty,
and inherited facets are computed, never stored. Legacy activities list, search
and sort unchanged.

**No backfill — by construction.** This is the whole point of deriving at read.
Contrast 1.1.60, which needed `make seed-curriculum-folders` *and* still left
every pre-1.1.60 doc without a subject pending a classifier that does not exist.

**The full-overwrite footgun is the main risk in this change.**
`useActivityBuilder.elementPayload()`
([useActivityBuilder.ts:283](../../../../frontend/src/hooks/useActivityBuilder.ts#L283))
builds the COMPLETE activity body, and `POST`/`PATCH` replace wholesale. If it
does not carry `tags`/`subject`/`level`, then **saving from the builder silently
wipes facets set on the activities page.** This is the documented row in
CLAUDE.md that has already cost data twice (calculator, table). The guard is a
case in `useActivityBuilder.test.ts` asserting the payload round-trips all three,
written in M2 step 6 and not deferred.

**Feature Flags:** None. Ships behind the normal `dev` → verify → promote flow.
Note that as of 2026-08-04 `preview_feature_flags` is `true` on all three envs,
so nothing here is dev-only by default.

**Rollback Plan:** Revert the milestone commit. Optional fields are ignored by
the pre-change list; the `/facets` route becomes a 404 nothing calls.

**Seed note:** No SKILL.md template change → no seed needed, unless M3 adds the
`set_activity_facets` tool to a skill template, in which case the deploy seeds it
automatically (both pipelines, since 2026-08-04).

## Testing Strategy

### Backend Tests (pytest)
- [ ] Activity with no materials and no tags: lists, searches by title, sorts.
- [ ] Activity citing a `Fysik` doc matches `?subject=Fysik` with **no** activity-level subject set — the headline case.
- [ ] Re-tagging the cited doc changes what the activity matches, with no write to the activity.
- [ ] Teacher-set subject AND a different inherited subject: both match (union, not override).
- [ ] Tag filter is AND across multiple tags; case-insensitive.
- [ ] `__unlevelled__` returns activities with no own level and no inherited level.
- [ ] Cited doc deleted → contributes nothing, list does not error.
- [ ] **ACL:** teacher B browsing the shared catalogue sees no facet derived from teacher A's private upload, even though A's published activity cites it.
- [ ] `/facets` counts are narrowed per-facet (picking a subject re-counts tags, sibling subjects keep their counts).
- [ ] `/facets` returns only facets in the caller's visible set.
- [ ] Pagination: `total` is the full match count, not the page length.
- [ ] `ActivityUpsert` rejects an unknown field (`extra="forbid"` still holds).

### Frontend Tests (Vitest + RTL)
- [ ] **`elementPayload()` includes `tags`/`subject`/`level`** — the anti-wipe guard.
- [ ] `FacetRow` extraction: existing `MaterialsSection` tests pass unchanged.
- [ ] Inherited chips render dimmed + are not removable; own chips are.
- [ ] Search is debounced (no fetch per keystroke).
- [ ] Empty / loading / no-match states render.
- [ ] Subject picker options come from `/facets`, not a local constant.

### Manual / Browser (aitana-frontend-verify)
- [ ] Tag a document in Materials → the activity citing it appears under that tag without touching the activity.
- [ ] Filter the shared catalogue by subject as a second teacher.

## Security Considerations

**The one real risk is facet leakage through inheritance.** An activity is
publishable; a cited document may be a teacher's private upload. Deriving the
activity's facets from that document would expose its tags — a teacher's own
labels, which may be candid — to every teacher browsing the catalogue.

Rule: **in the shared catalogue (`published=true`) and the researcher view
(`scope=all`), inherit only from `owner_scope == SHARED_SCOPE` documents.** In
the owner's own library, inherit from everything the owner can see. This falls
out of resolving materials against *the caller's* visible set rather than the
*owner's*, which is also the simpler implementation — but it must be asserted by
a test, because the wrong version looks identical in single-teacher dev data.

No new write surface: `PATCH /api/activities/{id}` already gates on owner (or
researcher) via `_load_for_modify`. Tags and subject are length-validated free
text; level is a `Literal`.

## Performance Considerations

- Inheritance needs the cited docs. `_load_shared` is a process-global TTL cache
  (default 120s) plus one `ownerScope ==` query — the same two reads the
  Materials browse already does, and they can be shared within a request.
- Filtering and faceting are in-memory over a bounded set, as in 1.1.58/1.1.59.
  No Firestore composite index is added; `firestore.indexes.json` stays untouched.
- The shared catalogue is the one unbounded set (every published activity across
  all teachers). Pagination lands in the same change, so this reduces the wire
  payload relative to today.

## Success Criteria

- [ ] An activity citing a filed document is findable by that document's subject, level and tags with zero activity-level input.
- [ ] Re-filing a document re-files its activities; no backfill, no reconciliation job.
- [ ] Materials and Activities present one chip idiom from one component.
- [ ] `SUBJECTS` exists in exactly one place in the backend and zero places in the frontend.
- [ ] Saving from the builder cannot wipe facets set elsewhere, and a test says so.

## Open Questions

1. **Should `level` inherit at all?** A tutor activity citing an A-level document
   is not necessarily an A-level activity. Tags and subject inherit
   uncontroversially; level is the teacher's pedagogical judgement. *Proposal:
   inherit it, but rank teacher-set above inherited in display, and revisit if it
   proves noisy.*
2. **Do sims need this?** An activity with `artefactId` and no materials inherits
   nothing. A per-artefact default tag set (Boldkast → `mekanik`) is cheap and
   would cover the sim-only activities. Deferred — not required for the primary
   goal, and it introduces a fourth place metadata can live.
3. **Should the shared catalogue expose an owner facet?** Out of scope here;
   `ownerLabel` already ships on those rows.

## Related Documents

- [curriculum-faceted-browse.md](curriculum-faceted-browse.md) — 1.1.58/1.1.60, the vocabulary and facet semantics this reuses
- [curriculum-library.md](curriculum-library.md) — 1.1.25, `CurriculumDoc` + `MaterialRef`
- [curriculum-scale-performance.md](curriculum-scale-performance.md) — 1.1.59, the shared-corpus cache the inheritance pass leans on
- [copilot-curriculum-selection.md](copilot-curriculum-selection.md) — 1.1.52, `attach_material` and the `summary` field
- [activity-elements-palette.md](activity-elements-palette.md) — the full-overwrite POST footgun in its original context
