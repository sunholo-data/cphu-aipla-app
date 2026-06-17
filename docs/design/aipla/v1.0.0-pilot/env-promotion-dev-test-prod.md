# env-promotion — cutting test/prod from dev

**Status**: Planned — SEQUENCE row 1.3
**Priority**: P1 (a proven `test` env is the safety net the 2026-06-17 dev-only demo outage showed we lack; must exist before the 2026-08-14 teacher pilot)
**Scope**: The **code-promotion flow** (dev → test → prod) + the **per-env readiness checklist** + cut order. Provisioning *mechanics* (the IAM cascade, buckets, secrets schema, triggers) are owned by [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) (SEQUENCE 1.1) — this doc does not duplicate that resource list, it consumes it.
**Dependencies**: [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) (1.1, the Terraform module); the deploy CI-gate (landed 2026-06-17, `cloudbuild.yaml` `ci-gate-*`); ADR-006/007 (regional pinning — `europe-north1` for compute, `europe-west1` for Agent Engine + RAG); the "only cleared curriculum enters a shared corpus" rule; the "ff-merge to dev, no PRs" git policy.
**Created**: 2026-06-17
**Last Updated**: 2026-06-17

## Problem statement

Everything runs in **dev only** (`aipla-dev-2026`). The 2026-06-17 demo outage
(an anon-group session bug + a red-CI-still-deploys gap) landed straight on the
environment teachers were demoing against — there was no `test` tier to catch it
first. The teacher pilot starts **2026-08-14**; before then we need a `test` env
that mirrors prod config so a deploy can be exercised end-to-end (teacher SSO +
anon-group student round-trip + chat-log pipeline) before it reaches real users,
and a `prod` env to cut closer to the pilot.

`aipla-cloud-bootstrap.md` (1.1) anticipated exactly this: *"Once test/prod need
to be cut, the same work has to happen three times, and per-env drift … becomes
the failure mode."* This doc is the trigger it named — plus the part that doc
doesn't cover: **how code moves between envs** and **what "ready" means per env**.

## Current state — what exists vs what's missing (verified 2026-06-17)

| | dev (`aipla-dev-2026`) | test (`aipla-test-2026`) | prod (`aipla-prod-2026`) |
|---|---|---|---|
| GCP project | ✅ provisioned, billing linked | ✅ ACTIVE but **bare** (Secret Manager API not even enabled) | ✅ ACTIVE but **bare** |
| Cloud Build trigger | ✅ `aipla-dev-deploy` + `aipla-mcp-sandbox-deploy` | ❌ none | ❌ none |
| Runtime SA + IAM cascade | ✅ | ❌ | ❌ |
| Buckets (config/artifacts/logs/research-audio/tts-cache) | ✅ | ❌ | ❌ |
| Secrets (`GROUP_AUTH_SIGNING_SECRET`, `AGENT_ENGINE_ID`, `DOCPARSE_API_KEY`, `CURRICULUM_RAG_CORPUS_NAME`, `FIREBASE_ENV`) | ✅ | ❌ | ❌ |
| Agent Engine (`europe-west1`) | ✅ | ❌ | ❌ |
| Curriculum RAG corpus (`europe-west1`) | ✅ (A-level cleared seeded) | ❌ | ❌ |
| Firebase project + web app | ✅ | ❌ | ❌ |
| MCP sandbox service (`aipla-v01-sandbox`) | ✅ | ❌ | ❌ |

**Conclusion: test/prod are effectively greenfield.** The branches (`dev`, `test`,
`prod`) all exist, and `cloudbuild.yaml` is already branch→env parameterised
(`dev → aipla-dev-2026`, etc.), but *nothing is provisioned* in test/prod. The
shell bootstrap (`scripts/bootstrap-aipla-dev.sh`) is **dev-hardcoded**
(`PROJECT="aipla-dev-2026"`), so it can't cut a new env as-is.

## Provisioning model (DECIDED 2026-06-17)

**dev is the imperative reference env; test/prod are Terraform-only.** dev is
where we iterate — the shell bootstrap + ad-hoc `gcloud` are fine there because
dev is the place we *discover* what infra is needed. test and prod are never
touched imperatively: the Terraform module (owned by [1.1](aipla-cloud-bootstrap.md))
is **authored by capturing dev's resource inventory**, then `terraform apply`-ed
per env with a `test` / `prod` tfvars. No `bootstrap-aipla-dev.sh` on test/prod;
no manual `gcloud` mutation on test/prod. This makes test/prod reproducible and
drift-free, and turns "cut a new env" into "write a tfvars + apply".

