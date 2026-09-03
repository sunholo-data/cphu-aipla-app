# PROGADMIN-1 sprint — delegated programme administration

**Design doc:** [delegated-programme-administration.md](delegated-programme-administration.md) (1.1.76)
**Sprint ID:** `PROGADMIN-1`
**Created:** 2026-09-03
**Priority:** **P1** — the bus-factor half is arguably P0
**Design fork confirmed by M (2026-09-03):** keep the separate `programmeAdmin` claim.
Do **not** extend `role:researcher`. Researchers read; programme admins write.

## Sprint goal

More than one person can admit a teacher to the pilot on prod, and can set a cap
next to the spend it bounds — without anyone gaining a capability they do not
need, and without the service-account gate being loosened by one line.

## Why now

Verified again today while granting `augustjelert@gmail.com` on prod: admitting a
teacher still requires impersonating `aipla-v6@aipla-prod-2026`, and
`serviceAccountTokenCreator` on prod is held by **`m@sunholo.com` alone**. AD
starts ~2026-10-01. Shipping this before the overlap starts is what makes the
overlap a pairing rather than a demo.

## Velocity basis

14-day history: 55 commits, 241 files, +19,175 / −966. The seams this sprint
needs all exist and were read at plan time — `_set_claim` (merge-not-clobber
claim writer), `grant_access(granted_by=…)`, `assert_researcher`,
`research_lens_routes.py`'s 404-not-403 router, `useIsResearcher`,
`FirestoreBudgetEnforcer.consult`'s sharded counters. This is wiring, not
invention, so the doc's ~3.5d estimate holds.

## Baseline health at plan time

Backend `make test-fast`: **3269 passed, 1 skipped, 19 deselected** (2026-09-03, clean `dev` at `251fbcb`).

---

## Decisions taken at plan time

The design doc left four open questions. All four block M2, so they are answered
here rather than mid-build. Each is env-configurable or an ops action, so each is
reversible.

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | `PROGRAMME_ADMIN_MAX_CAP_USD` | **50.0** | The doc's own guess. Low and raisable is the safe direction. Covers the $25 the register actually uses; refuses JB/M's $100, which stays an SA decision. |
| 2 | Domain allowlist | **Ship the mechanism, default it EMPTY (unrestricted)** | The doc suggested `ku.dk` on prod. Checked against the live prod register: of 24 rows, ~20 are school domains (`toerring-gym.dk`, `nrgym.dk`, `vhim-gym.dk`, `sag.dk`, `ghg.dk`, `birke-gym.dk`, `frbgym.dk`, `sctknud-gym.dk`, `o365.favrskov-gym.dk`) or deliberate Gmail aliases. A `ku.dk` allowlist would refuse almost every real teacher. Ship it configurable, default open, tighten once there is a reason. |
| 3 | Delegated expiry ceiling | **Capped at `2027-09-15`** | The doc says `2026-09-15` — that is the **stale original contract boundary**. The extension runs to at least 2027-04-30 and the register was re-stamped to 2027-09-15 on 2026-08-17. Delegation still cannot outlive the engagement; the engagement just moved. |
| 4 | Who holds the claim day one | **Not baked into code.** JB (`jbruun@ind.ku.dk`) certainly; AR (`aswin.rangkuti@ind.ku.dk`) on M's say-so | Minting is an SA action, deliberately. Listed as a post-merge ops step, not a migration. |

### One trap the design doc does not mention

`PROGRAMME_ADMIN_MAX_CAP_USD` and `PROGRAMME_ADMIN_EMAIL_DOMAINS` are **per-env
env vars**, and per CLAUDE.md's footgun table, anything per-env in
`cloudbuild.yaml` needs a `cloudbuild.promote.yaml` twin — prod is reached only
by `make promote`. That footgun has already bitten four times
(`MCP_WIDGET_DOMAIN`, three feature flags, the seed step, `firestore.rules`).
Both pipelines, same commit, or the bound silently does not exist on prod —
which fails **open**, because an unset bound would read as "no ceiling".

M2 carries an explicit task for this and the acceptance criterion names both files.

---

## Milestone order

| Order | Milestone | Scope | Est. | Why here |
|---|---|---|---|---|
| 1 | **M1** read-only register + queue | fullstack | ~0.5d | Independently useful, independently safe — grants read to people who already hold far broader read. Ship even if M2 slips. |
| 2 | **M2** bounded write + cap editing | fullstack | ~2d | The bus-factor fix. After this, JB can admit a teacher. |
| 3 | **M3** programme-wide daily budget | backend + panel | ~1d | Depends on M2 for the write path. Genuinely separable — cut first if capacity runs short. |

---

## M1 — Read the register (fullstack, ~0.5d)

Removes the visibility problem without granting anything.

- [ ] `backend/protocols/programme_routes.py` — new router, `prefix="/api/programme"`,
      `_assert_programme_reader(user)` → 404 for anyone without `is_researcher`
      **or** `is_programme_admin`, modelled byte-for-byte on
      `research_lens_routes.py::_assert_researcher` (~80 LOC)
- [ ] `GET /api/programme/access/list` and `GET /api/programme/access/requests` —
      reuse `db.teacher_access.list_grants` and the existing access-requests
      accessor; no second implementation of the register
- [ ] Register the router in `backend/fast_api_app.py`
- [ ] **Add `programme_routes.py` to the ALLOWLIST in `scripts/check-auth-dispatcher.sh`**
      with the reason `teacher-only — researcher/programme-admin surface, a group JWT has no business here`.
      The router imports the Firebase-only `get_current_user` on purpose; without
      the allowlist entry `make check-auth-dispatcher` reds the CI `local-mode-safety` job
