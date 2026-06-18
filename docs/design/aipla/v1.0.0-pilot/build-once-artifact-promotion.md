# build-once-artifact-promotion — tag→test, copy the artifact→prod

**Status**: Planned — refines the *code-promotion flow* of [env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md) (SEQUENCE 1.3). Supersedes its branch-merge-rebuild model.
**Priority**: P1 — locks the promotion model **before** [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) increment-2 writes the `cloudbuild.tf` triggers; the test/prod cut must build the right trigger shapes.
**Estimated**: doc + scripts + CLI ~1d (this lands now); the Terraform triggers are increment-2 (separate, owned by 1.1).
**Scope**: The promotion *mechanics* — image tagging, the promote pipeline (`cloudbuild.promote.yaml`), `scripts/promote-env.sh`, and the `aiplatform deploy` CLI group. Trigger *provisioning* (Terraform) is increment-2's lane; this doc specifies the trigger shapes it must create.
**Dependencies**: [env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md) (1.3 — the flow this refines), [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) (1.1 — owns the triggers), the deploy CI-gate (`cloudbuild.yaml` `ci-gate-*`, landed 2026-06-17), ADR-006/007 (regions).
**Created**: 2026-06-18
**Last Updated**: 2026-06-18
**Upstream**: generically useful — the template ships branch→env *rebuild*; build-once-promote is a clean improvement worth upstreaming to `sunholo-data/ai-protocol-platform`. Log as a new entry in [docs/upstream-feedback.md](../../../upstream-feedback.md) (relates to #36, the deploy-CI-gate entry).

## Problem Statement

The [env-promotion doc](env-promotion-dev-test-prod.md) (1.3) currently promotes code by **branch ff-merge that rebuilds per env** (`git push origin test` → `aipla-test-deploy` builds from source → deploys test; same for prod). That means **prod is built from source a second time** — the bytes teachers hit in prod are *not* the bytes that passed test, only "the same commit, rebuilt." Between two builds of the same commit, base images, transitive deps, and build-time config can drift. For a pilot put in front of real teachers, "tested ≠ shipped" is the wrong default.

We already run the better pattern elsewhere: **ailang-parse / docparse build the artifact once and copy it to prod** rather than rebuilding. This doc brings that pattern to AIPLA — with one wrinkle ailang-parse doesn't have (a Next.js frontend that bakes config at build time).

**Current State:**
- Images are tagged by **branch** (`…/ui:${BRANCH_NAME}`, `…/backend:${BRANCH_NAME}`) — mutable, per-env, rebuilt each push (`cloudbuild.yaml`).
- Each env project has its **own** Artifact Registry (`europe-north1-docker.pkg.dev/aipla-<env>-2026/cphu/…`).
- test/prod have **no triggers yet** — increment-2 is about to create them. This is the moment to choose the model.

**Impact:** without this, increment-2 hardcodes branch-rebuild triggers and we inherit "tested ≠ shipped" for the whole pilot + handover.

## Goals

**Primary Goal:** Promote a release by **building each artifact once, identifying it immutably, and copying the tested bytes to prod** — so prod runs exactly what test verified, with a one-command operator path (`aiplatform deploy promote`).

**Success Metrics:**
- The image that serves prod is **byte-identical** (same digest) to the one that passed test — for every artifact that *can* be env-agnostic.
- Promotion to prod runs **no source rebuild of the backend** (the heavy, dependency-laden, logic-bearing artifact).
- One operator command + one Cloud Build config; no hand-run `gcloud` sequences.
- Immutable release identity (a git tag / version), not a moving branch tag.

**Non-Goals:**
- Provisioning the triggers (increment-2 / 1.1). This doc specifies their shape.
- Live-running a promotion now — test/prod don't exist yet. The scripts/CLI land **dry-run-verifiable**, ready for M2/M3.
- Changing dev's flow. Dev stays push-to-branch (fast iteration).

## Axiom Alignment

Scored per [Product Axioms](../../../product-axioms.md).

| # | Axiom | Score | Notes |
|---|-------|-------|-------|
| 1 | INSTANT FEEL | 0 | Deploy infra. (Prod promotion is faster — no rebuild — but not a user latency path.) |
| 2 | EARNED TRUST | 0 | No factual-claim surface. |
| 3 | SKILLS, NOT FEATURES | 0 | Invisible infra. |
| 4 | RIGHT MODEL | 0 | n/a. |
| 5 | GRACEFUL DEGRADATION | +1 | test tier catches before prod; rollback = redeploy the previous digest (immutable, still in AR); copy-not-rebuild removes the "rebuilt-differently-in-prod" failure class. |
| 6 | PROTOCOL OVER CUSTOM | 0 | Uses platform-standard OCI copy / Cloud Build, not an open wire protocol. |
| 7 | API FIRST | 0 | Operator op, not a channel. |
| 8 | OBSERVABLE BY DEFAULT | +1 | Promote-by-digest is an exact audit trail: the tested digest *is* the prod digest, recorded in the build + `deployed-urls.md`. |
| 9 | SECURE BY CONSTRUCTION | +1 | prod runs the exact bytes that passed the CI-gate + test smoke — no source drift between a test build and a separate prod build; immutable release tags; CI-gate still runs at the test build. |
| 10 | THIN CLIENT | 0 | (The frontend-rebuild decision *leans on* the thin-client nature — see §Frontend.) |
| 11 | USABLE BY DESIGN | 0 | No student surface. |
| | **Net Score** | **+3** | Deploy-infra; mandate inherited from env-promotion (1.3). No hard-fail (no -1s). |

## Design

### Unit of promotion: an annotated git tag

A **version tag** (`v1.1.40`) is the promotion unit — an immutable source pointer, unlike a moving branch tag. Tagging `dev` cuts a release candidate. Images are tagged immutably by it (`…/ui:v1.1.40`, `…/backend:v1.1.40`) and deployed **by digest**.

### What's copy-promotable, and what isn't (verified against the Dockerfiles)

| Artifact | Env-portable? | Why |
|---|---|---|
| **backend** (`aipla-v01-frontend/backend`) | **Yes** | Its build-args are runtime-overridden (`GOOGLE_CLOUD_PROJECT`/`LOCATION` set via `--set-env-vars` at deploy) or **vestigial** (`FIREBASE_BUCKET` is baked but *no backend code reads it* — verified). The image carries no live env-specific state → copy is byte-clean. |
| **frontend** (`aipla-v01-frontend/ui`) | **No** | Next.js **inlines `NEXT_PUBLIC_*` into the static bundle at compile time** — and these are env-specific (`NEXT_PUBLIC_FIREBASE_*` = the env's Firebase project, `NEXT_PUBLIC_MCP_SANDBOX_URL`, `NEXT_PUBLIC_AUTH_MODE`, `NEXT_PUBLIC_TEACHER_MOCK` = dev-only). A test image copied to prod ships test's Firebase project + teacher-mock → wrong/unsafe. |

This is precisely why ailang-parse/docparse copy cleanly (one backend service, no compile-time-baked frontend) and AIPLA needs the split below.

### The promotion pipeline (`cloudbuild.promote.yaml`, runs in the TARGET project)

1. **Backend → copy by digest.** Resolve the source digest of `…/aipla-<from>-2026/cphu/aipla-v01-frontend/backend:<version>`; `gcloud artifacts docker images copy` it to the target project's AR under the same tag. Exact bytes, no rebuild.
2. **Frontend → rebuild from the tagged source** with the *target* env's config (`get-firebase-config.sh` + the target `_MCP_SANDBOX_URL`), push to the target AR. The frontend is a thin rendering layer (Axiom 10) whose only per-env differences *are* the config we want to differ; rebuilding from the **same immutable tag** keeps the source identical, so this is "the tested frontend + prod config," not a divergent build.
3. **Deploy** both to the target Cloud Run service by digest (backend) / tag (frontend).
4. **Smoke** the target (reuse the `cloudbuild.yaml` smoke block / `scripts/smoke-deployed.sh <env>`).

**No CI-gate at promote** — the artifact is frozen and the gate already ran at the test build. (The frontend rebuild is from the same tag; its source already passed.)

> **The clean end-state (Frontend option A, deferred):** make the frontend read its public config at **runtime** (`/api/config` or `window.__ENV__` injected at container start) instead of compile-time `NEXT_PUBLIC_*`. Then the frontend image is env-agnostic too and step 2 becomes a copy like the backend — *full* build-once-promote. This is a moderate refactor of `frontend/src/lib/firebase.ts` + the sandbox-URL read, and is the **strongest upstream-template improvement** here. Tracked as a follow-up; option B (rebuild-from-tag) ships now and is correct.

### Trigger shapes for increment-2 (1.1's Terraform lane — specified, not built here)

| Env | Trigger | Fires on | Config | Rebuilds? |
|---|---|---|---|---|
| dev | `aipla-dev-deploy` (exists) | push to `dev` | `cloudbuild.yaml` | yes (fast iteration — unchanged) |
| **test** | `aipla-test-release` | **tag push `^v.*$`** | `cloudbuild.yaml` (immutable `:${TAG_NAME}` tags) | yes (build-once happens here, CI-gated) |
| **prod** | `aipla-prod-promote` | **manual** (`--substitutions=_VERSION=…,_SOURCE_PROJECT=aipla-test-2026`) | **`cloudbuild.promote.yaml`** | **no backend rebuild** (copy); frontend rebuilt from tag |

The prod-promote trigger runs in the prod project and needs cross-project AR **read** on the test project (`roles/artifactregistry.reader` for the prod build SA on `aipla-test-2026`). Note that in the §State-home decision the connection+triggers move to `aipla-deploy-2026`; the cross-project read grant is the same shape there.

### CLI Surface (`aiplatform deploy …`)

Per the CLI-affordance rule, the operator path is a typed command, not a curl/gcloud incantation. New Click group `cli/aiplatform/commands/deploy.py`:

- **`aiplatform deploy promote --from test --to prod --version v1.1.40 [--dry-run] [--yes]`** — the headline. Validates the promotion edge (dev→test, test→prod), confirms the source image+digest exists, then runs the promotion (submits `cloudbuild.promote.yaml` to the target project, or runs the `aipla-prod-promote` trigger once increment-2 creates it). `--dry-run` prints the exact `gcloud` it would run; default is **confirm-before-acting**.
- **`aiplatform deploy status [--env dev|test|prod]`** — shows the live Cloud Run revision + **image digest** per env, so you can see at a glance that test and prod are on the same backend digest. (gcloud, no backend HTTP.)
- **`aiplatform deploy release --version v1.1.40`** — convenience: tag `dev` HEAD and push the tag (fires `aipla-test-release`). Thin wrapper over `git tag -a … && git push origin <tag>`.

Commands shell out to `scripts/promote-env.sh` / `gcloud` (the established subprocess pattern in `http.py`); unit-tested with `CliRunner` + `subprocess.run` mocks. Wired in `cli/aiplatform/cli.py` via `main.add_command(deploy)`.

### Scripts

- **`scripts/promote-env.sh --from <env> --to <env> --version <tag> [--dry-run] [--yes]`** — the single source of promotion logic (resolve digest → copy backend → trigger/submit frontend rebuild + deploys → smoke). `--dry-run` echoes every `gcloud` without executing. Both the CLI and `cloudbuild.promote.yaml` call into the same logic so there's one implementation.
- **Makefile:** `make promote FROM=test TO=prod VERSION=v1.1.40` wraps it.

## Implementation Plan

### Phase 1 — mechanics (this doc, lands now; dry-run-verifiable)
- [ ] `scripts/promote-env.sh` (with `--dry-run`).
- [ ] `cloudbuild.promote.yaml` (copy backend + rebuild frontend + deploy + smoke).
- [ ] `aiplatform deploy` CLI group (`promote`, `status`, `release`) + CLI tests.
- [ ] `make promote` target.
- [ ] Refine env-promotion (1.3) code-promotion section to point here; register in SEQUENCE.

### Phase 2 — wiring (with the test/prod cut; 1.1 increment-2 + M2/M3)
- [ ] increment-2 creates `aipla-test-release` (tag) + `aipla-prod-promote` (manual) triggers + the cross-project AR-reader grant.
- [ ] First real promotion: tag → test build → `aiplatform deploy promote --to prod` → verify same backend digest in both.

### Phase 3 — full build-once (upstream-worthy, deferred)
- [ ] Frontend option A: runtime config → frontend image becomes env-agnostic → promote copies it too. Upstream the pattern.

## Migration & Rollout

Nothing live changes now (test/prod don't exist). dev is untouched. When test/prod land, the **rollback** story is strong: every released digest stays in AR, so rollback = `gcloud run deploy --image …@<previous-digest>` (no rebuild) — itself a promotion in reverse.

## Testing Strategy

- **CLI:** `CliRunner` + `subprocess.run` mocks (assert the right `promote-env.sh` args); `--dry-run` path asserted end-to-end. `make cli-selftest-mock`.
- **Script:** `--dry-run` is the test surface now (shellcheck + the printed plan); live e2e is M3 (`smoke-deployed.sh <env>` is the acceptance gate).
- **Promotion correctness (M3):** `aiplatform deploy status --env test` and `--env prod` show the **same backend digest** → proves copy, not rebuild.

## Security Considerations

- Cross-project AR read (prod build SA → `roles/artifactregistry.reader` on the source project) is the one new trust edge — least-privilege, read-only, documented for increment-2.
- Promotion deploys an **immutable digest**, removing the "someone repushed `:prod`" tag-mutation risk.
- Prod still honours the `_SKIP_CI_GATE`-cannot-be-set-by-push rule; promote runs no gate by design (frozen artifact) — the gate ran at the test build.

## Success Criteria

- [ ] `aiplatform deploy promote --dry-run` prints a correct, copy-not-rebuild plan.
- [ ] `cloudbuild.promote.yaml` copies the backend by digest and rebuilds only the frontend.
- [ ] CLI tests green; `make cli-selftest-mock` green.
- [ ] env-promotion (1.3) updated to reference this model; increment-2 trigger shapes specified.
- [ ] (M3) test and prod report the **same backend digest** via `deploy status`.

## Open Questions

1. **Frontend option A timing** — do the runtime-config refactor before prod (full build-once) or ship option B (rebuild-from-tag) for the pilot and upstream A after? Lean: B for the pilot, A as the upstream follow-up.
2. **Promote home** — run the promote build in the prod project, or in `aipla-deploy-2026` (the deploy project) targeting prod? Aligns with the env-promotion M0 decision; settle with increment-2.
3. **Tag scheme** — reuse the app version (`v1.1.40`) or a deploy-specific `rel-YYYYMMDD-N`? Lean: app version, one tag per release candidate.
4. ~~Missing `docs/upstream-feedback.md`~~ — **resolved: the file exists** (36 entries; my earlier `find`/`test -f` missed it, likely a concurrent-session timing artifact). Build-once-promote should be logged there as a new entry (~#37) — additive, left for M's next upstream-feedback pass.

## Related Documents

- [env-promotion-dev-test-prod.md](env-promotion-dev-test-prod.md) — the flow this refines (1.3)
- [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) — owns the Terraform triggers (1.1, increment-2)
- [cloudbuild.yaml](../../../../cloudbuild.yaml) — the build pipeline (image tagging, CI-gate, smoke)
- `scripts/promote-env.sh`, `cloudbuild.promote.yaml`, `cli/aiplatform/commands/deploy.py` — the artifacts this doc specifies
- [docs/upstream-feedback.md](../../../upstream-feedback.md) — the template-friction log; build-once-promote is a natural new entry (relates to #36, the deploy-CI-gate entry)