Consequence: the gating dependency for cutting `test` is **completing the
Terraform module** so it reproduces *everything* dev has (cloud-bootstrap.md
sections A–G), not just the BQ-dataset+sink slice that's applied today. dev's
shell script + its `.NOTES.md` are the source-of-truth inventory the module must
match.

## Two independent strands to "cut an env"

1. **Provisioning** (owned by 1.1) — complete the Terraform module from dev's
   inventory, then `terraform apply` it against the target project. Terraform-only
   per the decision above.
2. **Code promotion** (this doc) — move the *same commit* dev → test → prod.

## Code-promotion flow

Per the project git policy (ff-merge, no PRs):

```
# dev is the working branch. To promote a proven dev commit to test:
git checkout test && git merge --ff-only dev && git push origin test
#   → fires aipla-test-deploy → deploys to aipla-test-2026
# After test is verified, promote the SAME commit to prod:
git checkout prod && git merge --ff-only test && git push origin prod
#   → fires aipla-prod-deploy → deploys to aipla-prod-2026
```

- **ff-only** guarantees test/prod are exact ancestors of dev — no env carries a
  commit the tier below it hasn't seen. No divergent branches.
- **Every env deploy now runs the CI gate** (`cloudbuild.yaml` `ci-gate-*`,
  landed today) before building, so a red commit can't reach test/prod either.
  CI's GitHub-Actions workflow runs on `push: [dev]` + `pull_request:
  [dev,test,prod]`; the *deploy-time* gate is what protects the test/prod
  **push** path (CI's push trigger is dev-only). See Open Questions on whether to
  also add `push: [test, prod]` to the Actions workflow.
- The post-deploy `smoke-deployed` step + `scripts/smoke-deployed.sh [env]`
  already parameterise by env — they become the per-env acceptance gate.

## Per-env prerequisite checklist (derived from `cloudbuild.yaml` + bootstrap)

Each must exist in the target project **before its first push-deploy**:

- [ ] APIs enabled (secretmanager, run, cloudbuild, aiplatform, firestore, storage, …)
- [ ] Runtime SA `aipla-v6@<project>.iam` + IAM cascade (`aiplatform.user`,
      `storage.admin` on buckets, `secretmanager.secretAccessor`, …) — this SA is
      `_ADMIN_SEED_ALLOWED_SAS` and the Cloud Run identity for both containers
- [ ] Buckets: `<project>-artifacts`, `<project>-aipla-v01-logs`,
      `<project>-research-audio`, `<project>-tts-cache`, config bucket
      (`_CONFIG_BUCKET`), `<project>-cloudbuild-logs`
- [ ] Secrets: `GROUP_AUTH_SIGNING_SECRET` (fresh per env), `AGENT_ENGINE_ID`,
      `DOCPARSE_API_KEY`, `CURRICULUM_RAG_CORPUS_NAME`, `FIREBASE_ENV`
- [ ] Agent Engine reasoning-engine in `europe-west1` → its id into `AGENT_ENGINE_ID`
- [ ] Curriculum RAG corpus in `europe-west1` (`scripts/provision-curriculum-rag.sh`)
      → resource name into `CURRICULUM_RAG_CORPUS_NAME`; **seed only cleared
      (A-level) content** — copyright gate
- [ ] Firebase project + Web App + `FIREBASE_ENV` secret; firestore rules/indexes
      deploy (first build step does this)
- [ ] MCP sandbox service + `aipla-<env>-sandbox-deploy` trigger; per-env
      `_MCP_SANDBOX_URL` substitution (baked into the FE bundle at build)
- [ ] Cloud Build connection + `aipla-<env>-deploy` trigger on the matching branch
      + Terraform substitutions (`_REGION`, `_PROJECT_ID`,
      `_ARTIFACT_REGISTRY_REPO_URL_CLIENT`, `_CONFIG_BUCKET`,
      `_ADMIN_SEED_ALLOWED_SAS`, `_FIREBASE_TAG`)
- [ ] Post-deploy manual seed (per `aipla-cloud-bootstrap.md` runbook): platform
      skill seed (`make seed ENV=<env>`) + demo-code mint

## Milestones

- **M0 — Dedicated deployments project (DECIDED 2026-06-17).** State lives in a
  dedicated `aipla-deploy-2026` project (usual sunholo pattern — cf.
  `multivac-deploy-aitana`), not an env project. Create the project (org-level)
  + a versioned `gs://aipla-deploy-2026-tfstate` bucket. Per the pattern, this
  project also becomes the eventual home for the Cloud Build connection +
  triggers (today they sit in `aipla-dev-2026`).
