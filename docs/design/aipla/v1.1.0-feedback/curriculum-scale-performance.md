# Curriculum Library — Scale & Search Performance

**Status**: Implemented (SHIPPED 2026-07-13 — CURRICULUM-PERF M1–M3)
**Priority**: P1 (scale correctness — a large-corpus import is imminent)
**Estimated**: ~1.5–2 days (M1 cache ~0.75d · M2 pagination ~0.5d · M3 FE debounce+paging ~0.5d)
**Scope**: Fullstack (backend read path + endpoint; frontend browse)
**Dependencies**: [1.1.25 curriculum-library](curriculum-library.md); [1.1.58 curriculum-faceted-browse](curriculum-faceted-browse.md) (this hardens the same browse path; supersedes that doc's deferred M4 debounce)
**Created**: 2026-07-13
**Last Updated**: 2026-07-13
**Sequence**: 1.1.59

## Problem Statement

The teacher Materials browse ([`list_curriculum_for_teacher`](../../../../backend/db/curriculum.py#L65))
**fetches the entire ACL-scoped document set from Firestore, deserializes every
row into a Pydantic model, then filters and sorts in Python** — on every request,
with no `limit`. Cost scales with **total library size, not result size**. Today
the corpus is O(hundreds) so this is invisible; **a bulk import of thousands of
cleared documents is imminent**, which changes the picture:

**Current State (verified 2026-07-13):**
- Each browse issues `query_documents(ownerScope == "shared")` + `query_documents(ownerScope == teacher_uid)` with **no `limit`, no other `where`** ([curriculum.py:78-82](../../../../backend/db/curriculum.py#L78)). Firestore bills **one read per doc returned** — so a browse over a 3,000-doc shared corpus is ~3,000 reads.
- Every doc is `CurriculumDoc.model_validate(d)`'d per request, then string-scanned for the free-text `q`.
- The **shared corpus is re-fetched and re-deserialized identically for every teacher, every browse** — it is read-mostly (changes only on admin ingest/delete) and the same for everyone, yet nothing is reused.
- The endpoint returns the **full result set, unbounded** — a large payload over the wire and into React.
- The search input fires **per keystroke** with no debounce ([MaterialsSection.tsx](../../../../frontend/src/components/teacher/MaterialsSection.tsx#L58)) → reads × keystrokes.

**Impact:**
- **Who:** every teacher browsing Materials; the authoring co-pilot's `attach_material` (same read path, [authoring_tools.py:619](../../../../backend/adk/authoring_tools.py#L619)).
- **How significant:** at thousands of docs this is latency (fetch + deserialize all) **and** recurring Firestore read-cost = docs × keystrokes × teachers × sessions. A correctness-of-scale issue, not cosmetic — best fixed **before** the import, not after it degrades the pilot.

## Goals

**Primary Goal:** Make a browse cost **O(result page), not O(corpus)** — a browse over a 3,000-doc corpus should issue ~zero steady-state Firestore reads for the shared set and return a bounded page, with sub-100ms server time.

**Success Metrics:**
- Steady-state browse of the shared corpus issues **0 Firestore reads** within the cache TTL (down from N).
- Browse response is **bounded** (default 50, cap 200) with an honest `total`.
- Search fires **once per settle**, not per keystroke.
- No behavioural change for internal full-list callers (co-pilot, summarize, query).

**Non-Goals:**
- **External search index** (Typesense / Algolia / Elastic). Unnecessary at thousands; free-text over *content* is deliberately the RAG path, and an external index crosses the GCP trust boundary (Axiom 9). Revisit only at tens-of-thousands of metadata rows.
- **Server-side substring search.** Firestore has no `contains`/full-text operator — a substring `q` pass over an in-memory candidate set is unavoidable; the fix is to stop *re-reading + re-deserializing* that set, not to eliminate the scan.
- **Caching a teacher's own docs.** They are few and must reflect a just-completed upload immediately — freshness beats the marginal read saving.
- Moving `topic`/tag search to Firestore. Kept in-memory over the (now-cached) candidate set.

## Axiom Alignment

Score each axiom per [Product Axioms](../../../../docs/product-axioms.md). Net score must be >= +4.

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | +1 | Removes the per-request full-corpus read+deserialize; adds search debounce. Directly lowers browse latency at scale. |
| 2 | EARNED TRUST | 0 | No factual-claim surface; provenance/citation unchanged. |
| 3 | SKILLS, NOT FEATURES | 0 | Internal read-path infra. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | Zero-LLM path; unaffected. |
| 5 | GRACEFUL DEGRADATION | +1 | Cache miss / disabled cache falls back to the live query (identical result); staleness bounded by a short TTL over a read-mostly admin corpus. |
| 6 | PROTOCOL OVER CUSTOM | 0 | In-process memoization + standard pagination params; no protocol boundary. |
| 7 | API FIRST | +1 | Pagination is query params on the single `GET /api/curriculum`; CLI + co-pilot share the contract (internal callers still get full lists). |
| 8 | OBSERVABLE BY DEFAULT | +1 | Logs cache hit/miss, corpus size, and page bounds — the signals to reason about read-cost in production. |
| 9 | SECURE BY CONSTRUCTION | +1 | The cache holds **only `ownerScope == "shared"`** docs; a teacher's private docs are fetched live and unioned per-request, so the shared cache can **never** contain or leak private data. ACL is still applied on every request. |
| 10 | THIN CLIENT, FAT PROTOCOL | +1 | Pagination + filtering stay server-side; the frontend renders bounded pages and a "load more". No client-side corpus handling. |
| 11 | USABLE BY DESIGN | +1 | Large-list handling is designed: "Showing X of Y", a load-more affordance, and a debounced search — never an unbounded dump or a frozen input. |
| | **Net Score** | **+7** | Threshold: >= +4 |

**Conflict Justifications:** None (no axiom scored -1).

## Design

### Overview

Three changes to the same browse path: (1) a **read-through, TTL-bounded,
invalidate-on-write in-process cache for the SHARED corpus only** — the part that
grows to thousands and is identical + read-mostly across teachers; (2)
**pagination at the endpoint**, leaving the internal full-list function intact for
the co-pilot/summarize/query callers; (3) **frontend debounce + "load more"**.

### 5b-ter — Framework-native capability check

- **Firestore native:** supports `where` (used for ACL + level pushdown), `limit`,
  `array_contains` (tags), `order_by`. It does **not** support substring/full-text
  search — verified against the client already in use ([firestore.py:83](../../../../backend/db/firestore.py#L83)).
  So the `q` scan must run in-memory; the only question is how often we re-read the
  data behind it. Answer: cache it.
- **ADK sessions/artifacts:** not applicable — this is a Firestore metadata
  collection, not session/artifact state.
- **Conclusion:** the one piece of custom plumbing is an **in-process memo of the
  shared set**. That is standard read-through caching, not a new store or protocol.
  Justified because the alternative (re-reading N docs per browse) is the whole
  problem, and no framework layer memoizes a Firestore query for us.

### Backend — shared-corpus read-through cache

[`backend/db/curriculum.py`](../../../../backend/db/curriculum.py):

```python
# Module-level, per-process. Holds ONLY ownerScope == "shared" — never private
# docs — so it can never leak across teachers (see Axiom 9). Read-mostly admin
# corpus → a short TTL bounds cross-instance staleness; explicit invalidation on
# any shared write makes the same-instance window ~0.
_SHARED_TTL_S = float(os.getenv("CURRICULUM_SHARED_CACHE_TTL_S", "120"))
_shared_cache: dict = {"docs": None, "expires": 0.0}  # docs: list[CurriculumDoc] | None

def _load_shared() -> list[CurriculumDoc]:
    now = time.monotonic()
    if _shared_cache["docs"] is not None and now < _shared_cache["expires"]:
        return _shared_cache["docs"]                       # HIT — 0 Firestore reads
    raw = query_documents(_COLLECTION, filters=[("ownerScope", "==", SHARED_SCOPE)])
    docs = [CurriculumDoc.model_validate(d) for d in raw]
    _shared_cache.update(docs=docs, expires=now + _SHARED_TTL_S)
    logger.info("curriculum shared cache MISS: %d docs cached (ttl=%ss)", len(docs), _SHARED_TTL_S)
    return docs

def invalidate_shared_cache() -> None:
    _shared_cache.update(docs=None, expires=0.0)
```

`list_curriculum_for_teacher` composes the cached shared set with a **live** query
for the teacher's own docs (few; freshness matters), then applies the existing
in-memory `level` / `tags` / `q` filters + sort. Signature and return type
unchanged (full filtered list) so co-pilot/summarize/query are untouched.

```python
raw_own = query_documents(_COLLECTION, filters=[("ownerScope", "==", teacher_uid)]) if scope in (None, "mine") else []
shared = _load_shared() if scope in (None, "shared") else []
docs = [*shared, *(CurriculumDoc.model_validate(d) for d in raw_own)]
# ... existing level/tags/q filter + sort ...
```

**Invalidation** — call `invalidate_shared_cache()` wherever a SHARED doc is
written or removed: `create_curriculum_doc(doc)` invalidates when
`doc.owner_scope == SHARED_SCOPE` (covers ingest, PATCH-tags, summarize-update on
shared docs); the delete route invalidates when it removed a shared doc. A
teacher's own-doc writes never touch the cache (own docs aren't cached).

*(Optional micro-opt, deferred: precompute a lowercased search-blob per shared doc
at cache-load so the per-request `q` scan is pure `in` checks. Only if profiling
shows the re-lowercase matters at the real corpus size — a few ms at thousands.)*

### Backend — pagination at the endpoint

[`browse_curriculum`](../../../../backend/protocols/curriculum_routes.py#L83) gains
`limit` (default 50, `le=200`) and `offset` (default 0). It calls the unchanged
`list_curriculum_for_teacher` (full sorted list), then slices:

```python
all_docs = list_curriculum_for_teacher(user.uid, level=level, topic=topic, tags=tags, scope=scope)
page = all_docs[offset : offset + limit]
return {"docs": [d.model_dump(...) for d in page], "total": len(all_docs), "limit": limit, "offset": offset}
```

`total` lets the FE show "X of Y" honestly. Internal callers (co-pilot, summarize,
query) keep calling the function directly and still get the full list — pagination
is an HTTP concern only.

### Frontend — debounce + load-more

[`curriculumApi.ts`](../../../../frontend/src/lib/curriculumApi.ts): `browseCurriculum`
gains `limit`/`offset` and returns `{ docs, total }` (callers updated).
[`MaterialsSection.tsx`](../../../../frontend/src/components/teacher/MaterialsSection.tsx):
- **Debounce** the search input at 250ms (supersedes 1.1.58 M4's deferred debounce).
- Track `offset`; **reset to 0** whenever level/tags/search change.
- Render **"Showing {docs.length} of {total}"** and a **Load more** button that
  fetches the next page and **appends** (not replaces) — designed large-list state,
  never an unbounded dump.

### API Changes

| Method | Endpoint | Description | Breaking? |
|--------|----------|-------------|-----------|
| GET | /api/curriculum | + `limit` (≤200, default 50) + `offset`; response adds `total`/`limit`/`offset` (`docs` unchanged) | No (additive) |

### Architecture Diagram

```
GET /api/curriculum  ──▶ list_curriculum_for_teacher (full sorted list)
                              │
              shared ◀── _load_shared()  ──HIT──▶ in-proc cache (0 reads)
                              │           ──MISS─▶ Firestore where(ownerScope==shared) [1×/TTL]
              own    ◀── Firestore where(ownerScope==uid)  [live, few docs]
                              │
                     in-memory filter (level/tags/q) + sort
                              ▼
        endpoint slices [offset:offset+limit]  ──▶ {docs, total, limit, offset}

  shared ingest / delete / tag-edit ──▶ invalidate_shared_cache()
```

## Implementation Plan

### M1 — Shared-corpus cache (~0.75d)
- [ ] `_load_shared` + `invalidate_shared_cache` + TTL env in `db/curriculum.py` (~40 LOC)
- [ ] `list_curriculum_for_teacher` composes cached-shared + live-own (~15 LOC delta)
- [ ] Invalidate on shared write: `create_curriculum_doc` (scope-aware) + delete route (~10 LOC)
- [ ] Tests: HIT issues 0 reads (call-count fake), MISS repopulates, TTL expiry, invalidate-on-shared-write, own-docs always live/fresh, cache holds no private docs (~120 LOC) + an autouse cache-reset fixture

### M2 — Pagination (~0.5d)
- [ ] `limit`/`offset` params + sliced response + `total` on `browse_curriculum` (~25 LOC)
- [ ] Tests: default cap, offset window, `total` correctness, cap enforcement (422 over 200) (~50 LOC)

### M3 — Frontend debounce + load-more (~0.5d)
- [ ] `browseCurriculum` returns `{docs,total}` + `limit`/`offset`; update `MaterialsSection` (~40 LOC)
- [ ] 250ms debounce; offset reset on filter change; "Showing X of Y" + Load more append (~90 LOC)
- [ ] Vitest: debounce coalesces keystrokes into one call; load-more appends + advances offset; count line renders (~90 LOC)

## Migration & Rollout

**Database Migrations:** None. Pure read-path + endpoint change.
**Feature Flags:** `CURRICULUM_SHARED_CACHE_TTL_S` (default 120). Set `0` to
effectively disable the cache (always-miss → live query) as an escape hatch.
**Rollback Plan:** Revert the milestone commit; cache is inert if the module
globals are removed. No data touched.
**Environment Variables:** `CURRICULUM_SHARED_CACHE_TTL_S` (optional; default 120).
Record in the side-effects notes per project rule (it's config, not GCP infra).

## Testing Strategy

### Backend (pytest)
- [ ] Two browses within TTL → `query_documents(shared)` called **once** (call-count fake)
- [ ] `invalidate_shared_cache()` (and a shared write) forces a re-query
- [ ] TTL expiry re-queries (monkeypatch the clock)
- [ ] Own-doc upload is visible on the very next browse (own docs not cached)
- [ ] Cache never contains a non-shared doc (private doc from teacher-2 absent from another teacher's shared view)
- [ ] Pagination: `total` correct, `offset`/`limit` window correct, `limit>200` → 422
- [ ] Autouse fixture resets the cache between tests (isolation)

### Frontend (Vitest)
- [ ] Rapid typing triggers a single browse (debounced)
- [ ] "Load more" fetches offset=limit and appends
- [ ] Changing a filter resets offset to 0
- [ ] "Showing X of Y" reflects `total`

### Manual / Browser
- [ ] After a large seed, browse is snappy; server logs show a single shared-cache MISS then HITs
- [ ] A freshly uploaded own-doc appears immediately

## Security Considerations

- **The cache is scoped to `ownerScope == "shared"` by construction** — it is
  populated by exactly one query filtered to the shared sentinel, so it cannot hold
  a teacher's private upload. Private docs are read live per-request and unioned
  after. This is the property that makes a *process-global* cache safe in a
  multi-teacher service (Axiom 9). A test asserts a teacher-2 private doc never
  appears via the cache path.
- ACL is unchanged and still applied on every request (teacher-only endpoint; 403
  for group/student).
- Staleness is bounded by TTL and is benign: a teacher may not see a just-added
  *shared* doc for ≤ TTL seconds on a cold instance — acceptable for an admin,
  read-mostly corpus, and the same-instance write path invalidates immediately.

## Performance Considerations

- Post-change, a shared browse is **O(1) Firestore reads per TTL per instance**
  instead of O(corpus) per request. In-memory filter over a few-thousand cached
  objects is single-digit ms.
- Pagination bounds the response payload and React render regardless of corpus size.
- Per Cloud Run instance the cache warms independently; at low instance counts the
  aggregate read reduction is ~(requests − 1)/requests of the shared reads.
- **Next threshold (documented, not built):** at tens-of-thousands of shared docs,
  the in-memory `q` scan and the per-instance memory footprint warrant moving to a
  real search index; that is the point to reconsider the Non-Goal, and it should
  `log()` when the cached corpus crosses a size worth alerting on.

## Success Criteria

- [ ] Steady-state shared browse issues 0 Firestore reads within TTL (test-proven via call count)
- [ ] Browse response bounded (default 50 / cap 200) with correct `total`
- [ ] Search debounced to one call per settle
- [ ] Co-pilot `attach_material`, summarize, and query still receive full lists (unbroken)
- [ ] Backend + FE CI parity green; no migration, no seed

## Open Questions

- **TTL value:** 120s proposed. Shorter (30s) tightens staleness at the cost of more
  cold-miss reads; longer (300s) cheaper but staler. 120s is a reasonable default
  for an admin corpus; tune from production logs. (Recommend 120s.)
- **Precompute search-blob at cache-load?** Deferred — measure at the real corpus
  size first; it's a pure speed micro-opt, not correctness.

## Related Documents

- [1.1.58 curriculum-faceted-browse](curriculum-faceted-browse.md) — the browse this hardens; its deferred M4 debounce is absorbed here
- [1.1.25 curriculum-library](curriculum-library.md) — the base library + read path
- [reference: curriculum RAG store] — content search is the RAG path, deliberately separate (ADR-010/017)
