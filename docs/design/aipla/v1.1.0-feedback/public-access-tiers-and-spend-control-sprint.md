# ACCESS-1 sprint — public access tiers and spend control

**Design doc:** [public-access-tiers-and-spend-control.md](public-access-tiers-and-spend-control.md) (1.1.75)
**Sprint ID:** `ACCESS-1`
**Created:** 2026-08-12
**Priority:** **P0 — blocks publicising `aipla.ku.dk`** (domain live since 2026-08-11 17:46 UTC)
**Baseline health at plan time:** backend 3009 passed / 1 skipped; frontend CI-parity green

## Sprint goal

No account we have not explicitly invited can cause a single paid API call, while every
visitor can still sign in, navigate the whole product, and watch a physics tutoring
session play out end to end.

## Velocity basis

14-day history: 92 commits, 320 files, +33,353 / −3,486. Recent comparable fullstack
sprints (1.1.73 student-writing-element: 5 commits M0–M4 across ~2.5–3d; 1.1.74
site-chrome: M1–M4 in ~1.5–2d) support ~1.5–2 milestones/day for well-specified work
with existing seams. This sprint has unusually good seams (the budget Protocol, the
callback pair, the admin SA gate, the bootstrap hook all already exist), so the
estimate leans on wiring rather than invention.

## Milestone order — gate first, polish second

The design doc's rings are a *safety* ordering. Execution follows the **publicity gate**:

| Order | Milestone | Scope | Est. | Why here |
|---|---|---|---|---|
| 1 | **M0** ceiling | infra | ~0.5d | No app code, depends on nothing, closes the unbounded-thinking hole today |
| 2 | **M1** access tiers | fullstack | ~2d | The structural gate — after this, an uninvited account cannot spend or mint a code |
| 3 | **M4** nudge | fullstack | ~0.75d | Without it M1 is a dead end; completes the hard publicity gate |
| 4 | **M2** recorded demo | fullstack | ~2.5d | Delivers the ask as stated; turns the dead end into a demonstration |
| 5 | **M3** enforcer | backend | ~2d | Caps invited teachers; needed before any cohort beyond a few watched pilots |

**Hard publicity gate = M0 + M1 + M4** (~3.25d). M2 and M3 follow.

---

## M0 — Ring 0 ceiling (infra, ~0.5d)

No application code. Holds even if every other milestone has a bug.

- [ ] `AIPLA_THINKING_BUDGET` per env — **`cloudbuild.yaml` AND `cloudbuild.promote.yaml`** (prod is reached only by `make promote`; this exact omission has bitten three values already)
- [ ] `google_service_usage_consumer_quota_override` on `aiplatform.googleapis.com` per env
- [ ] `google_billing_budget` + 50/90/100% alert thresholds
- [ ] Record ceiling numbers in the ops runbook

**Acceptance:** `make check-cloudbuild` passes; `make tf-plan ENV=test` shows the quota + budget resources and no unrelated drift; the env var appears in both pipelines.

**Risk:** Terraform apply is Cloud Build-side (`make tf-apply`), not laptop-side. Plan is committed; apply is a deliberate separate action.

---

## M1 — Access tiers (fullstack, ~2d)

The structural gate. After this a visitor can navigate everything and spend nothing.

- [ ] `teacher_access/{normalised_email}` model + accessors (~120 LOC + tests)
- [ ] `access_tier` custom claim read in `_user_from_decoded_token`; `User.access_tier` field (~40 LOC)
- [ ] Bootstrap reconciliation: read register → set claim on drift → return `tierChanged` (~80 LOC)
- [ ] `assert_can_spend` in `auth/guards.py` (402) + every call site in the design's table (~150 LOC)
- [ ] `demo_seed` conditional — visitors get activities + Demo class, **no join code** (~20 LOC)
- [ ] Admin `grant` / `revoke` (with `revoke_refresh_tokens`) / `list`, SA-gated (~120 LOC)
- [ ] `aiplatform access grant|revoke|list` CLI (~150 LOC)
- [ ] Frontend renders 402 as a nudge, not an error (~60 LOC)

