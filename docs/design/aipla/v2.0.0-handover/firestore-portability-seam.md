# firestore-portability-seam — keep the DB swap cheap, defer the swap

**Status**: Implemented (seam-hardening, 2026-06-17) — the Firestore→Postgres *migration itself* is deferred (eval + UCPH-hosting gated; see [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md)).
**Priority**: P2 — cheap insurance for the v2.0.0-handover self-host workstream; not on the pilot critical path.
**Estimated**: ~1d (delivered).
**Scope**: Backend — DAL contract + leak-closing + tests. No schema change, no provider change.
**Dependencies**: [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md) (§1b/§7 — this doc resolves the "is Firestore→Postgres hard?" question it raised), ADR-001 (anonymity), ADR-010/017 (pgvector is the on-prem RAG target).
**Created**: 2026-06-17
**Last Updated**: 2026-06-17

## Problem Statement

The [self-hosting resource list](self-hosting-and-terraform-handover.md) rated **Firestore → Postgres** the single "H" (hard) item of the UCPH on-prem migration. That rating came from an inventory summary, not the code. The question — *what is actually hard about our Firestore integration, and is it worth pivoting off it now?* — needed an evidence-based answer before it drove a costing estimate or a premature mid-pilot DB rewrite.

**Current State (before this doc):**
- Firestore→Postgres carried an unexamined "H" rating; the self-hosting doc's headline ("the one genuinely hard part") rested on it.
- Two modules reached past the data-access layer (DAL) with raw client calls — `channels/identity.py` and `buckets/folder_config.py`.
- `buckets/folder_config.py` used the top-level `client.document(path)` accessor, which the in-memory client does **not** implement — so bucket-folders crashed under `LOCAL_MODE` (a latent gap, never hit because folders aren't exercised locally).

**Impact:** the migration estimate (a handover deliverable) and the "pivot now vs later" decision both hinged on a number nobody had verified.

## Goals

**Primary Goal:** Determine the real Firestore-migration difficulty from the code, decide pivot-now-vs-later, and — without doing the migration — make the eventual swap as cheap as possible by hardening the abstraction seam.

**Success Metrics:**
- The "H" rating is re-judged against evidence (file:line), and the self-hosting doc corrected.
- 100% of backend data access goes through the `db/` DAL (zero raw-client leaks outside `db/`).
- The DAL surface is a typed contract a future Postgres adapter implements as a checklist.
- The `LOCAL_MODE` in-memory seam works for *every* collection surface (no latent crashes), proven by tests.

**Non-Goals:**
- Doing the Firestore→Postgres migration. It stays eval- and UCPH-hosting-gated (self-hosting doc "when to trigger").
- A formal data pump / dual-write program (only needed at actual cutover; pilot data is rebuildable).
- Touching the frontend's two teacher-only realtime hooks (separate, replaceable; tracked in the self-hosting doc).

## Axiom Alignment

Scored per [Product Axioms](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | No latency path change. |
| 2 | EARNED TRUST | 0 | No factual-claim surface. |
| 3 | SKILLS, NOT FEATURES | 0 | Invisible infra. |
| 4 | RIGHT MODEL, RIGHT MOMENT | 0 | n/a. |
| 5 | GRACEFUL DEGRADATION | +1 | Fixes a latent `LOCAL_MODE` crash (bucket-folders), so the in-memory fallback — the project's degraded/offline mode — actually works end-to-end. |
| 6 | PROTOCOL OVER CUSTOM | 0 | A Python `Protocol` isn't an open wire protocol; the lock-in-avoidance angle is real but not what this axiom measures. |
| 7 | API FIRST | 0 | API surface unchanged. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Removing raw scattered access makes `db/firestore.py` the single chokepoint for *all* data ops — one place to instrument, rather than tracing added "after the fact" per call site. |
| 9 | SECURE BY CONSTRUCTION | +1 | A typed boundary + zero leaks make "all data access goes through the DAL" an architectural guarantee, not a convention ("if it can be misconfigured, it will be"). Reduces the surface where unreviewed queries could bypass ACL helpers. |
| 10 | THIN CLIENT, FAT PROTOCOL | 0 | Backend-only. |
| 11 | USABLE BY DESIGN | 0 | No user surface. |
| | **Net Score** | **+3** | See axiom note. |

**Axiom note.** This is enabling-infra, not a product feature; the feature-oriented rubric under-scores "invisible plumbing." Its mandate is *inherited* from the parent [self-hosting workstream](self-hosting-and-terraform-handover.md) (net +5), whose eval-gated data-sovereignty goal (Axiom 9) this directly serves. No hard-fail rule is triggered (no -1s). Proceeding is appropriate despite the sub-+4 net.

## Findings — what's actually hard (verdict: M, not H)

Evidence from the code:

**The seam is already ~85% clean.**
- A single factory, [`db/firestore.py:get_client()`](../../../../backend/db/firestore.py), is the only client accessor. An in-memory drop-in ([`db/firestore_inmemory.py`](../../../../backend/db/firestore_inmemory.py)) runs the whole app under `LOCAL_MODE` and in tests — the swap-out seam is exercised daily.
- Per-collection modules under `db/` use the client surface; only **two** modules outside `db/` reached past the DAL (now closed — see Design).

**What we rely on (all standard relational/JSONB territory):**
- Document CRUD + filtered, ordered queries + cursor pagination (`db/chat_sessions.py`).
- A few atomic ops: `Increment` (counters), `ArrayUnion` (append to `documentIds`/`groupCodes`).
- `array_contains` and one dotted-path filter (`accessControl.type`).

**What we do NOT rely on (this is why it's M, not H):**
- **No transactions** — `db/firestore_inmemory.py` states "No transactions. v6 doesn't use them." The one place wanting atomicity (`classes.py` group-code minting) currently races last-writer-wins; Postgres would *improve* it.
- **No server-side realtime listeners, no collection-group queries, no Firestore TTL** (expiry is a manual `expires_at` check), **no reliance on security rules for backend auth** (the backend authorises independently; `firestore.rules` only gates the frontend client SDK).
- Chat history is **not** in Firestore — it lives in the ADK session service (Agent Engine); `chat_sessions` is a metadata mirror.

**Decision: defer the migration, harden the seam now.** Pivoting the DB now is depth (zero user-facing value) against the breadth-over-depth steer and the UX-coherence gate; the trigger is eval- and UCPH-hosting-gated and likely post-contract; and a mid-pilot DB swap risks the thing we put in front of teachers on 2026-08-14. The clean seam means the port can happen later behind the same interface without a rewrite — so the right move now is the ~1-day work that makes the *future* swap cheap. (The one scenario that flips this to "do it now": UCPH mandates full air-gap, topology D, before the pilot.)

## Design (what shipped)

### 1. The DAL contract — [`db/firestore_protocol.py`](../../../../backend/db/firestore_protocol.py)
A typed `Protocol` set pinning the exact duck-typed surface the backend uses: `FirestoreClient.collection()` → `CollectionReference` (`document`, `where`, `order_by`, `limit`, `start_after`, `stream`) → `DocumentReference` (`get/set/update/delete`) → `DocumentSnapshot` (`id/exists/to_dict`). Three implementations satisfy it: the real `google.cloud.firestore.Client`, the in-memory client, and a future `PostgresFirestoreClient`. [`get_client()`](../../../../backend/db/firestore.py) is now annotated `-> FirestoreClient`, so the Postgres adapter is a typed checklist and any `db/` code reaching for a Firestore-only feature (transactions, `on_snapshot`) stands out as non-portable.

### 2. Closed both DAL leaks
- [`channels/identity.py`](../../../../backend/channels/identity.py) — `channel_identities` is a flat collection; now uses `get_document`/`set_document`/`update_document`.
- [`buckets/folder_config.py`](../../../../backend/buckets/folder_config.py) — now routes through the DAL helpers with a subcollection *collection path* (`buckets/{id}/folders`) via `collection(path).document(id)`, dropping the top-level `client.document(path)` accessor. **This fixed a latent `LOCAL_MODE` crash** (the in-memory client has no top-level `.document()`). Production data location is unchanged: `collection("a/b/c").document("d")` is the same physical document as the old `document("a/b/c/d")`.

### 3. Tests
- [`tests/unit/test_firestore_protocol.py`](../../../../backend/tests/unit/test_firestore_protocol.py) — `runtime_checkable` conformance of the in-memory client; a guard that the google SDK still exposes the contract's method names.
- [`tests/unit/test_folder_config_local.py`](../../../../backend/tests/unit/test_folder_config_local.py) — bucket-folder CRUD round-trips under `LOCAL_MODE` (the regression for the crash; previously zero coverage).
- [`tests/channels/test_identity.py`](../../../../backend/tests/channels/test_identity.py) — rewritten from mock-call-pattern assertions to behaviour against the in-memory store.

## The future Postgres adapter (the deferred work, now a checklist)

When the migration triggers, implement `PostgresFirestoreClient` satisfying `FirestoreClient`. The non-trivial mappings (all mechanical, no redesign):

| Firestore feature | Postgres mapping |
|---|---|
| `Increment(n)` | `UPDATE … SET f = f + n` (row-locked) |
| `ArrayUnion(v)` | `array_append` / JSONB `\|\|` |
| dotted-path filter (`accessControl.type`) | JSONB `data->'accessControl'->>'type'` (+ JSONB path index) |
| `.start_after(snap)` cursor | keyset pagination (`WHERE sort_key < ? ORDER BY … LIMIT n`) |
| subcollection path (`buckets/{id}/folders`) | table with a `bucket_id` FK (or path-keyed row) |
| `array_contains` | `? = ANY(col)` / JSONB containment |

Target store is **Supabase / Postgres + pgvector** (self-hosting doc §1b). The in-memory client (`db/firestore_inmemory.py`) is the working reference for every behaviour the adapter must reproduce, including sentinel resolution and dotted-path filtering.

## Implementation Plan

- [x] Audit the real coupling + feature reliance (Findings).
- [x] `FirestoreClient` Protocol + typed `get_client()`.
- [x] Close the `channels/identity.py` leak.
- [x] Close the `buckets/folder_config.py` leak (+ fix the LOCAL_MODE crash).
- [x] Tests: conformance, folder_config LOCAL_MODE round-trip, rewritten identity behaviour tests.
- [x] `make lint` + `make test-fast` green (2033 passed).
- [x] Correct the self-hosting doc §1b/§7 (H→M) and cross-link.

## Migration & Rollout

No rollout — internal refactor, behaviour-preserving in production (data locations unchanged), proven by the existing API tests (`test_folders.py`, `test_buckets.py`) plus the new LOCAL_MODE round-trips. No env var, flag, or seed change.

## Testing Strategy

- Backend: the new + rewritten tests above; the full `make test-fast` suite (2033 passed) confirms no regression in the channels/bucket/folder surfaces that route through the changed modules.
- Future: the same in-memory test suites become the conformance suite the Postgres adapter must also pass (run the DAL tests against each backend).

## Success Criteria

- [x] Firestore→Postgres re-rated M (evidence-based), self-hosting doc corrected.
- [x] Zero raw-client access outside `db/` (both leaks closed).
- [x] DAL is a typed contract (`FirestoreClient` Protocol; `get_client()` annotated).
- [x] `LOCAL_MODE` works for bucket-folders (latent crash fixed, regression-tested).
- [x] Lint + fast suite green.

## Open Questions

1. Promote the DAL contract to a hard guardrail? A lint/CI check that forbids `firestore.Client`/`.collection(`/`.document(` outside `db/` would make "no new leaks" mechanical rather than reviewer-enforced. Deferred — low volume today.
2. Whether to ever pre-build the Postgres adapter speculatively. No — wait for the UCPH-hosting + eval trigger; the checklist above keeps it cheap whenever it lands.

## Related Documents

- [self-hosting-and-terraform-handover.md](self-hosting-and-terraform-handover.md) — parent workstream; §1b/§7 carry the corrected M rating and the "defer + harden" recommendation.
- [SEQUENCE.md](SEQUENCE.md) (this workstream) — Phase-1 portability-seam audit, partly delivered by this doc.
- Scoping site: [self-hosting.qmd](https://www.sunholo.com/aipla/self-hosting.html), ADR-010/017 (pgvector target).