- **M1 — Complete the Terraform module.** *(Increment 1 DONE 2026-06-17:
  `infrastructure/env/`, validated — foundation resources + composed modules.)*
  Increment 2: Firebase (google-beta) + Cloud Build connection/triggers,
  authored against a real `terraform plan` of the enabled test project.
- **M2 — Provision test.** Write `test.tfvars`, `terraform apply` against
  `aipla-test-2026`. Then the per-env data steps that aren't pure IaC (Agent
  Engine create, RAG corpus + cleared-content seed, demo codes, skill seed).
- **M3 — First promotion.** `ff-only` dev → test, push, watch the gated build,
  `smoke-deployed.sh test all`, `verify-chat-logs GROUP=<code> ENV=test`. Verify
  a teacher (Firebase) + anon-group student round-trip on a **fresh** session
  (do NOT migrate dev's sessions — see Risks).
- **M4 — Prove test.** A teacher runs a real activity in test; sign-off.
- **M5 — Cut prod (closer to pilot).** Same flow + prod hardening (Risks).

## Acceptance

- `scripts/smoke-deployed.sh test all` → all green (public 200s + auth 401s).
- `make verify-chat-logs GROUP=<code> ENV=test` → join→turn→BigQuery e2e.
- The gated build for the test deploy passes its `ci-gate-*` steps.
- One teacher + one anon-group student complete a turn each against test.

## Risks / watch-items

- **Curriculum copyright.** Only cleared (A-level) content may enter any env's
  shared RAG corpus. B/C and the 2010 exam archive are out. Seeding test/prod
  corpora must reuse the cleared set only.
- **Region pinning.** Agent Engine + RAG corpus must be `europe-west1` per env
  (`europe-north1` doesn't host reasoningEngines); compute stays `europe-north1`.
  `GOOGLE_CLOUD_LOCATION=global` (model routing) + `VERTEX_SESSION_LOCATION=
  europe-west1` must be set per env exactly as dev — this split is what the
  2026-06-17 session work hinges on.
- **Fresh sessions only.** Do not copy dev's Vertex sessions to test. A clean env
  sidesteps the legacy anon-group uid-ownership issue (the 2026-06-17 outage) —
  every test session is born under the current deterministic uid scheme.
- **Firebase per env.** Separate Firebase project, distinct Web API key, distinct
  `FIREBASE_ENV` secret. (Public Firebase keys are fine to expose, but they must
  be the *env's own* keys.)
- **Prod hardening.** dev runs `--allow-unauthenticated`; for prod reconsider
  ingress/auth (UCPH teacher SSO per ADR-001), `--min-instances` for cold-start
  on the pilot, and a custom domain/DNS decision.
- **Cost.** 3× Cloud Run + Agent Engine + RAG. Budget the duplication.

## Open questions

1. ~~**Provisioning mechanism / module home / state home.**~~ **ALL RESOLVED
   2026-06-17:** (a) Terraform-only for test/prod, dev stays imperative; (b) the
   root module lives in this repo at `infrastructure/env/` (composes the existing
   `modules/*`) — increment 1 authored + validated; (c) state lives in a
   dedicated `aipla-deploy-2026` deployments project (usual sunholo pattern), not
   an env project. Only the project-creation (M0) gates the first `plan`.
2. **CI push triggers.** Add `push: [test, prod]` to `.github/workflows/ci.yml`,
   or rely solely on the deploy-time `ci-gate-*`? (The gate already covers it;
   adding push-CI gives a GitHub-visible green check per promotion.)
3. **Timing.** Cut `test` now (mid-June, ahead of 1.1's ~2026-07-15 target) to
   de-risk earlier, given the demo outage? Recommended: yes for test; prod at M5.

## Related

- [aipla-cloud-bootstrap.md](aipla-cloud-bootstrap.md) — provisioning module (1.1)
- `docs/ops/deployed-urls.md` — per-env service URLs (dev populated; test/prod TBD)
- `scripts/bootstrap-aipla-dev.sh`, `scripts/provision-curriculum-rag.sh`,
  `scripts/smoke-deployed.sh`