**Acceptance:**
- Absent claim → `visitor`; revoked → `visitor`; past `expiresAt` → `visitor`
- Every guarded route 402s for a visitor and 200s for a pilot
- Visitor bootstrap mints **no** join code
- `Anna@KU.dk` matches `anna@ku.dk`; `anna+test@ku.dk` does **not**
- `is_teacher` semantics unchanged — all existing `assert_teacher` tests still pass

**Risk:** the 35 `assert_teacher` call sites. Mitigated by *not touching* `is_teacher` and adding a separate narrower guard. Any diff that changes `is_teacher`'s meaning is out of scope by construction.

---

## M4 — Access request + nudge (fullstack, ~0.75d)

- [ ] `/teacher/access` page in the `(site)` route group (footer is structural there) (~150 LOC)
- [ ] Visitor banner on teacher surfaces, re-shown on any 402 (~60 LOC)
- [ ] `POST /api/teacher/access-request` → `access_requests/{uid}` (~80 LOC)
- [ ] `aiplatform access requests` + grant-from-queue (~60 LOC)

**Acceptance:** visitor reaches the request route in one click from any teacher surface;
request submission does not reveal whether the email is already on the register;
`make check-brand-literals` and the route-chrome coverage test pass for the new page.

---

## M2 — Recorded demo path (fullstack, ~2.5d)

- [ ] `demo_transcripts/{activityId}` model + seeding (~100 LOC + content)
- [ ] Replay event source behind `stream_agui_events`, realistic cadence (~200 LOC)
- [ ] `process_skill_request` source selection by tier (~40 LOC)
- [ ] Frontend recording affordance + off-script honest card (~120 LOC)
- [ ] **The load-bearing test**: a visitor session touches no model client

**Acceptance:**
- Visitor chat streams recorded turns through the unchanged chat surface
- Off-script input never yields a fabricated answer
- Naming avoids `_mock-data` / `getMock` / `MOCK_[A-Z]` (`check:no-mock` is lexical)
- No part of this reuses the `LOCAL_MODE` identifier (`check_local_mode_safety.py` regex-bans it in deployed config)

**Risk:** the honesty properties are the whole justification for canned content. They are
acceptance criteria, not polish.

---

## M3 — Per-teacher enforcer (backend, ~2d)

- [ ] `FirestoreBudgetEnforcer` implementing the **existing** `BudgetEnforcer` Protocol, sharded counters (~250 LOC)
- [ ] `register_budget_enforcer(...)` at startup (~10 LOC)
- [ ] `resolve_billing_identity` — group → class → owner uid, cached (~80 LOC)
- [ ] `tool_configs.budget` on skill templates (**re-seed required**)
- [ ] Both fail-open inversions + rate-card/`models.yaml` startup consistency assertion (~60 LOC)
- [ ] `spend_guard.guard_spend` + the ten direct-`genai` sites + RAG + voice (~150 LOC)
- [ ] Cap exceeded → recorded-demo fallthrough + teacher alert (~80 LOC)

**Acceptance:** cap not exceeded → allow; soft threshold → warn; exceeded → block;
unresolved identity → **block** (inverted from the template's fail-open);
unknown model → raises; concurrent shard writes sum correctly.

**Risk:** M3's fallthrough depends on M2. If M2 slips, cap-exceeded degrades to a clear
error message instead — still graceful, less good.

---

## Quality gates

Per milestone: `cd backend && make lint && make test-fast` · `cd frontend && npm run quality:check`
(CI parity — the fast variants miss tests and shipped 9 red commits once).

End of sprint additionally: `make audit-trust-cards` · `make check-cloudbuild` ·
`make check-brand-literals` · `make check-skill-catalogue` (all in the CI
`local-mode-safety` job).

## Commit policy

Per project rule: **no PRs.** Feature branch, ff-merge into `dev`, push `dev`.
Conventional commits, people by initials, no emoticons.
