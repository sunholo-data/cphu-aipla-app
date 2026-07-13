# Sprint Plan: CURRICULUM-PERF — Scale the browse read path (1.1.59)

## Summary

Make the curriculum browse cost O(result page), not O(corpus), before a bulk
import of thousands of docs: a shared-corpus read-through cache, endpoint
pagination, and a debounced + paged frontend.

**Duration:** ~1.5–2 days
**Scope:** Fullstack
**Dependencies:** [1.1.58 tags](curriculum-faceted-browse.md) (shipped); the browse path
**Risk Level:** Low–Medium — process-global cache needs careful test isolation + ACL-safety proof
**Design Doc:** [curriculum-scale-performance.md](curriculum-scale-performance.md)

## Milestones

### M1: Shared-corpus read-through cache (backend)
**Goal:** shared browse issues 0 Firestore reads within TTL; own docs stay live; cache never holds private data.
**Tasks:**
- [ ] `_load_shared()` (TTL via `CURRICULUM_SHARED_CACHE_TTL_S`, default 120) + `invalidate_shared_cache()` in `db/curriculum.py`
- [ ] `list_curriculum_for_teacher` = cached-shared ∪ live-own, existing filters/sort unchanged, signature unchanged
- [ ] Invalidate on shared write: `create_curriculum_doc` (when `owner_scope==shared`) + delete route (shared doc)
- [ ] Autouse cache-reset fixture; tests: HIT=0-reads, MISS-repopulate, TTL-expiry (clock monkeypatch), invalidate-on-write, own-doc-fresh, private-doc-never-cached
**Acceptance:** two browses within TTL → one shared query; a shared ingest → next browse re-queries; teacher-2 private doc absent from teacher-1 view; `make lint && make test-fast` green.

### M2: Endpoint pagination (backend)
**Goal:** bounded response with honest `total`; internal callers unaffected.
**Tasks:**
- [ ] `limit` (default 50, `le=200`) + `offset` on `browse_curriculum`; slice; return `{docs,total,limit,offset}`
- [ ] Tests: window correctness, `total`, `limit>200`→422, default cap
**Acceptance:** co-pilot/summarize/query still get full lists (call the function, not the endpoint); paged endpoint verified.

### M3: Frontend debounce + load-more
**Goal:** one browse per settle; designed large-list UX.
**Tasks:**
- [ ] `browseCurriculum` → `{docs,total}` + `limit`/`offset`; update `MaterialsSection`
- [ ] 250ms debounce; offset reset on any filter/search change; "Showing X of Y" + Load more (append)
- [ ] Vitest: debounced single call; load-more appends + advances offset; count line
**Acceptance:** `npm run quality:check` green; rapid typing = one call.

## Day-by-Day

### Day 1
- **AM:** M1 cache + tests (the load-bearing, ACL-sensitive piece — TDD, prove 0-reads + no-private-leak).
- **PM:** M2 pagination + tests; commit each milestone.

### Day 2 (half)
- M3 FE debounce + load-more + vitest; `quality:check`; push dev; browser-verify snappy browse + single MISS in logs after a seed.

## Success Metrics
- Test-proven 0 shared reads/TTL; bounded page + `total`; debounced search.
- No migration, no seed. CI parity green (backend + FE).

## Notes / Decisions
- **Cache holds SHARED only** — the ACL-safety property. Own docs never cached (freshness + no cross-teacher leak).
- **Pagination at the endpoint, not the function** — the co-pilot (`authoring_tools.py:619`), summarize, and query depend on full lists.
- **No external search index / no server-side substring** — Firestore can't; content search is the RAG path (Non-Goal).
- TTL is an env escape hatch (`=0` disables → always live).
