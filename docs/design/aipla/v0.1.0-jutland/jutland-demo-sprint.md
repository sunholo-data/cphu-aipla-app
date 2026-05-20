# Sprint Plan: JUTLAND-V01 — AIPLA v0.1 Jutland Demo

## Summary
Ship AIPLA's first deployed URL on `aipla-dev-2026` running the `problem-set-hints` physics-tutor skill, end-to-end smoke-passing, in time for JB + Aswin's Jutland teacher visit on **Wed 2026-05-27**. Target: **EOD 2026-05-20** for v0.1 ready; buffer week 2026-05-21 → 26 for AR-led prompt iteration.

**Duration:** 1 day (M0 sequential, M1+M2+M3 parallel, M4 + M5 sequential)
**Scope:** Fullstack + infra
**Dependencies:** `aipla-dev-2026` GCP project exists (confirmed 2026-05-18 — owner `m@sunholo.com`); voight-kampff push verified; upstream template features (group-ID auth, budget enforcer, tenant-span OTel hook) all already in this fork.
**Risk Level:** Medium — single hardest deadline of the contract, but the scope is well-understood and the template absorbs the heavy lifting.
**Design Doc:** [jutland-demo.md](jutland-demo.md)

## Current Status Analysis

### Recent Velocity
- Repo is one day old (forked 2026-05-19). 3 commits, all docs:
  - `160c9fe` Initial commit (template fork)
  - `722e35c` Bootstrap AIPLA design system + Jutland v0.1 design doc
  - `d32df0d` Switch v0.1 default model to gemini-3.5-flash on Vertex AI global
- No velocity baseline yet — estimates below come from the design doc's LOC budgets, not from observed throughput.

