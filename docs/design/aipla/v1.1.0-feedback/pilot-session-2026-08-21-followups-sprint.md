# Sprint Plan: PILOT-FIX-0821 — Pilot-session follow-ups

## Summary

Close the four defects found in the 2026-08-21 prod pilot-session logs, each with
the machine gate that would have caught it. Restores document upload (dead on prod
for everyone), gets student writing to the tutor, and revives the checklist
anti-fabrication guard.

**Duration:** ~2 days
**Scope:** Backend + infrastructure (one frontend-parity manifest)
**Dependencies:** None. **M1 and M2 must ship in ONE change window** — either alone leaves upload broken.
**Risk Level:** Medium — confined to M1's blank-id sweep across 75 call sites and M2's prod-only promote path.
**Design Doc:** [pilot-session-2026-08-21-followups.md](pilot-session-2026-08-21-followups.md) (1.1.79)

## Current Status Analysis

### Recent Velocity
- 72 commits / 275 files / +19,051 −1,360 over the last 14 days.
- Backend fast-test baseline: **3165 collected** (3 deselected).
- Capacity is not the constraint here; blast radius is. M1 and M2 touch shared infrastructure.

### Existing Implementation
- `resolve_documents_bucket` ([db/clients.py:37](../../../../backend/db/clients.py#L37)) — the A1 site. Its sibling guard already exists in [auth/permissions.py:102-109](../../../../backend/auth/permissions.py#L102-L109) and is the shape to copy.
- `db/firestore.py` — four unguarded helpers, **75 call sites** across the backend.
- `infrastructure/env/storage.tf` — `research_audio` is the exact pattern for M2's bucket (objectAdmin, `force_destroy = false`).
- `cloudbuild.yaml:294,323` — `RESEARCH_AUDIO_BUCKET` / `VOICE_TTS_CACHE_BUCKET` show the `--set-env-vars` shape.
- `cloudbuild.promote.yaml:203` — `--update-env-vars`. **This is the half that gets forgotten**; prod is reached only by promote.
- `_WORKSPACE_ELEMENT_SERVERS` ([iframe_context_routes.py:105](../../../../backend/protocols/iframe_context_routes.py#L105)) — M3's one-word fix, plus its parity gate.
- `_Ctx` ([test_checklist_tools.py:351](../../../../backend/tests/unit/test_checklist_tools.py#L351)) — a plain dict; M4 replaces it with the real ADK `State`.

## Proposed Milestones

### Milestone 1: A1 — empty-domain guard + blank-id hardening
**Scope:** backend
**Goal:** An anonymous-group student's upload stops 500ing, and blank Firestore ids become a test-time failure instead of a prod gRPC 400.
**Estimated:** ~35 impl + ~60 tests
**Duration:** 0.25d

**Tasks:**
- [ ] Guard the empty domain in `resolve_documents_bucket` — skip the lookup, fall to configured bucket (~8)
- [ ] Raise `ValueError` on blank `collection`/`doc_id` in `get_document`, `set_document`, `update_document`, `delete_document` (~25)
- [ ] Sweep: run the full backend suite; triage any other latent blank-id caller the guard surfaces (~0, may grow)
- [ ] Tests: empty-domain returns configured bucket with **no** Firestore call; each helper raises on blank (~60)

**Files to Create/Modify:**
- `backend/db/clients.py` (modify, ~8)
- `backend/db/firestore.py` (modify, ~25)
- `backend/tests/unit/test_clients.py` (modify, ~25)
- `backend/tests/unit/test_firestore_blank_ids.py` (new, ~35)

**Acceptance Criteria:**
- [ ] `resolve_documents_bucket(user with domain="")` returns the configured bucket and issues no Firestore call (asserted via mock)
- [ ] All four helpers raise `ValueError` naming the collection on a blank id
- [ ] Full backend suite green; any newly-surfaced blank-id caller is fixed or explicitly recorded

**Risks:**
- The `ValueError` may surface other latent blank-id callers among 75 sites — *this is the point*, but it can grow scope. Mitigation: full-suite run before M2 begins; if a caller is non-trivial, guard it locally and file rather than redesign in-sprint.

### Milestone 2: A2 — a real documents bucket on every environment
**Scope:** infrastructure
**Goal:** `DOCUMENTS_BUCKET` exists and is set on dev, test and prod; the upstream-project fallback is deleted.
**Estimated:** ~40 impl + ~15 tests
**Duration:** 0.5d

**Tasks:**
- [ ] `google_storage_bucket.documents` + `objectAdmin` for the runtime SA, mirroring `research_audio` (~20)
- [ ] `--set-env-vars=DOCUMENTS_BUCKET=${_PROJECT_ID}-documents` in `cloudbuild.yaml` (~2)
- [ ] Same value via `--update-env-vars` in `cloudbuild.promote.yaml` — **the twin, without which prod never gets it** (~2)
- [ ] Remove the hardcoded `"aitana-documents-bucket"` default; absent config fails loudly (~6)
- [ ] `make tf-plan ENV=test` and `ENV=prod` reviewed before any apply (~0)
- [ ] Test: `resolve_documents_bucket` raises/fails clearly when `DOCUMENTS_BUCKET` is unset (~15)

**Files to Create/Modify:**
- `infrastructure/env/storage.tf` (modify, ~20)
- `cloudbuild.yaml` (modify, ~2)
- `cloudbuild.promote.yaml` (modify, ~2)
- `backend/db/clients.py` (modify, ~6)
- `backend/tests/unit/test_clients.py` (modify, ~15)

**Acceptance Criteria:**
- [ ] `<project>-documents` exists in all three projects with the runtime SA granted
- [ ] `DOCUMENTS_BUCKET` present on the deployed dev service **and** on prod after a promote
- [ ] `aitana-documents-bucket` appears nowhere in the codebase
- [ ] `make check-cloudbuild` passes (no single-`$` substitution breakage)

**Risks:**
- Terraform on test/prod is the highest-blast-radius action in this sprint. Mitigation: plan-only first, apply via Cloud Build as `aipla-terraform@` per the runbook — never from the laptop; `scripts/tf.sh` binds prefix+tfvars from one argument.
- The promote twin cannot be verified until an actual promote. Mitigation: assert the var in the post-promote smoke rather than trusting the YAML.

### Milestone 3: B — register `writing`, then make registration provable
**Scope:** fullstack
**Goal:** Student writing reaches the tutor, and no future element can ship registered on one side only.
**Estimated:** ~45 impl + ~50 tests
**Duration:** 0.25d

**Tasks:**
- [ ] Add `"writing"` to `_WORKSPACE_ELEMENT_SERVERS` (~1)
- [ ] Committed element-server manifest both sides assert against (~20)
- [ ] Extend `scripts/audit-trust-cards.sh` to fail when a pushed serverId is absent from the backend allowlist (~25)
- [ ] Backend test: iframe-context accepts `serverId: "writing"` (extend the parametrised case) (~10)
- [ ] Parity test: every frontend element server id is in the allowlist (~25)
- [ ] Frontend test: `WorkbenchWriting` serverId cross-checked against the manifest (~15)

**Files to Create/Modify:**
- `backend/protocols/iframe_context_routes.py` (modify, ~1)
- `scripts/audit-trust-cards.sh` (modify, ~25)
- `backend/tests/api_tests/test_iframe_context_routes.py` (modify, ~35)
- `frontend/src/components/workspace/__tests__/` (modify, ~15)

**Acceptance Criteria:**
- [ ] `POST /api/sessions/{id}/iframe-context` with `serverId: "writing"` returns 204
- [ ] Parity test **fails** when an allowlist entry is temporarily removed (verify by doing it)
- [ ] `make audit-trust-cards` green

**Risks:**
- The manifest could drift into ceremony nobody updates. Mitigation: derive from the frontend source rather than hand-maintaining a third list.

### Milestone 4: C — `to_dict()`, and a test double that can fail
**Scope:** backend
**Goal:** The empty-element guard actually runs, and the suite exercises the type production uses.
**Estimated:** ~10 impl + ~30 tests
**Duration:** 0.25d

**Tasks:**
- [ ] `tool_context.state.to_dict()` in place of `dict(tool_context.state or {})`, preserving the `None`-context path (~6)
- [ ] Log the swallowed exception at `error` with a greppable message (still failing open) (~4)
- [ ] Re-back `_Ctx` with a real `google.adk.sessions.state.State` (~15)
- [ ] Confirm the whole existing checklist suite still passes against it (~15)

**Files to Create/Modify:**
- `backend/adk/checklist_tools.py` (modify, ~10)
- `backend/tests/unit/test_checklist_tools.py` (modify, ~30)

**Acceptance Criteria:**
- [ ] `test_done_on_an_empty_table_produces_no_mark` ("Aswin's exact case") passes with a **real** `State` — it is currently green only because the double is a dict
- [ ] Every pre-existing checklist test still passes; any that does not was relying on dict permissiveness and is fixed, not deleted
- [ ] Marking still succeeds when the check itself raises (fail-open preserved)

**Risks:**
- Low. Fail-open means a regression cannot block a mark.

### Milestone 5: D — absorb quota bursts
**Scope:** backend + ops
**Goal:** A 429 degrades to a retry and an honest message, not a dead turn.
**Estimated:** ~50 impl + ~40 tests
**Duration:** 0.5d

**Tasks:**
- [ ] Read the actual prod Gemini/Vertex quota and current headroom; record the number (~0)
- [ ] Bounded retry with jittered backoff on `_ResourceExhaustedError` (~30)
- [ ] Honest Danish "try again in a moment" when retries are exhausted (~20)
- [ ] Tests: retry succeeds on a transient 429; exhaustion surfaces the message, not a stall (~40)

**Acceptance Criteria:**
- [ ] A simulated 429 burst results in a completed turn
- [ ] Exhaustion produces a user-visible message, not a stalled stream
- [ ] The quota ceiling for the remaining pilot is written down, not assumed

**Risks:**
- The real fix may be a quota raise, which needs a Google-side conversation and is outside the sprint's control. Mitigation: backoff + honest degradation lands regardless and is useful on its own.

## Day-by-Day Breakdown

### Day 1
- **Focus:** The P0 — upload, end to end.
- **Tasks:** M1 (guard + hardening + sweep), then M2 (bucket, both cloudbuild halves, default removal). Deploy to dev; upload as a student **and** as a teacher.
- **Checkpoint:** A real file uploads on deployed dev from both surfaces; zero `InvalidArgument` in dev logs.

### Day 2
- **Focus:** The silent-failure pair, then quota.
- **Tasks:** M3 (allowlist + parity gate), M4 (`to_dict()` + real-`State` double), then M5.
- **Checkpoint:** Full backend suite + frontend `quality:check` green; `make audit-trust-cards` and `make check-cloudbuild` green; writing reaches the tutor on dev.

## Success Metrics

- Backend fast tests: **3165 → ~3200** (net new, none deleted).
- Frontend `npm run quality:check` green (CI parity, not the fast variant).
- `make audit-trust-cards`, `make check-cloudbuild`, `make check-brand-literals` green.
- Deployed-dev smoke: student upload, teacher upload, writing push all succeed.

## Quality Gates

Per CLAUDE.md's pre-push gotcha, the **CI-parity** commands, not the fast ones:

```bash
cd backend && make lint && make test-fast
cd frontend && npm run quality:check
make audit-trust-cards && make check-cloudbuild && make check-brand-literals
```

## Out of Scope

- Teacher sign-in / access register — working as designed; replacement route is its own workstream.
- The 4 teacher-side upload 500s with no backend traceback (design-doc Open Question 1). Investigate during M2; if it proves a fifth defect, file rather than absorb.
- Offline upload queueing.