- [ ] `frontend/src/app/teacher/programme/page.tsx` + Register / Requests tables,
      read-only (~250 LOC)
- [ ] Nav entry in `_TeacherClientShell.tsx`, rendered only with either claim
- [ ] `useIsProgrammeAdmin()` hook beside `useIsResearcher()` (~20 LOC)

**Acceptance:**
- A plain teacher gets **404** on both GETs and sees no nav entry.
- A researcher gets **200**, sees every register row and the queue, and sees **no buttons**.
- `make check-auth-dispatcher` passes.
- `cd frontend && npm run quality:check` green.

---

## M2 — Bounded write (fullstack, ~2d)

- [ ] `programmeAdmin` claim read in `_user_from_decoded_token`;
      `User.is_programme_admin` field, defaulting False so an absent claim is safe
      by construction (~30 LOC)
- [ ] `_set_programme_admin_claim(uid, granted=…)` in `backend/admin/routes.py`
      via the existing `_set_claim` — merge, never clobber (~10 LOC)
- [ ] `POST /api/admin/grant-programme-admin` / `revoke-programme-admin`,
      SA-gated. **The only way to mint the claim.** (~60 LOC)
- [ ] `assert_programme_admin` in `backend/auth/guards.py` — raises **404**, not
      403, matching the router's enumeration-resistance (~30 LOC)
- [ ] `POST /api/programme/access/grant` — server-side bounds, in this order:
      tier must be `pilot` or `visitor` · cap ≤ `PROGRAMME_ADMIN_MAX_CAP_USD` ·
      cap may not be `0` or `UNCAPPED` · domain in `PROGRAMME_ADMIN_EMAIL_DOMAINS`
      when non-empty · expiry ≤ `2027-09-15` (~150 LOC)
- [ ] `POST /api/programme/access/revoke` — delegated, and still kills refresh
      tokens exactly as the SA path does
- [ ] `granted_via` on `AccessGrant` (`"programme-admin"` | `"service-account"`),
      written by both paths, surfaced in both listings (~40 LOC)
- [ ] `PROGRAMME_ADMIN_MAX_CAP_USD` + `PROGRAMME_ADMIN_EMAIL_DOMAINS`
      **in `cloudbuild.yaml` AND `cloudbuild.promote.yaml`** — see the trap above
- [ ] `aiplatform users grant-programme-admin <uid>` / `revoke-programme-admin <uid>` (~80 LOC)
- [ ] Grant / revoke UI on the same panel, shown only to a programme admin (~150 LOC)
- [ ] **Editable cap per row with spend-this-period beside it**, and `—` rendered
      as an **alarm**, not a blank — `cap=0` disables the per-teacher gate outright (~120 LOC)

**Acceptance — the tests that matter here are all refusals:**
- Plain teacher: 404 on every `/api/programme/*` route, read and write
- Researcher: 200 on GET, **404 on every write**
- Programme admin, cap ≤ bound → 200; cap > bound → **403 naming the bound, nothing written**
- Programme admin, cap `0` or uncapped → 403
- Programme admin, expiry beyond `2027-09-15` → 403
- **A programme admin cannot mint `programmeAdmin`** — the escalation test, named as such
- A programme admin cannot reach any `/api/admin/*` route (SA gate unchanged)
- `granted_via` is `"programme-admin"` on the delegated path, `"service-account"` on the SA path
- The bound is read from env, so prod can differ from dev
- `make check-cloudbuild` passes and both pipelines carry both vars

---

## M3 — Programme-wide daily budget (backend + panel, ~1d)

Cut this first if capacity runs short. M1 and M2 are the bus-factor fix; this is
a new control.

- [ ] `programme_budget/{env}` store + `GET`/`PUT /api/programme/budget` (~80 LOC)
- [ ] Second check in `FirestoreBudgetEnforcer.consult` on a programme-wide period
      key, reusing the existing sharded counters — no new gate (~80 LOC)
- [ ] Panel control that **refuses any value above the deployed Vertex quota**
      and says why (~120 LOC)
- [ ] Default **unset**. Inventing a number before `class_spend` has pilot data
      would be a guess wearing a suit.

**Acceptance:** warn at threshold; block only when `action: "block"`; a value
above the GCP ceiling is rejected with the ceiling named; an unset budget changes
nothing about today's behaviour.

---

## Post-merge ops (not code)

- [ ] `make seed`-style deploy to dev, then mint the claim for JB on dev and confirm he can grant
- [ ] Promote to test, then prod
- [ ] Mint `programmeAdmin` for `jbruun@ind.ku.dk` on prod (SA path, M only)
- [ ] AR (`aswin.rangkuti@ind.ku.dk`) on M's say-so
- [ ] Update [docs/ops/runbooks/access-requests.md](../../../ops/runbooks/access-requests.md) —
      it currently says the SA path is the only way in, and names
      `CLOUDSDK_ACTIVE_CONFIG_NAME=sunholo`, a gcloud config that does not exist
      on this machine

## Risks

| Risk | Mitigation |
|---|---|
| The two routers drift and one gets widened while editing the other | `/api/programme/*` never calls `_assert_caller_is_service_account`; the SA router never reads the claim. Separate files, separate guards, a test for each. |
| Privilege propagation | One guard, one named test. A programme admin cannot mint the claim they hold. |
| Per-env bound missing on prod | Both pipelines in the same commit; `make check-cloudbuild` in CI; acceptance names both files. |
| Unit tests pass in lockstep with an auth bug (the `dependency_overrides` trap) | The refusal tests go in `backend/tests/api_tests/`, alongside `test_dual_auth_rejection.py`, exercising the real dispatcher rather than an overridden symbol. |