### Existing Implementation (inherited from template)
What we don't need to build:
- **Group-ID auth (ADR-001):** [backend/auth/group_id_auth.py](../../../../backend/auth/group_id_auth.py), [group_routes.py](../../../../backend/auth/group_routes.py), [group_rate_limit.py](../../../../backend/auth/group_rate_limit.py)
- **Frontend group-ID join:** [frontend/src/app/group/page.tsx](../../../../frontend/src/app/group/page.tsx), [AnonymousGroupAuthProvider.tsx](../../../../frontend/src/contexts/AnonymousGroupAuthProvider.tsx) (has tests already)
- **BudgetEnforcer Protocol (ADR-014):** [backend/budget/enforcer.py](../../../../backend/budget/enforcer.py), [in_memory_enforcer.py](../../../../backend/budget/in_memory_enforcer.py), [callback.py](../../../../backend/budget/callback.py)
- **Tenant-span OTel hook:** landed upstream 2026-05-19 per [timeline.qmd](file:///Users/mark/Documents/clients/cph-uni/timeline.qmd) — group_id will stamp on every model-call span automatically.
- **ADK skill-loading + AG-UI streaming + multi-provider router:** all generic in the template.
- **Cloud Build pipeline:** [cloudbuild.yaml](../../../../cloudbuild.yaml) with Terraform-managed substitutions — needs AIPLA project-ID substitution but no logic change.

What does not exist:
- Any `problem-set-hints` or other physics skill in [backend/skills/templates/](../../../../backend/skills/templates/) (7 generic templates exist).
- AIPLA branding (still says "Aitana Platform v6" in [frontend/src/lib/branding.ts](../../../../frontend/src/lib/branding.ts)).
- AIPLA-specific deploy config on `aipla-dev-2026` (project exists; Cloud Build trigger, secrets, region pinning all need M0).
- `aipla smoke jutland` CLI command.

## Proposed Milestones

### M0: Cloud bootstrap (`aipla-dev-2026`)
**Scope:** infra
**Goal:** AIPLA dev GCP environment ready to receive Cloud Build deploys, with Vertex AI `gemini-3.5-flash` callable from a Cloud Run service via ADC.
**Estimated:** ~150 LOC bootstrap script + ~30 LOC verification = ~180 LOC
**Duration:** 3–4 hours (sequential, blocks M5)

**Tasks:**
- [ ] Create `scripts/bootstrap-aipla-dev.sh` — idempotent gcloud + firebase commands (~120 LOC)
- [ ] Enable APIs (Firebase, Vertex AI, Cloud Run, Cloud Build, Artifact Registry, Firestore, Secret Manager, Cloud Trace, Cloud Logging) (~15 LOC)
- [ ] Pin region `europe-north1` on Cloud Run + Artifact Registry; Firestore on Finland multi-region (~10 LOC)
- [ ] **Configure Vertex AI Data Residency policy** to pin `global`-endpoint to EU storage + processing (per Resolved Decision 1) (~5 LOC)
- [ ] Create `aipla-v6@aipla-dev-2026.iam.gserviceaccount.com` with Cloud Run Invoker, Firestore User, Vertex AI User, Secret Accessor role bindings (~15 LOC)
- [ ] Firebase project init; enable anonymous auth (~10 LOC)
- [ ] Cloud Build connection to `sunholo-data/cphu-aipla-app` repo, trigger on `dev` push (~10 LOC)
- [ ] Secret seeded: Firebase admin SA JSON only (no Anthropic key per Resolved Decision 1)
- [ ] Verify: `bash scripts/bootstrap-aipla-dev.sh` is rerunnable without error
- [ ] Smoke: trigger one Cloud Build, verify it deploys and `/health` returns 200

**Files to Create/Modify:**
- `scripts/bootstrap-aipla-dev.sh` (new, ~150 LOC)
- `cloudbuild.yaml` (modify substitutions: project ID, service name, region; no logic change, ~5 LOC delta)
- `.env.example` (modify: AIPLA_REGION, GOOGLE_CLOUD_PROJECT, drop ANTHROPIC_API_KEY, ~10 LOC delta)

**Acceptance Criteria:**
- [ ] `scripts/bootstrap-aipla-dev.sh` exits 0 on first run AND second run (idempotent)
- [ ] `gcloud asset search-all-resources --project=aipla-dev-2026 --asset-types=run.googleapis.com/Service` lists at least one Cloud Run service
- [ ] One Cloud Build run completes green; deployed URL `/health` returns 200
- [ ] `gcloud iam service-accounts describe aipla-v6@aipla-dev-2026.iam.gserviceaccount.com` succeeds
- [ ] Vertex AI Data Residency policy visible in `gcloud asset search-all-resources --asset-types=aiplatform.googleapis.com/Policy`
- [ ] No ANTHROPIC_API_KEY referenced anywhere in deploy config (grep test)

**Risks:**
- GCP org policy may block service-account creation or region pinning. Mitigation: `m@sunholo.com` is owner; can override.
- Vertex AI Data Residency policy syntax not yet verified against current API. Mitigation: probe at start of M0; if blocking, ship v0.1 on the `global` endpoint without the policy and document as a known gap in the security section (does not change Jutland-demo viability since no student PII is collectable).
- Cloud Build connection (`github-voight`) inherited from template assumes a specific Cloud Build GitHub App install. Mitigation: install fresh on `sunholo-data/cphu-aipla-app` at start of M0 if needed.

---

### M1: `problem-set-hints` skill template (parallel A — independent)
**Scope:** backend
**Goal:** ADK-loadable physics-tutor skill with Danish stx system prompt, seeded problem set, scaffold rubric. No tools, no RAG.
**Estimated:** ~120 LOC content (prompt + rubric + seed problem) + ~30 LOC test = ~150 LOC
**Duration:** 2–3 hours

**Tasks:**
- [ ] Create `backend/skills/templates/problem-set-hints/SKILL.md` — Agent Skills spec; `model: gemini-3.5-flash`; `provider: vertex-ai`; `location: global` (~50 LOC)
- [ ] Write `resources/seed-problem.md` — AR's projectile-motion problem in Danish (per Open Question 1 fallback) (~40 LOC)
- [ ] Write `resources/scaffold-rubric.md` — the 5 markers internal to the system prompt (~30 LOC)
- [ ] Write `backend/tests/unit/skills/test_problem_set_hints.py` — assert `load_skill_from_dir()` succeeds; assert resulting `LlmAgent` has expected model + system-prompt fragment + scaffolding rubric reference (~30 LOC)

**Files to Create/Modify:**
- `backend/skills/templates/problem-set-hints/SKILL.md` (new)
- `backend/skills/templates/problem-set-hints/resources/seed-problem.md` (new)
- `backend/skills/templates/problem-set-hints/resources/scaffold-rubric.md` (new)
- `backend/tests/unit/skills/test_problem_set_hints.py` (new)

**Acceptance Criteria:**
- [ ] `cd backend && uv run pytest tests/unit/skills/test_problem_set_hints.py -v` passes
- [ ] Skill instantiates as a `google.adk.agents.LlmAgent` via `load_skill_from_dir()`
- [ ] System prompt embeds all 5 scaffolding principles from the design doc (Backend Changes section)
- [ ] Danish projectile-motion problem is the seeded content
- [ ] Manual: ask the loaded agent "what's the answer?" in unit test fixtures → response does NOT contain "= [number]" markers

**Risks:**
- ADK skill-loading API may have changed between template's pinned ADK version and current. Mitigation: check via `mcp__adk-mcp__search_code` if `load_skill_from_dir` errors.
- System prompt may not actually prevent full-solution leakage from `gemini-3.5-flash` even with explicit instructions. Mitigation: M4 smoke test catches this; buffer week is for iteration.

---

### M2: AIPLA branding + region pin (parallel B — independent)
**Scope:** frontend + infra config
**Goal:** Strip Aitana branding; AIPLA name/logo/copy; Danish copy on group-ID landing; deploy config substituted for AIPLA.
**Estimated:** ~80 LOC frontend + ~40 LOC config + ~30 LOC test = ~150 LOC
**Duration:** 2 hours

**Tasks:**
- [ ] Edit `frontend/src/lib/branding.ts` — AIPLA strings (app name, page title, welcome) (~30 LOC delta)
- [ ] Add Danish copy on `frontend/src/app/group/page.tsx` (alongside English) (~20 LOC delta)
- [ ] Single-skill landing: hide marketplace shelf on `frontend/src/app/page.tsx` (or equivalent), route group-join → `problem-set-hints` directly (~30 LOC delta)
- [ ] AIPLA wordmark — plain text wordmark per Open Question 2 fallback (`frontend/public/favicon.ico` regen optional) (~0 LOC)
- [ ] Region pin in [cloudbuild.yaml](../../../../cloudbuild.yaml) substitutions for europe-north1 (~5 LOC delta, ties into M0)
- [ ] Vitest: `frontend/src/app/group/__tests__/page.test.tsx` — assert Danish + English copy both render (~30 LOC)

**Files to Create/Modify:**
- `frontend/src/lib/branding.ts` (modify)
- `frontend/src/app/group/page.tsx` (modify)
- `frontend/src/app/page.tsx` (or marketplace landing — modify)
- `frontend/src/app/group/__tests__/page.test.tsx` (modify — add Danish-copy assertion)
- `cloudbuild.yaml` (modify substitutions only)

**Acceptance Criteria:**
- [ ] `cd frontend && npm run quality:check:fast` passes (lint + typecheck)
- [ ] `cd frontend && npm run test:run -- group/__tests__/page.test.tsx` passes
- [ ] grep test: zero remaining "Aitana" or "aitana-multivac" or "Aitana-Labs" strings in frontend src or cloudbuild.yaml (case-insensitive, excluding inherited comments and tests that target the inheritance)
- [ ] Manual: localhost frontend shows "AIPLA" branding and Danish group-ID prompt

**Risks:**
- The `frontend/src/lib/branding.ts` file may not be the single source of truth — some strings may be hard-coded in components. Mitigation: M2 starts with `grep -ri "Aitana" frontend/src/` to inventory; budget extra ~30 LOC if needed.

---

### M3: Group-ID + seed-corpus glue (parallel C — depends on M1 SKILL.md path)
**Scope:** fullstack
**Goal:** LOCAL_MODE has `problem-set-hints` seeded so JB's laptop fallback works; one test group ID minted for demo use; demo walkthrough script committed.
**Estimated:** ~60 LOC seed + ~20 LOC docs = ~80 LOC
**Duration:** 1–2 hours

**Tasks:**
- [ ] Verify `LOCAL_MODE` skill loader includes `problem-set-hints` (template's seed_skills.py or equivalent) (~30 LOC if changes needed; possibly zero LOC if skill-template-dir is auto-scanned)
- [ ] Mint test group ID `grp-jutland-test-1` via `aipla group new --class jutland-pilot` (verify the existing CLI command works; if not, ~30 LOC to wire it) (~0–30 LOC)
- [ ] Write `frontend/public/demo-walkthrough.md` — one-page script JB reads off during the teacher visit (~20 LOC)

**Files to Create/Modify:**
- `backend/scripts/seed_skills.py` (modify — may auto-detect new templates, in which case zero LOC)
- `frontend/public/demo-walkthrough.md` (new)

**Acceptance Criteria:**
- [ ] `LOCAL_MODE=1 make dev` followed by browsing to localhost shows `problem-set-hints` as the only available skill
- [ ] Group ID `grp-jutland-test-1` validates server-side
- [ ] Demo walkthrough script committed and readable

**Risks:**
- The template's LOCAL_MODE skill seeder may have a hard-coded skill list. Mitigation: scan `backend/scripts/seed_skills.py` at start of M3; if hard-coded, add `problem-set-hints` (single-line edit). If dynamic, no change needed.

---

### M4: Smoke test (`aipla smoke jutland`) (depends M1 + M3)
**Scope:** backend + CLI
**Goal:** One-shot end-to-end smoke command that exercises the v0.1 golden path and fails loud if scaffolding behaviour regresses.
**Estimated:** ~70 LOC command + ~30 LOC test = ~100 LOC
**Duration:** 1–2 hours

**Tasks:**
- [ ] Implement `aipla smoke jutland [--url <url>] [--group-id <id>]` in `cli/aipla/commands/smoke.py` (new or extend existing) (~60 LOC)
- [ ] Smoke asserts:
  - AG-UI first event lands within 3s (relaxed from <1.5s because of thinking-token overhead per design doc Performance section)
  - Response contains ≥3 of the 5 scaffold markers from `scaffold-rubric.md`
  - Response does NOT contain regex `(?i)(svaret er|the answer is|= \d+\s*m)` (Danish + English full-solution markers)
- [ ] Add `scripts/smoke-jutland.sh` wrapper for shell use (~10 LOC)
- [ ] Run against `LOCAL_MODE` (passes before M5)

**Files to Create/Modify:**
- `cli/aipla/commands/smoke.py` (new or modified)
- `scripts/smoke-jutland.sh` (new)
- `cli/tests/test_smoke_jutland.py` (new — mock the backend response, verify smoke logic)

**Acceptance Criteria:**
- [ ] `aipla smoke jutland --url http://localhost:3000` exits 0 against LOCAL_MODE
- [ ] Smoke detects scaffolding-rubric failure (verified by feeding a hand-crafted "the answer is 11.5m" response and confirming smoke exits 1)
- [ ] Unit test of the smoke logic passes

**Risks:**
- The Gemini 3.5 Flash thinking mode may make TTFT consistently exceed 3s in v0.1. Mitigation: smoke threshold is 3s (not 1.5s); if even 3s fails, M4 falls back to `thinkingBudget: 0` per the rollback plan.

---

### M5: Deploy + verify (depends all)
**Scope:** infra
**Goal:** Deployed URL on `aipla-dev-2026` passing `aipla smoke jutland` externally and reachable from outside UCPH WiFi.
**Estimated:** n/a (config push)
**Duration:** 1 hour

**Tasks:**
- [ ] Push to `dev` → Cloud Build triggers → Cloud Run deploys
- [ ] Get deployed URL from Cloud Build output; record in `.dev-logs/jutland-deployed-url.txt` (gitignored)
- [ ] Run `aipla smoke jutland --url $DEPLOYED_URL` from M's laptop → green
- [ ] Verify from a phone or second device that's not on UCPH WiFi
- [ ] Share URL with JB via the scoping-site `notes/` (NOT committed to this repo)
- [ ] Manual: incognito browser → enter `grp-jutland-test-1` → ask "Hjælp med opgave 1" → verify scaffolding response

**Acceptance Criteria:**
- [ ] Cloud Build for the latest dev commit is green
- [ ] Deployed URL responds 200 on `/health`
- [ ] `aipla smoke jutland` passes against the deployed URL
- [ ] Manual incognito-browser smoke passes
- [ ] OTel span on a `gemini-3.5-flash` call shows `group_id` attribute (proves tenant-span hook still works after rebrand)

**Risks:**
- The first deploy of a freshly-bootstrapped project often hits one or two API/permission edge cases (Firestore default DB not provisioned, Cloud Run min-instances default, etc.). Mitigation: budget +30 min slack; M0 + M5 share an iteration loop if needed.
- If europe-north1 Vertex AI `gemini-3.5-flash` lights up between M0 and M5 (low probability but possible per the launch cadence), switch the model endpoint URL inline.

## Day-by-Day Breakdown

### Day 1 — 2026-05-20 (Wed)

**08:30 – 09:00** — Sync read of the design doc; resolve Open Question 1 (use AR's projectile-motion example) and Open Question 2 (plain text wordmark) silently; flag if anything else changes.

**09:00 – 13:00** — **M0 cloud bootstrap** (sequential). Pause for lunch when `/health` returns 200 from a freshly-deployed Cloud Run service on `aipla-dev-2026`.

**13:00 – 16:00** — **M1 + M2 + M3 parallel.** Three sub-agent Tasks spawn in a single message via `sprint-executor` Phase 2B:
- Sub-agent A: M1 problem-set-hints skill
- Sub-agent B: M2 AIPLA branding + region pin
- Sub-agent C: M3 group-ID + seed-corpus glue

Re-converge ~16:00. Integration agent (Claude) merges the three branches into `dev` after their individual checkpoints.

**16:00 – 17:30** — **M4 smoke test** + **M5 deploy + verify**. Sequential. M4 must pass against LOCAL_MODE before M5 push.

**17:30 – 18:00** — Final manual verification: incognito browser → group-ID join → 3 scaffolding-rubric sample questions → all pass. Share URL with JB.

**Checkpoint:** v0.1 live by 2026-05-20 EOD.

### Days 2–7 (2026-05-21 → 26) — Buffer week

Not formal sprint work. Iteration loop driven by AR:
- AR reviews the tutor's responses on a variety of problems.
- M adjusts the system prompt (PR-only, no new milestones).
- Optional: ask AR for a fresh seed problem to replace the projectile-motion one.
- Monitor: per-turn cost in Cloud Trace (thinking token count); if it's pathological we set `thinkingBudget: 0` early.

### Day 8 (2026-05-27 Wed) — Jutland demo

JB + Aswin demonstrate to 2–3 teachers. No Claude work scheduled — just be available for hotfix on Slack.

## Quality Gates

After each milestone:
```bash
# Frontend
cd frontend && npm run quality:check:fast    # lint + typecheck (<30s)
cd frontend && npm run test:run               # vitest

# Backend
cd backend && make test-fast                  # ruff + pytest -m "not slow"
```

After M5 deploy:
```bash
# CI parity
cd frontend && npm run quality:check          # tests + build
cd backend && make lint && make test-fast

# End-to-end
aipla smoke jutland --url $DEPLOYED_URL
```

## Success Metrics
- [ ] All frontend tests passing (`cd frontend && npm run test:run`)
- [ ] All backend tests passing (`cd backend && make test-fast`)
- [ ] Lint and typecheck clean (both stacks)
- [ ] `aipla smoke jutland` passes against the deployed URL
- [ ] Demo URL reachable externally, verified by M independently and by JB independently
- [ ] OTel span on a Gemini call shows `group_id` attribute and `aipla-dev-2026` project ID
- [ ] Manual scaffolding-rubric check: 5 sample questions, no full solutions in any response
- [ ] Zero residual `aitana-multivac-*` or `Aitana-Labs/platform` strings in deploy-path files (grep test)

## Dependencies
- `aipla-dev-2026` GCP project (✅ created 2026-05-18, owner `m@sunholo.com`)
- `sunholo-voight-kampff` has push on `sunholo-data/cphu-aipla-app` (✅ granted 2026-05-19)
- Vertex AI `gemini-3.5-flash` callable via ADC (✅ verified 2026-05-20 on `global` endpoint)
- AR's projectile-motion problem from [examples.qmd](file:///Users/mark/Documents/clients/cph-uni/examples.qmd) (soft — proceed regardless; AR has the option of supplying a fresh problem during buffer week)

## Open Questions
- Carried over from the design doc, items 1 + 2 (problem-set source, wordmark) **resolved to fallback choices** to avoid blocking M1/M2: projectile-motion example and plain text wordmark respectively. If M wants different choices, surface at start of Day 1.
- Item 3 (europe-north1 GA for `gemini-3.5-flash`) is a watch item, not a blocker.

## Notes
- Velocity baseline doesn't exist yet (3 commits in the repo). Estimates above come from the design-doc LOC budgets, which were themselves conservative given how much the inherited template absorbs. If actual throughput on Day 1 morning differs by more than 1.5× from these, recalibrate at the M0 → M1/M2/M3 handoff (i.e., midday).
- The IaC strategy (Resolved Decision 3 in the design doc): M0 is a gcloud-based script on dev; the Terraform module lands in **1.1** post-Jutland and stands up `aipla-test-2026` + `aipla-prod-2026` from a clean state.
- Sprint-executor Phase 2B parallel mode is the intended execution mode for the midday window. M1/M2/M3 touch disjoint files (backend/skills/, frontend/src/, root scripts/) — no merge conflicts expected.
- If M0 spills past lunch, M1/M2/M3 still launch on time (they don't depend on M0 — they depend on M0's *outputs* only at the M5 deploy step). The risk is M5 being delayed, not the day.
